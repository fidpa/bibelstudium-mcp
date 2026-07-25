#!/usr/bin/env bun
/**
 * Download the OpenBible.info cross-reference dataset (R. A. Torrey's Treasury
 * of Scripture Knowledge, expanded to ~340k directed references with community
 * votes) into the local SQLite database (table `cross_references`).
 *
 * Run (after download.ts has built bible.db):
 *   bun run download-crossrefs.ts
 *
 * Source: https://www.openbible.info/labs/cross-references/
 *   License: Creative Commons Attribution (CC-BY). Data file is a zip with one
 *   TSV: "From Verse<TAB>To Verse<TAB>Votes"; refs are OSIS-style ("Gen.1.1"),
 *   targets may be ranges ("Ps.148.4-Ps.148.5"). Votes can be negative.
 *
 * Unzipping shells out to the system `unzip` (present on macOS/Linux); Bun has
 * no built-in zip support and this repo deliberately adds no dependency for it.
 *
 * ADDITIVE: touches only `cross_references`.
 */

import { dirname, resolve } from "path";
import { unlinkSync, writeFileSync } from "fs";
import { ensureCrossRefsSchema } from "./schema.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const ZIP_URL = "https://a.openbible.info/data/cross-references.zip";
const DB_PATH = resolve(dirname(import.meta.path), "..", "data/bible.db");

// OSIS book abbreviation → bolls.life book_id (1–66). The OT part matches the
// names used by morphhb (see download-heb.ts); NT names per OSIS standard.
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

/** Parse one OSIS-style ref ("Gen.1.1"); null if malformed or unknown book. */
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
 * Fail before the download if `unzip` is missing. Minimal Linux images ship
 * without it, and Bun.spawnSync would otherwise throw a bare "Executable not
 * found in $PATH" — after 5 MB have already been fetched.
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

async function main(): Promise<void> {
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

        // Target may be a range "A-B"; both ends are full OSIS refs.
        const dash = f[1]!.indexOf("-");
        const toStart = parseRef(dash < 0 ? f[1]! : f[1]!.slice(0, dash));
        const toEnd = dash < 0 ? toStart : parseRef(f[1]!.slice(dash + 1));
        const votes = parseInt(f[2]!, 10);
        if (toStart === null || toEnd === null || !Number.isInteger(votes)) {
          skipped++;
          continue;
        }
        if (toEnd.book !== toStart.book) { skipped++; continue; } // cross-book range: not expected

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

main().catch((error) => {
  console.error("Download failed:", error);
  process.exit(1);
});
