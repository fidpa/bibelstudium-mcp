#!/usr/bin/env bun
/**
 * Download the Hebrew Old Testament (Westminster Leningrad Codex / masoretic)
 * with lemma, Strong's numbers and OSHB morphology into the local SQLite
 * database as edition 'wlc' in `original_words`.
 *
 * Run (after download.ts has built bible.db):
 *   bun run download-heb.ts
 *
 * Source: OpenScriptures Hebrew Bible (morphhb), OSIS XML.
 *   Text (WLC) = Public Domain; lemma + morphology = CC-BY 4.0.
 *   https://github.com/openscriptures/morphhb
 * Strong's → Hebrew lemma: Open Scriptures Strong's Hebrew Dictionary, CC-BY-SA
 *   https://github.com/openscriptures/strongs
 *   The morphhb lemma attribute is a Strong's reference (e.g. "d/8064"), not a
 *   readable lemma; it is resolved here to the pointed Hebrew lemma (שָׁמַיִם)
 *   so `bible_original` can show a real Grundform. Unresolvable references
 *   keep the raw attribute value.
 *
 * This is the masoretic text (Ben Asher / Leningrad Codex) — the edition the
 * majority/masoretic-text position (e.g. R. Liebi) holds for the OT, as opposed
 * to conjectural emendation from LXX/Qumran.
 *
 * Ketiv/Qere: the written text (ketiv) is stored; the qere reading lives inside
 * <note> elements and is skipped to avoid duplicate word forms.
 *
 * ADDITIVE: touches only `original_words` (edition 'wlc').
 */

import { dirname, resolve } from "path";
import { ensureOriginalWordsSchema } from "./schema.ts";
import { DB_PATH } from "../db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const RAW_BASE =
  "https://raw.githubusercontent.com/openscriptures/morphhb/master/wlc";
const STRONGS_URL =
  "https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js";
const DELAY_MS = 120;

// OSIS book name → bolls.life book_id (1–39, Protestant OT order).
const BOOKS: ReadonlyArray<readonly [string, number]> = [
  ["Gen", 1], ["Exod", 2], ["Lev", 3], ["Num", 4], ["Deut", 5], ["Josh", 6],
  ["Judg", 7], ["Ruth", 8], ["1Sam", 9], ["2Sam", 10], ["1Kgs", 11], ["2Kgs", 12],
  ["1Chr", 13], ["2Chr", 14], ["Ezra", 15], ["Neh", 16], ["Esth", 17], ["Job", 18],
  ["Ps", 19], ["Prov", 20], ["Eccl", 21], ["Song", 22], ["Isa", 23], ["Jer", 24],
  ["Lam", 25], ["Ezek", 26], ["Dan", 27], ["Hos", 28], ["Joel", 29], ["Amos", 30],
  ["Obad", 31], ["Jonah", 32], ["Mic", 33], ["Nah", 34], ["Hab", 35], ["Zeph", 36],
  ["Hag", 37], ["Zech", 38], ["Mal", 39],
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

const VERSE_RE = /<verse osisID="([^"]+)">([\s\S]*?)<\/verse>/g;
const NOTE_RE = /<note[\s\S]*?<\/note>/g;
const W_RE = /<w\b([^>]*)>([\s\S]*?)<\/w>/g;
const ATTR_RE = (name: string) => new RegExp(`${name}="([^"]*)"`);

/** First run of digits in a lemma string ("d/8064" → "8064", "1254 a" → "1254"). */
function primaryStrong(lemma: string): string {
  const m = lemma.match(/\d+/);
  return m ? m[0] : "";
}

/** Build a Strong's-number → pointed Hebrew lemma map (same dict shape as the Greek one). */
function parseStrongsLemmas(js: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /"H(\d+)":\{[^}]*?"lemma":"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) map.set(m[1]!, m[2]!);
  return map;
}

export async function main(): Promise<void> {
  console.log("=== Hebrew OT (WLC / morphhb, edition 'wlc') Download ===");
  console.log(`Database: ${DB_PATH}`);

  console.log("Fetching Strong's Hebrew lemmas…");
  const dStrongs = createSourceDigest(STRONGS_URL);
  const strongsJs = await fetchText(STRONGS_URL);
  dStrongs.add(strongsJs);
  const strongsLemmas = parseStrongsLemmas(strongsJs);
  console.log(`  ${strongsLemmas.size} Strong's lemmas loaded`);
  const dXml = createSourceDigest(`${RAW_BASE}/*.xml`);

  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
  ensureOriginalWordsSchema(db);
  db.exec("DELETE FROM original_words WHERE edition = 'wlc'");

  const insert = db.prepare(
    `INSERT INTO original_words
       (edition, book_id, chapter, verse, word_index, surface, lemma, strong, pos, parse, lang)
     VALUES ('wlc', ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
  );

  const lemmaAttr = ATTR_RE("lemma");
  const morphAttr = ATTR_RE("morph");

  let totalWords = 0;

  for (const [osis, bookId] of BOOKS) {
    const xml = await fetchText(`${RAW_BASE}/${osis}.xml`);
    dXml.add(xml);
    let fileWords = 0;

    db.transaction(() => {
      VERSE_RE.lastIndex = 0;
      let vm: RegExpExecArray | null;
      while ((vm = VERSE_RE.exec(xml)) !== null) {
        const osisId = vm[1]!; // e.g. "Gen.1.1"
        const parts = osisId.split(".");
        const chapter = parseInt(parts[1] ?? "", 10);
        const verse = parseInt(parts[2] ?? "", 10);
        if (!Number.isInteger(chapter) || !Number.isInteger(verse)) continue;

        // Drop qere readings (inside <note>) so only the written ketiv remains.
        const body = vm[2]!.replace(NOTE_RE, "");

        let wordIndex = 0;
        W_RE.lastIndex = 0;
        let wm: RegExpExecArray | null;
        while ((wm = W_RE.exec(body)) !== null) {
          const attrs = wm[1]!;
          const surface = wm[2]!.replace(/<[^>]+>/g, "").trim();
          if (!surface) continue;
          const rawLemma = attrs.match(lemmaAttr)?.[1] ?? "";
          const morph = attrs.match(morphAttr)?.[1] ?? "";
          const strong = primaryStrong(rawLemma);
          // Grundform = pointed Hebrew lemma from the Strong's dictionary;
          // fall back to the raw OSHB reference if the number resolves nothing.
          const lemma = strongsLemmas.get(strong) ?? rawLemma;
          const lang = morph.startsWith("A") ? "arc" : "heb";
          insert.run(bookId, chapter, verse, wordIndex, surface, lemma, strong, morph, lang);
          wordIndex++;
          fileWords++;
          totalWords++;
        }
      }
    })();

    console.log(`  ${osis} → book ${bookId}: ${fileWords} words`);
    await sleep(DELAY_MS);
  }

  const count = db.query(
    "SELECT COUNT(*) as n FROM original_words WHERE edition='wlc'"
  ).get() as { n: number };
  console.log(`\nDone! ${count.n} Hebrew/Aramaic word forms stored (imported ${totalWords}).`);

  writeProvenance(db, "download-heb.ts", [dStrongs, dXml]);
  commit();
  } catch (err) {
    abort();
    throw err;
  }

  const { statSync } = await import("fs");
  const sizeMB = (statSync(DB_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`Database size now: ${sizeMB} MB`);
}

// Run only when invoked directly. setup.ts imports main() so the server can
// build the database itself; an import must not start a download.
if (import.meta.main) {
  main().catch((error) => {
    console.error("Download failed:", error);
    process.exit(1);
  });
}
