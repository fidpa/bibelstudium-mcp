#!/usr/bin/env bun
/**
 * Lädt die UBS Parallel Passage Database (2193 Gruppen von Parallelstellen und
 * alttestamentlichen Zitaten im Neuen Testament) in die lokale SQLite-Datenbank
 * (Tabelle `parallel_passages`).
 *
 * Aufruf (nachdem download.ts die bible.db gebaut hat):
 *   bun run download-parallels.ts
 *
 * Quelle: https://github.com/ubsicap/ubs-open-license, Verzeichnis
 *   "parallel passages". Lizenz: CC BY-SA 4.0,
 *   "(UBS Parallel Passage Database, © 2023 United Bible Societies.)".
 *   Die Datei enthält keinen Bibeltext, allein Versreferenzen, und ist damit
 *   sprachneutral.
 *
 * Die URL zeigt auf einen **festen Commit** und nicht auf `main`. Die Datei hat
 * seit ihrer Veröffentlichung genau einen Commit (fd7bcf88, 10.07.2023) und ist
 * auf `main` byteweise identisch (gemessen 22.08.2026); der Pin ist Vorsorge,
 * damit der Sollwert in quellen-pruefsummen.json nicht von einer fremden
 * Entscheidung abhängt.
 *
 * Übernommen werden allein die Referenzen. Die Ziffernfolgen in den Attributen
 * `HEB=`/`GRK=` markieren je Wort, wie genau es der Parallele entspricht, und
 * zählen dabei die Wörter von BHS und UBSGNT5. Dieser Server führt WLC,
 * Byzantine, SBLGNT und TR; keine dieser Editionen trennt Wörter gleich, und
 * UBSGNT5 liegt gar nicht vor. Die Ziffern wären hier also nicht zuzuordnen.
 *
 * ERGÄNZEND: fasst allein `parallel_passages` an.
 */

import { ensureParallelPassagesSchema } from "./schema.ts";
import { DB_PATH } from "../src/db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const XML_URL =
  "https://raw.githubusercontent.com/ubsicap/ubs-open-license/" +
  "fd7bcf88b20a1522d3916f437f012c561466fe7b/parallel%20passages/ParallelPassages.xml";

/** Untergrenze für einen plausiblen Lauf. Gemessen sind 2193 Gruppen
 *  (22.08.2026); deutlich weniger heißt, dass sich das Format geändert hat und
 *  der Ausdruck unten ins Leere greift. */
const MIN_GROUPS = 2000;

// USFM-Dreibuchstabencode → bolls.life-book_id (1 bis 66), in kanonischer
// Reihenfolge. Die Quelle benutzt durchgehend USFM und führt kein einziges
// deuterokanonisches Buch (59 verschiedene Codes, alle protokanonisch, gemessen
// 22.08.2026).
const USFM_ORDER = [
  "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA",
  "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO",
  "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO",
  "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL",
  "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH",
  "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS",
  "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
] as const;

const BOOKS: Record<string, number> = Object.fromEntries(
  USFM_ORDER.map((code, i) => [code, i + 1])
);

/** Ein zusammenhängender Versabschnitt innerhalb einer Referenz. */
interface Span {
  chapter: number;
  verse: number;
  verseEnd: number;
}

/** Eine Referenz der Quelle, aufgelöst. */
interface Reference {
  bookId: number;
  spans: Span[];
}

/**
 * Liest eine Referenz in der Form "MRK 10:7-8" oder "LUK 6:27-28,35"; null bei
 * Formfehler oder unbekanntem Buch.
 *
 * Die durch Komma getrennten Teile werden **nicht** zu einer Spanne
 * zusammengezogen. Genau zehn Referenzen haben diese Form, und in allen zehn
 * liegt eine echte Lücke dazwischen (gemessen 22.08.2026).
 */
