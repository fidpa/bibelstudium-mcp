#!/usr/bin/env bun
/**
 * Lädt das morphologisch ausgezeichnete griechische Neue Testament (MorphGNT /
 * SBLGNT) in die vorhandene lokale SQLite-Datenbank, und zwar als *sekundäre*
 * Edition in der Tabelle `original_words` (edition = 'sblgnt').
 *
 * Aufruf (nachdem download.ts die bible.db gebaut hat):
 *   bun run download-morph.ts
 *
 * Grundtext  : SBL Greek New Testament (Michael W. Holmes), CC-BY 4.0
 * Morphologie: MorphGNT (James Tauber u. a.), CC-BY-SA 3.0
 *   https://github.com/morphgnt/sblgnt
 *
 * TEXTTYP: Das SBLGNT ist eine *kritische* (eklektische) Edition in der
 * Nestle-Aland-Tradition. Es liegt als SEKUNDÄRE Edition vor; die primäre ist
 * der byzantinische Mehrheitstext (siehe download-byz.ts), dem Roger Liebi und
 * die Mehrheitstext-Position den Vorzug geben. Die Morphologie (Kasus, Numerus,
 * Lemma) berührt die Texttypfrage nicht, es weichen nur wenige Lesarten ab.
 *
 * ERGÄNZEND: fasst allein `original_words` an (edition 'sblgnt'), niemals die
 * Tabellen `verses`, `books` oder `aliases`.
 */

import { dirname, resolve } from "path";
import { ensureOriginalWordsSchema } from "./schema.ts";
import { DB_PATH } from "../src/db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const RAW_BASE = "https://raw.githubusercontent.com/morphgnt/sblgnt/master";
const DELAY_MS = 150;

// Dateinamen des MorphGNT. Interner sechsstelliger Code: Buch 01 = Matthäus …
// 27 = Offenbarung; die book_id von bolls.life, die diese Datenbank führt, ist
// die interne Buchnummer plus 39 (Mt 01 → 40).
const FILES = [
  "61-Mt-morphgnt.txt", "62-Mk-morphgnt.txt", "63-Lk-morphgnt.txt",
  "64-Jn-morphgnt.txt", "65-Ac-morphgnt.txt", "66-Ro-morphgnt.txt",
  "67-1Co-morphgnt.txt", "68-2Co-morphgnt.txt", "69-Ga-morphgnt.txt",
  "70-Eph-morphgnt.txt", "71-Php-morphgnt.txt", "72-Col-morphgnt.txt",
  "73-1Th-morphgnt.txt", "74-2Th-morphgnt.txt", "75-1Ti-morphgnt.txt",
  "76-2Ti-morphgnt.txt", "77-Tit-morphgnt.txt", "78-Phm-morphgnt.txt",
  "79-Heb-morphgnt.txt", "80-Jas-morphgnt.txt", "81-1Pe-morphgnt.txt",
  "82-2Pe-morphgnt.txt", "83-1Jn-morphgnt.txt", "84-2Jn-morphgnt.txt",
  "85-3Jn-morphgnt.txt", "86-Jud-morphgnt.txt", "87-Re-morphgnt.txt",
] as const;

const BOLLS_OFFSET = 39;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(file: string, retries = 3): Promise<string> {
  const url = `${RAW_BASE}/${file}`;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
  throw new Error(`Failed: ${url}`);
}

export async function main(): Promise<void> {
  console.log("=== MorphGNT (SBLGNT, secondary edition) Download ===");
  console.log(`Database: ${DB_PATH}`);

  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
  ensureOriginalWordsSchema(db);
  db.exec("DELETE FROM original_words WHERE edition = 'sblgnt'");

  const insert = db.prepare(
    `INSERT INTO original_words
       (edition, book_id, chapter, verse, word_index, surface, lemma, strong, pos, parse, lang)
     VALUES ('sblgnt', ?, ?, ?, ?, ?, ?, '', ?, ?, 'grc')`
  );

  let totalWords = 0;
  const digest = createSourceDigest(`${RAW_BASE}/*-morphgnt.txt`);

  for (const file of FILES) {
    const raw = await fetchText(file);
    digest.add(raw);
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);

    let curKey = "";
    let wordIndex = 0;
    let fileWords = 0;

    db.transaction(() => {
      for (const line of lines) {
        // Felder: BBCCVV  POS  PARSE  text  word  norm  lemma
        const f = line.split(/\s+/);
        if (f.length < 7) continue;
        const code = f[0]!;
        if (!/^\d{6}$/.test(code)) continue;

        const bookId = parseInt(code.slice(0, 2), 10) + BOLLS_OFFSET;
        const chapter = parseInt(code.slice(2, 4), 10);
        const verse = parseInt(code.slice(4, 6), 10);
        const pos = f[1]!;
        const parse = f[2]!;
        const word = f[4]!; // bereinigte Wortform
        const lemma = f[6]!;

        const key = `${bookId}-${chapter}-${verse}`;
        if (key !== curKey) { curKey = key; wordIndex = 0; }

        insert.run(bookId, chapter, verse, wordIndex, word, lemma, pos, parse);
        wordIndex++;
        fileWords++;
        totalWords++;
      }
    })();

    console.log(`  ${file}: ${fileWords} words`);
    await sleep(DELAY_MS);
  }

  const count = db.query(
    "SELECT COUNT(*) as n FROM original_words WHERE edition='sblgnt'"
  ).get() as { n: number };
  console.log(`\nDone! ${count.n} SBLGNT word forms stored (imported ${totalWords}).`);

  writeProvenance(db, "download-morph.ts", [digest]);
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
