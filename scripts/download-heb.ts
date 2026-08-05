#!/usr/bin/env bun
/**
 * Lädt das hebräische Alte Testament (Westminster Leningrad Codex, masoretisch)
 * samt Lemma, Strong-Nummern und OSHB-Morphologie in die lokale
 * SQLite-Datenbank, als Edition 'wlc' in `original_words`.
 *
 * Aufruf (nachdem download.ts die bible.db gebaut hat):
 *   bun run download-heb.ts
 *
 * Quelle: OpenScriptures Hebrew Bible (morphhb), OSIS-XML.
 *   Text (WLC) = Public Domain; Lemma und Morphologie = CC-BY 4.0.
 *   https://github.com/openscriptures/morphhb
 * Strong-Nummer → hebräisches Lemma: Open Scriptures Strong's Hebrew
 *   Dictionary, CC-BY-SA, https://github.com/openscriptures/strongs
 *   Das lemma-Attribut von morphhb ist ein Strong-Verweis (etwa "d/8064") und
 *   kein lesbares Lemma; es wird hier zum punktierten hebräischen Lemma
 *   (שָׁמַיִם) aufgelöst, damit `bible_original` eine echte Grundform zeigen kann.
 *   Nicht auflösbare Verweise behalten den rohen Attributwert.
 *
 * Dies ist der masoretische Text (Ben Ascher / Leningrad Codex), die Ausgabe,
 * an der die Mehrheits- beziehungsweise masoretische Textposition (etwa
 * R. Liebi) für das AT festhält, im Gegensatz zur mutmaßenden Textbesserung aus
 * LXX und Qumran.
 *
 * Ketiv und Qere: Gespeichert wird der geschriebene Text (Ketiv); die
 * Qere-Lesart steht in <note>-Elementen und wird übergangen, damit keine
 * doppelten Wortformen entstehen.
 *
 * ERGÄNZEND: fasst allein `original_words` an (edition 'wlc').
 */

import { dirname, resolve } from "path";
import { ensureOriginalWordsSchema } from "./schema.ts";
import { DB_PATH } from "../src/db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const RAW_BASE =
  "https://raw.githubusercontent.com/openscriptures/morphhb/master/wlc";
const STRONGS_URL =
  "https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js";
const DELAY_MS = 120;

// OSIS-Buchname → bolls.life-book_id (1 bis 39, Reihenfolge des protestantischen AT).
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

/** Erste Ziffernfolge in einer Lemma-Zeichenkette ("d/8064" → "8064", "1254 a" → "1254"). */
function primaryStrong(lemma: string): string {
  const m = lemma.match(/\d+/);
  return m ? m[0] : "";
}

/** Baut eine Abbildung Strong-Nummer → punktiertes hebräisches Lemma (gleiche Wörterbuchform wie im Griechischen). */
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
        const osisId = vm[1]!; // etwa "Gen.1.1"
        const parts = osisId.split(".");
        const chapter = parseInt(parts[1] ?? "", 10);
        const verse = parseInt(parts[2] ?? "", 10);
        if (!Number.isInteger(chapter) || !Number.isInteger(verse)) continue;

        // Qere-Lesarten (in <note>) verwerfen, damit nur das geschriebene Ketiv bleibt.
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
          // Grundform = punktiertes hebräisches Lemma aus dem Strong-Wörterbuch;
          // löst die Nummer nichts auf, bleibt der rohe OSHB-Verweis stehen.
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

// Nur bei direktem Aufruf ausführen. setup.ts importiert main(), damit der
// Server die Datenbank selbst aufbauen kann; ein Import darf keinen Download
// starten.
if (import.meta.main) {
  main().catch((error) => {
    console.error("Download failed:", error);
    process.exit(1);
  });
}
