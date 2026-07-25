#!/usr/bin/env bun
/**
 * Download the Byzantine Majority Text (Robinson-Pierpont 2005) with
 * morphological parsing and Strong's numbers into the local SQLite database as
 * the *primary* edition in `original_words` (edition = 'byzantine').
 *
 * Run (after download.ts has built bible.db):
 *   bun run download-byz.ts
 *
 * Text + morphology + Strong's : Robinson-Pierpont Byzantine Textform 2005,
 *   freely distributable (public domain), https://github.com/byztxt/byzantine-majority-text
 * Strong's → Greek lemma        : Open Scriptures Strong's Greek Dictionary, CC-BY-SA
 *   https://github.com/openscriptures/strongs
 *
 * TEXT TYPE: This is the Majority Text (byzantine textform) that Roger Liebi and
 * the majority-text position hold to be the reliable base text — e.g. it does
 * NOT contain the Comma Johanneum (1Jn 5:7). It is the DEFAULT of bible_original;
 * the critical SBLGNT is kept as the secondary edition (download-morph.ts).
 *
 * ADDITIVE: touches only `original_words` (edition 'byzantine').
 */

import { dirname, resolve } from "path";
import { ensureOriginalWordsSchema } from "./schema.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const CSV_BASE =
  "https://raw.githubusercontent.com/byztxt/byzantine-majority-text/master/csv-unicode/strongs/with-parsing";
const STRONGS_URL =
  "https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js";
const DB_PATH = resolve(dirname(import.meta.path), "..", "data/bible.db");
const DELAY_MS = 120;

// Byzantine CSV filename (book abbreviation) → bolls.life book_id (40–66).
const BOOKS: ReadonlyArray<readonly [string, number]> = [
  ["MAT", 40], ["MAR", 41], ["LUK", 42], ["JOH", 43], ["ACT", 44], ["ROM", 45],
  ["1CO", 46], ["2CO", 47], ["GAL", 48], ["EPH", 49], ["PHP", 50], ["COL", 51],
  ["1TH", 52], ["2TH", 53], ["1TI", 54], ["2TI", 55], ["TIT", 56], ["PHM", 57],
  ["HEB", 58], ["JAM", 59], ["1PE", 60], ["2PE", 61], ["1JO", 62], ["2JO", 63],
  ["3JO", 64], ["JUD", 65], ["REV", 66],
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url: string, retries = 3): Promise<string> {
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

/** Build a Strong's-number → Greek lemma map from the Open Scriptures dictionary. */
function parseStrongsLemmas(js: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /"G(\d+)":\{[^}]*?"lemma":"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) {
    map.set(m[1]!, m[2]!);
  }
  return map;
}

// Each verse token is: SURFACE  STRONG  {MORPH}
const TOKEN_RE = /(\S+)\s+(\d+)\s+\{([^}]+)\}/g;

async function main(): Promise<void> {
  console.log("=== Byzantine Majority Text (Robinson-Pierpont, primary edition) Download ===");
  console.log(`Database: ${DB_PATH}`);

  console.log("Fetching Strong's Greek lemmas…");
  const dStrongs = createSourceDigest(STRONGS_URL);
  const strongsJs = await fetchText(STRONGS_URL);
  dStrongs.add(strongsJs);
  const lemmas = parseStrongsLemmas(strongsJs);
  console.log(`  ${lemmas.size} Strong's lemmas loaded`);
  const dCsv = createSourceDigest(`${CSV_BASE}/*.csv`);

  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
  ensureOriginalWordsSchema(db);
  db.exec("DELETE FROM original_words WHERE edition = 'byzantine'");

  const insert = db.prepare(
    `INSERT INTO original_words
       (edition, book_id, chapter, verse, word_index, surface, lemma, strong, pos, parse, lang)
     VALUES ('byzantine', ?, ?, ?, ?, ?, ?, ?, '', ?, 'grc')`
  );

  let totalWords = 0;

  for (const [abbrev, bookId] of BOOKS) {
    const csv = await fetchText(`${CSV_BASE}/${abbrev}.csv`);
    dCsv.add(csv);
    const lines = csv.split("\n");
    let fileWords = 0;

    db.transaction(() => {
      for (const line of lines) {
        // Robust split: chapter,verse,<text> — text itself has no commas,
        // but only split on the first two to be safe.
        const c1 = line.indexOf(",");
        const c2 = line.indexOf(",", c1 + 1);
        if (c1 < 0 || c2 < 0) continue;
        const chapter = parseInt(line.slice(0, c1), 10);
        const verse = parseInt(line.slice(c1 + 1, c2), 10);
        if (!Number.isInteger(chapter) || !Number.isInteger(verse)) continue; // header
        const text = line.slice(c2 + 1);

        let wordIndex = 0;
        TOKEN_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = TOKEN_RE.exec(text)) !== null) {
          const surface = m[1]!;
          const strong = m[2]!;
          const morph = m[3]!;
          const lemma = lemmas.get(strong) ?? "";
          insert.run(bookId, chapter, verse, wordIndex, surface, lemma, strong, morph);
          wordIndex++;
          fileWords++;
          totalWords++;
        }
      }
    })();

    console.log(`  ${abbrev} → book ${bookId}: ${fileWords} words`);
    await sleep(DELAY_MS);
  }

  const count = db.query(
    "SELECT COUNT(*) as n FROM original_words WHERE edition='byzantine'"
  ).get() as { n: number };
  console.log(`\nDone! ${count.n} Byzantine word forms stored (imported ${totalWords}).`);

  writeProvenance(db, "download-byz.ts", [dStrongs, dCsv]);
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