export function parseReference(ref: string): Reference | null {
  const m = /^([A-Z0-9]{3}) (\d+):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/.exec(ref.trim());
  if (m === null) return null;
  const bookId = BOOKS[m[1]!];
  if (bookId === undefined) return null;
  const chapter = parseInt(m[2]!, 10);
  if (!Number.isInteger(chapter) || chapter < 1) return null;

  const spans: Span[] = [];
  for (const teil of m[3]!.split(",")) {
    const bis = teil.indexOf("-");
    const verse = parseInt(bis < 0 ? teil : teil.slice(0, bis), 10);
    const verseEnd = bis < 0 ? verse : parseInt(teil.slice(bis + 1), 10);
    if (!Number.isInteger(verse) || !Number.isInteger(verseEnd)) return null;
    if (verse < 1 || verseEnd < verse) return null;
    spans.push({ chapter, verse, verseEnd });
  }
  return { bookId, spans };
}

async function fetchText(url: string, retries = 3): Promise<ArrayBuffer> {
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

export async function main(): Promise<void> {
  console.log("=== UBS Parallel Passage Database (CC BY-SA 4.0) Download ===");
  console.log(`Database: ${DB_PATH}`);

  console.log("Fetching ParallelPassages.xml…");
  const digest = createSourceDigest(XML_URL);
  const raw = await fetchText(XML_URL);
  // Gehasht wird der rohe Puffer, nicht der dekodierte Text: Die Datei trägt ein
  // BOM, das die UTF-8-Dekodierung entfernt, und die Summe wiche dann von einem
  // `sha256sum` über die Datei ab. Der Sollwert im Manifest soll von Hand
  // nachprüfbar bleiben.
  digest.add(raw);
  const xml = new TextDecoder("utf-8").decode(raw).replace(/^﻿/, "");
  console.log(`  ${(raw.byteLength / 1024).toFixed(0)} KB XML fetched`);

  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
    ensureParallelPassagesSchema(db);
    db.exec("DELETE FROM parallel_passages");

    const insert = db.prepare(
      `INSERT INTO parallel_passages
         (group_id, member_seq, span_seq, book_id, chapter, verse, verse_end, lang, locator)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let groups = 0;
    let members = 0;
    let rows = 0;
    let skipped = 0;

    db.transaction(() => {
      for (const g of xml.matchAll(/<Passage>([\s\S]*?)<\/Passage>/g)) {
        const groupId = groups;
        let memberSeq = 0;
        // Eine Gruppe führt dieselbe Referenz gelegentlich zweimal (`EZK 21:1`
        // in der 39er-Gruppe, gemessen 22.08.2026). Die Dublette wird hier
        // verworfen und nicht erst beim Lesen: Sonst trüge jede Antwort sie
        // mit, und die Zahl der Mitglieder stimmte nicht mit der Zahl der
        // Stellen überein.
        const gesehen = new Set<string>();

        for (const v of g[1]!.matchAll(/<Verse (HEB|GRK)="[^"]*">([^<]+)<\/Verse>/g)) {
          const lang = v[1]!;
          const locator = v[2]!.trim();
          if (gesehen.has(locator)) continue;
          gesehen.add(locator);

          const ref = parseReference(locator);
          if (ref === null) {
            skipped++;
            continue;
          }
          let spanSeq = 0;
          for (const s of ref.spans) {
            insert.run(
              groupId, memberSeq, spanSeq,
              ref.bookId, s.chapter, s.verse, s.verseEnd,
              lang, locator
            );
            spanSeq++;
            rows++;
          }
          memberSeq++;
          members++;
        }
        // Eine Gruppe mit weniger als zwei Mitgliedern sagt nichts aus. Kommt im
        // gemessenen Bestand nicht vor, hielte aber einen Formatwechsel auf.
        if (memberSeq >= 2) groups++;
        else if (memberSeq > 0) throw new Error(`Group ${groupId} has only one member`);
      }
    })();

    if (skipped > 0) console.log(`  ${skipped} unparsable references skipped`);
    if (groups < MIN_GROUPS) {
      throw new Error(
        `Only ${groups} parallel groups parsed, expected at least ${MIN_GROUPS} — format changed?`
      );
    }

    console.log(`\nDone! ${groups} groups, ${members} members, ${rows} spans stored.`);

    writeProvenance(db, "download-parallels.ts", [digest]);
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
