#!/usr/bin/env bun
/**
 * Lädt den Querverweis-Datensatz von OpenBible.info (R. A. Torreys Treasury of
 * Scripture Knowledge, erweitert auf rund 340 000 gerichtete Verweise mit
 * Gemeinschaftsbewertungen) in die lokale SQLite-Datenbank (Tabelle
 * `cross_references`).
 *
 * Aufruf (nachdem download.ts die bible.db gebaut hat):
 *   bun run download-crossrefs.ts
 *
 * Quelle: https://www.openbible.info/labs/cross-references/
 *   Lizenz: Creative Commons Attribution (CC-BY). Die Datei ist ein Zip mit
 *   einer TSV: "From Verse<TAB>To Verse<TAB>Votes"; Verweise folgen OSIS
 *   ("Gen.1.1"), Ziele können Bereiche sein ("Ps.148.4-Ps.148.5"). Die
 *   Bewertungen können negativ sein.
 *
 * Entpackt wird über das `unzip` des Systems (auf macOS und Linux vorhanden):
 * Bun bringt keine Zip-Unterstützung mit, und dieses Repository nimmt dafür
 * bewusst keine Abhängigkeit auf.
 *
 * ERGÄNZEND: fasst allein `cross_references` an.
 */

import { dirname, resolve } from "path";
import { unlinkSync, writeFileSync } from "fs";
import { ensureCrossRefsSchema } from "./schema.ts";
import { DB_PATH } from "../db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const ZIP_URL = "https://a.openbible.info/data/cross-references.zip";

// OSIS-Buchabkürzung → bolls.life-book_id (1 bis 66). Der AT-Teil entspricht den
// Namen von morphhb (siehe download-heb.ts), die NT-Namen folgen dem OSIS-Standard.
const BOOKS: Record<string, number> = {
  Gen: 1, Exod: 2, Lev: 3, Num: 4, Deut: 5, Josh: 6, Judg: 7, Ruth: 8,
  "1Sam": 9, "2Sam": 10, "1Kgs": 11, "2Kgs": 12, "1Chr": 13, "2Chr": 14,
  Ezra: 15, Neh: 16, Esth: 17, Job: 18, Ps: 19, Prov: 20, Eccl: 21, Song: 22,
  Isa: 23, Jer: 24, Lam: 25, Ezek: 26, Dan: 27, Hos: 28, Joel: 29, Amos: 30,
  Obad: 31, Jonah: 32, Mic: 33, Nah: 34, Hab: 35, Zeph: 36, Hag: 37, Zech: 38,
  Mal: 39,
  Matt: 40, Mark: 41, Luke: 42, John: 43, Acts: 44, Rom: 45, "1Cor": 46,
  "2Cor": 47, Gal: 48, Eph: 49, Phil: 50, Col: 51, "1Thess": 52, "2Thess": 53,
  "1Tim": 54, "2Tim": 55, Titus: 56, Phlm: 57, Heb: 58, Jas: 59, "1Pet": 60,
  "2Pet": 61, "1John": 62, "2John": 63, "3John": 64, Jude: 65, Rev: 66,
};

interface Ref {
  book: number;
  chapter: number;
  verse: number;
}

/** Liest einen Verweis in OSIS-Form ("Gen.1.1"); null bei Formfehler oder unbekanntem Buch. */
function parseRef(ref: string): Ref | null {
  const p = ref.split(".");
  if (p.length !== 3) return null;
  const book = BOOKS[p[0]!];
  const chapter = parseInt(p[1]!, 10);
  const verse = parseInt(p[2]!, 10);
  if (book === undefined || !Number.isInteger(chapter) || !Number.isInteger(verse)) {
    return null;
  }
  if (chapter < 1 || verse < 1) return null;
  return { book, chapter, verse };
}

async function fetchZip(url: string, retries = 3): Promise<ArrayBuffer> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.arrayBuffer();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error(`Failed: ${url}`);
}

