#!/usr/bin/env bun
/**
 * Lädt den Textus Receptus (die morphologisch bestimmte TR-Ausgabe von Dr.
 * Maurice A. Robinson, Tradition Scrivener/Stephens) samt Morphologie und Strong-Nummern
 * in die lokale SQLite-Datenbank, als dritte griechische Edition in
 * `original_words` (edition = 'tr').
 *
 * Aufruf (nachdem download.ts die bible.db gebaut hat):
 *   bun run download-tr.ts
 *
 * Quelle: byztxt/greektext-textus-receptus (Public Domain),
 *   https://github.com/byztxt/greektext-textus-receptus  (.UTR, Beta-Code)
 * Strong-Nummer → Lemma: Open Scriptures Strong's Greek Dictionary, CC-BY-SA.
 *
 * Der .UTR-Text liegt in Beta-Code vor (unakzentuiert, lateinisch
 * transliteriert). Er wird hier in unakzentuiertes griechisches Unicode
 * überführt, passend zur ebenfalls unakzentuierten byzantinischen Edition. Die
 * Morphologiecodes folgen Robinson (derselbe Dekoder wie bei byz).
 *
 * WARUM DIESE EDITION: Der TR ist der einzige griechische Texttyp, der das
 * Comma Johanneum (1Joh 5,7 in der Langform) und weitere nur dort bezeugte
 * Lesarten enthält. Er liegt bereit für den direkten Variantenvergleich gegen
 * den Mehrheitstext (Voreinstellung) und das SBLGNT. Anzumerken ist: Die
 * Mehrheitstext-Position (etwa R. Liebi) sieht im TR eine enge Ausprägung des
 * Mehrheitstexts aus der Reformationszeit, nicht selbst den Grundtext.
 *
 * ERGÄNZEND: fasst allein `original_words` an (edition 'tr').
 */

import { dirname, resolve } from "path";
import { ensureOriginalWordsSchema } from "./schema.ts";
import { DB_PATH } from "../db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const RAW_BASE =
  "https://raw.githubusercontent.com/byztxt/greektext-textus-receptus/master/parsed";
const STRONGS_URL =
  "https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js";
const DELAY_MS = 120;

// .UTR-Dateiname → bolls.life-book_id (40 bis 66).
const BOOKS: ReadonlyArray<readonly [string, number]> = [
  ["MT", 40], ["MR", 41], ["LU", 42], ["JOH", 43], ["AC", 44], ["RO", 45],
  ["1CO", 46], ["2CO", 47], ["GA", 48], ["EPH", 49], ["PHP", 50], ["COL", 51],
  ["1TH", 52], ["2TH", 53], ["1TI", 54], ["2TI", 55], ["TIT", 56], ["PHM", 57],
  ["HEB", 58], ["JAS", 59], ["1PE", 60], ["2PE", 61], ["1JO", 62], ["2JO", 63],
  ["3JO", 64], ["JUDE", 65], ["RE", 66],
];

// byztxt-Beta-Code → unakzentuiertes griechisches Unicode. 'v' = Schlusssigma,
// 's' = medial.
const BETA: Record<string, string> = {
  a: "α", b: "β", g: "γ", d: "δ", e: "ε", z: "ζ", h: "η", q: "θ", i: "ι",
  k: "κ", l: "λ", m: "μ", n: "ν", x: "ξ", o: "ο", p: "π", r: "ρ", s: "σ",
  v: "ς", t: "τ", u: "υ", f: "φ", c: "χ", y: "ψ", w: "ω",
};

function translit(beta: string): string {
  return [...beta].map((ch) => BETA[ch] ?? BETA[ch.toLowerCase()] ?? ch).join("");
}

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

function parseStrongsLemmas(js: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /"G(\d+)":\{[^}]*?"lemma":"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) map.set(m[1]!, m[2]!);
  return map;
}

// Token: Beta-Wort  Strong  [Robinson-Verbcode]  {MORPH}
const TOKEN_RE = /([a-zA-Z']+)\s+(\d+)(?:\s+\d+)*\s*\{([^}]+)\}/g;

interface VerseAcc {
  chapter: number;
  verse: number;
  text: string;
}

/** Zerlegt eine .UTR-Datei in Versblöcke (ein Vers kann über mehrere Zeilen gehen). */
function splitVerses(raw: string): VerseAcc[] {
  const out: VerseAcc[] = [];
  let cur: VerseAcc | null = null;
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const m = line.match(/^\s*(\d+):(\d+)\s+(.*)$/);
    if (m) {
      if (cur) out.push(cur);
      cur = { chapter: parseInt(m[1]!, 10), verse: parseInt(m[2]!, 10), text: m[3]! };
    } else if (cur) {
      cur.text += " " + line.trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

export async function main(): Promise<void> {
  console.log("=== Textus Receptus (Robinson parsed, edition 'tr') Download ===");
  console.log(`Database: ${DB_PATH}`);

  console.log("Fetching Strong's Greek lemmas…");
  const dStrongs = createSourceDigest(STRONGS_URL);
  const strongsJs = await fetchText(STRONGS_URL);
  dStrongs.add(strongsJs);
  const lemmas = parseStrongsLemmas(strongsJs);
  console.log(`  ${lemmas.size} Strong's lemmas loaded`);
  const dUtr = createSourceDigest(`${RAW_BASE}/*.UTR`);

  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
  ensureOriginalWordsSchema(db);
  db.exec("DELETE FROM original_words WHERE edition = 'tr'");

  const insert = db.prepare(
    `INSERT INTO original_words
       (edition, book_id, chapter, verse, word_index, surface, lemma, strong, pos, parse, lang)
     VALUES ('tr', ?, ?, ?, ?, ?, ?, ?, '', ?, 'grc')`
  );

  let totalWords = 0;

  for (const [abbrev, bookId] of BOOKS) {
    const raw = await fetchText(`${RAW_BASE}/${abbrev}.UTR`);
    dUtr.add(raw);
    const verses = splitVerses(raw);
    let fileWords = 0;

    db.transaction(() => {
      for (const v of verses) {
        let wordIndex = 0;
        TOKEN_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = TOKEN_RE.exec(v.text)) !== null) {
          const surface = translit(m[1]!);
          const strong = m[2]!;
          const morph = m[3]!;
          const lemma = lemmas.get(strong) ?? "";
          insert.run(bookId, v.chapter, v.verse, wordIndex, surface, lemma, strong, morph);
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
    "SELECT COUNT(*) as n FROM original_words WHERE edition='tr'"
  ).get() as { n: number };
  console.log(`\nDone! ${count.n} TR word forms stored (imported ${totalWords}).`);

  writeProvenance(db, "download-tr.ts", [dStrongs, dUtr]);
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
