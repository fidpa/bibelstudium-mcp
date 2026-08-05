#!/usr/bin/env bun
/**
 * Lädt das STEPBible TAGNT (Translators Amalgamated Greek NT) und legt die
 * Bezeugung je Wort in der lokalen SQLite-Datenbank ab (`tagnt_words`).
 *
 * Aufruf (nachdem download.ts die bible.db gebaut hat):
 *   bun run download-tagnt.ts
 *
 * Quelle: https://github.com/STEPBible/STEPBible-Data (CC BY 4.0), Verzeichnis
 * "Translators Amalgamated OT+NT", zwei Dateien (Mat-Jhn, Act-Rev). Jede
 * Datenzeile ist ein Wort des zusammengeführten NT samt den Editionen, die es
 * bezeugen (NA27/28, Tyndale House, SBL, Westcott-Hort, Tregelles, TR,
 * byzantinisch), dazu Notizen zu erheblichen Bedeutungs- und
 * Schreibvarianten. `bible_compare` zeigt damit je Wort, welche Editionen es
 * führen, über die drei vollständigen Editionen in `original_words` hinaus.
 *
 * ERGÄNZEND: fasst allein `tagnt_words` an.
 */

import { dirname, resolve } from "path";
import { ensureTagntSchema } from "./schema.ts";
import { DB_PATH } from "../src/db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const RAW_BASE =
  "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Translators%20Amalgamated%20OT%2BNT/";
const FILES = [
  "TAGNT%20Mat-Jhn%20-%20Translators%20Amalgamated%20Greek%20NT%20-%20STEPBible.org%20CC-BY.txt",
  "TAGNT%20Act-Rev%20-%20Translators%20Amalgamated%20Greek%20NT%20-%20STEPBible.org%20CC-BY.txt",
] as const;

// TAGNT-Buchabkürzung → bolls.life-book_id (40 bis 66).
const BOOKS: Record<string, number> = {
  Mat: 40, Mrk: 41, Luk: 42, Jhn: 43, Act: 44, Rom: 45,
  "1Co": 46, "2Co": 47, Gal: 48, Eph: 49, Php: 50, Col: 51,
  "1Th": 52, "2Th": 53, "1Ti": 54, "2Ti": 55, Tit: 56, Phm: 57,
  Heb: 58, Jas: 59, "1Pe": 60, "2Pe": 61, "1Jn": 62, "2Jn": 63,
  "3Jn": 64, Jud: 65, Rev: 66,
};

// Datenzeile: "Mat.1.1#01=NKO<TAB>…"; Anzeigezeilen beginnen mit '#' oder haben keinen Verweis.
const REF_RE = /^(\d?[A-Za-z]{2,3})\.(\d+)\.(\d+)#(\d+)=(\S+)$/;
// Griechische Spalte: "Βίβλος (Biblos)", Wortform samt Transliteration.
const GREEK_RE = /^(.*?)\s*\(([^)]*)\)\s*$/;
// dStrong-Spalte: "G0976=N-NSF"; das angehängte Zeichen ist die Unterscheidung von STEPBible.
const STRONG_RE = /^G(\d+)[A-Z]?=(.+)$/;

async function fetchText(url: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error(`Failed: ${url}`);
}

export async function main(): Promise<void> {
  console.log("=== STEPBible TAGNT (edition attestation) Download ===");
  console.log(`Database: ${DB_PATH}`);

  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
    ensureTagntSchema(db);
    db.exec("DELETE FROM tagnt_words");

    const insert = db.prepare(
      `INSERT INTO tagnt_words
         (book_id, chapter, verse, word_index, surface, translit, word_type,
          strong, grammar, editions, meaning_variant, spelling_variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const digest = createSourceDigest(`${RAW_BASE}TAGNT *.txt`);
    let total = 0;

    for (const file of FILES) {
      console.log(`Fetching ${decodeURIComponent(file).slice(0, 15)}…`);
      const text = await fetchText(RAW_BASE + file);
      digest.add(text);
      let fileRows = 0;

      db.transaction(() => {
        for (const line of text.split("\n")) {
          // UTF-8-BOM (erste Zeile) und CR entfernen (die Dateien nutzen CRLF).
          const cols = line.replace(/^﻿/, "").replace(/\r$/, "").split("\t");
          const ref = REF_RE.exec(cols[0] ?? "");
          if (ref === null) continue; // Kopf-, Anzeige- oder Leerzeile
          const bookId = BOOKS[ref[1]!];
          if (bookId === undefined) {
            throw new Error(`Unknown TAGNT book abbreviation "${ref[1]}" in row "${cols[0]}"`);
          }
          if (cols.length < 6 || !cols[5]!.trim()) {
            throw new Error(`TAGNT row "${cols[0]}" lacks the editions column — format changed?`);
          }

          const greek = GREEK_RE.exec(cols[1]!.trim());
          const strong = STRONG_RE.exec(cols[3]?.trim() ?? "");
          insert.run(
            bookId,
            parseInt(ref[2]!, 10),
            parseInt(ref[3]!, 10),
            parseInt(ref[4]!, 10),
            greek ? greek[1]! : cols[1]!.trim(),
            greek ? greek[2]! : "",
            ref[5]!,
            strong ? String(parseInt(strong[1]!, 10)) : "",
            strong ? strong[2]! : "",
            cols[5]!.trim(),
            (cols[6] ?? "").trim(),
            (cols[7] ?? "").trim()
          );
          fileRows++;
          total++;
        }
      })();

      console.log(`  ${fileRows} word rows imported`);
    }

    // Das vollständige NT hat rund 141 700 Zeilen; deutlich weniger heißt, das Parsen ist kaputt.
    if (total < 135000) {
      throw new Error(`Only ${total} TAGNT rows imported — format changed?`);
    }
    const n = (db.query("SELECT COUNT(*) as n FROM tagnt_words").get() as { n: number }).n;
    console.log(`\nDone! ${n} TAGNT words stored.`);

    writeProvenance(db, "download-tagnt.ts", [digest]);
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