/**
 * Scheitert vor dem Download, wenn `unzip` fehlt. Schlanke Linux-Abbilder
 * bringen es nicht mit, und Bun.spawnSync würde sonst ein nacktes „Executable
 * not found in $PATH" werfen, nachdem bereits 5 MB geladen sind.
 */
function requireUnzip(): void {
  if (Bun.which("unzip") === null) {
    throw new Error(
      "'unzip' not found in $PATH. Install it and rerun " +
        "(Debian/Ubuntu: sudo apt install unzip · Fedora: sudo dnf install unzip · " +
        "macOS: preinstalled)."
    );
  }
}

export async function main(): Promise<void> {
  console.log("=== OpenBible.info Cross-References (TSK expanded, CC-BY) Download ===");
  console.log(`Database: ${DB_PATH}`);

  requireUnzip();

  console.log("Fetching cross-references.zip…");
  const digest = createSourceDigest(ZIP_URL);
  const zipData = await fetchZip(ZIP_URL);
  digest.add(zipData);
  const zipPath = resolve(dirname(DB_PATH), `.crossrefs.${process.pid}.zip`);
  writeFileSync(zipPath, new Uint8Array(zipData));

  let tsv: string;
  try {
    const proc = Bun.spawnSync(["unzip", "-p", zipPath]);
    if (proc.exitCode !== 0) {
      throw new Error(`unzip failed: ${proc.stderr.toString().trim()}`);
    }
    tsv = proc.stdout.toString();
  } finally {
    try { unlinkSync(zipPath); } catch { /* best effort */ }
  }
  console.log(`  ${(tsv.length / 1024 / 1024).toFixed(1)} MB TSV extracted`);

  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
    ensureCrossRefsSchema(db);
    db.exec("DELETE FROM cross_references");

    const insert = db.prepare(
      `INSERT INTO cross_references
         (from_book, from_chapter, from_verse,
          to_book, to_chapter, to_verse, to_chapter_end, to_verse_end, votes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let inserted = 0;
    let skipped = 0;

    db.transaction(() => {
      for (const line of tsv.split("\n")) {
        const f = line.trim().split("\t");
        if (f.length < 3) continue;
        const from = parseRef(f[0]!);
        if (from === null) { if (f[0] !== "From Verse") skipped++; continue; }

        // Das Ziel kann ein Bereich "A-B" sein; beide Enden sind volle OSIS-Verweise.
        const dash = f[1]!.indexOf("-");
        const toStart = parseRef(dash < 0 ? f[1]! : f[1]!.slice(0, dash));
        const toEnd = dash < 0 ? toStart : parseRef(f[1]!.slice(dash + 1));
        const votes = parseInt(f[2]!, 10);
        if (toStart === null || toEnd === null || !Number.isInteger(votes)) {
          skipped++;
          continue;
        }
        if (toEnd.book !== toStart.book) { skipped++; continue; } // Bereich über Buchgrenze: nicht vorgesehen

        insert.run(
          from.book, from.chapter, from.verse,
          toStart.book, toStart.chapter, toStart.verse,
          toEnd.chapter, toEnd.verse, votes
        );
        inserted++;
      }
    })();

    if (skipped > 0) console.log(`  ${skipped} malformed/unexpected rows skipped`);
    if (inserted === 0) throw new Error("No cross-references parsed — format changed?");

    const count = db.query("SELECT COUNT(*) as n FROM cross_references").get() as { n: number };
    console.log(`\nDone! ${count.n} cross-references stored (imported ${inserted}).`);

    writeProvenance(db, "download-crossrefs.ts", [digest]);
    commit();
  } catch (err) {
    abort();
    throw err;
  }

  const { statSync } = await import("fs");
  const sizeMB = (statSync(DB_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`Database size now: ${sizeMB} MB`);
}

// Nur bei direktem Aufruf ausführen. setup.ts importiert main(), damit der
// Server die Datenbank selbst aufbauen kann; ein Import darf keinen Download
// starten.
if (import.meta.main) {
  main().catch((error) => {
    console.error("Download failed:", error);
    process.exit(1);
  });
}
