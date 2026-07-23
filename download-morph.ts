#!/usr/bin/env bun
/**
 * Download the morphologically tagged Greek New Testament (MorphGNT / SBLGNT)
 * into the existing local SQLite database as the *secondary* edition in table
 * `original_words` (edition = 'sblgnt').
 *
 * Run (after download.ts has built bible.db):
 *   bun run download-morph.ts
 *
 * Source text : SBL Greek New Testament (Michael W. Holmes), CC-BY 4.0
 * Morphology  : MorphGNT (James Tauber et al.), CC-BY-SA 3.0
 *   https://github.com/morphgnt/sblgnt
 *
 * TEXT TYPE: SBLGNT is a *critical* (eclectic) edition in the Nestle-Aland
 * tradition. It is stored as the SECONDARY edition; the primary edition is the
 * Byzantine Majority Text (see download-byz.ts), which Roger Liebi and the
 * majority-text position favour. Morphology (case, number, lemma) is unaffected
 * by the text-type question; only a small number of variant readings differ.
 *
 * ADDITIVE: touches only `original_words` (edition 'sblgnt'); never the
 * `verses`, `books`, or `aliases` tables.
 */

import { dirname, resolve } from "path";
import { ensureOriginalWordsSchema } from "./schema.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const RAW_BASE = "https://raw.githubusercontent.com/morphgnt/sblgnt/master";
const DB_PATH = resolve(dirname(import.meta.path), "data/bible.db");
const DELAY_MS = 150;

// MorphGNT filenames. Internal 6-digit code: book 01=Matthew … 27=Rev;
// bolls.life book_id (used by this DB) = internal book number + 39 (Mt 01 → 40).
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

async function main(): Promise<void> {
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
        // Fields: BBCCVV  POS  PARSE  text  word  norm  lemma
        const f = line.split(/\s+/);
        if (f.length < 7) continue;
        const code = f[0]!;
        if (!/^\d{6}$/.test(code)) continue;

        const bookId = parseInt(code.slice(0, 2), 10) + BOLLS_OFFSET;
        const chapter = parseInt(code.slice(2, 4), 10);
        const verse = parseInt(code.slice(4, 6), 10);
        const pos = f[1]!;
        const parse = f[2]!;
        const word = f[4]!; // clean surface form
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

main().catch((error) => {
  console.error("Download failed:", error);
  process.exit(1);
});
