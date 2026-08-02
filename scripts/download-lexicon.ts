#!/usr/bin/env bun
/**
 * Lädt die Strong-Wörterbücher von Open Scriptures (Griechisch und Hebräisch)
 * und legt die vollständigen Einträge in der lokalen SQLite-Datenbank ab
 * (Tabelle `strong_defs`): Lemma, Transliteration, Definition, KJV-Glossen.
 *
 * Aufruf (nachdem download.ts die bible.db gebaut hat):
 *   bun run download-lexicon.ts
 *
 * Quelle: https://github.com/openscriptures/strongs (CC-BY-SA).
 * Dieselben Dateien holen auch download-byz.ts und download-heb.ts, die daraus
 * aber nur das Lemma für `original_words` ziehen; dieses Skript behält die
 * englischen Definitionen, damit `bible_concordance` Wortbedeutungen zeigen
 * kann.
 *
 * Zusätzlich reichert es jeden Eintrag aus den Kurzlexika von STEPBible an
 * (https://github.com/STEPBible/STEPBible-Data, CC BY 4.0):
 *   - TBESG (Griechisch): Tyndale-Glosse und vollständiger
 *     Abbott-Smith-Eintrag (`meaning`)
 *   - TBESH (Hebräisch): NUR die Tyndale-Glosse. Das TBESH-Bedeutungsfeld ist
 *     "Abridged BDB by Online Bible, © Larry Pierce" und verlangt eine
 *     Erlaubnis („Permission should be gained from Online Bible", Dateikopf);
 *     es wird deshalb bewusst nicht gespeichert.
 *
 * ERGÄNZEND: fasst allein `strong_defs` an.
 */

import { dirname, resolve } from "path";
import { ensureStrongDefsSchema } from "./schema.ts";
import { DB_PATH } from "../db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance, type SourceDigest } from "./provenance.ts";

const DICTS: ReadonlyArray<readonly [prefix: "G" | "H", url: string]> = [
  ["G", "https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js"],
  ["H", "https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js"],
];
const STEP_BASE =
  "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Lexicons/";
// [Präfix, URL, includeMeaning]: Das TBESH-Bedeutungsfeld ist © Online Bible,
// deshalb nur die Glosse.
const STEP_LEXICONS: ReadonlyArray<readonly [prefix: "G" | "H", url: string, includeMeaning: boolean]> = [
  ["G", STEP_BASE + "TBESG%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Greek%20-%20STEPBible.org%20CC%20BY.txt", true],
  ["H", STEP_BASE + "TBESH%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Hebrew%20-%20STEPBible.org%20CC%20BY.txt", false],
];

interface DictEntry {
  readonly lemma?: string;
  readonly translit?: string; // griechisches Wörterbuch
  readonly xlit?: string; // hebräisches Wörterbuch
  readonly strongs_def?: string;
  readonly kjv_def?: string;
}

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

/** Löst das JS-Objektliteral aus `var strongsXxxDictionary = {...};` heraus und parst es. */
function parseDict(js: string): Record<string, DictEntry> {
  const start = js.indexOf("{", js.indexOf("="));
  const end = js.lastIndexOf("};") + 1;
  if (start < 0 || end <= start) throw new Error("Dictionary format changed — no object literal found");
  return JSON.parse(js.slice(start, end)) as Record<string, DictEntry>;
}

/** Glättet das Lexikon-HTML von STEPBible (<b>, <i>, <BR/>, <ref='…'>) zu reinem Text. */
function cleanStepHtml(html: string): string {
  return html
    .replace(/<\/?ref[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n[ \n]*/g, "\n")
    .trim();
}

/**
 * Liest ein Kurzlexikon von STEPBible (TBESG/TBESH). Die Datenzeilen sind TSV:
 * eStrong, dStrong-Bezug, uStrong, Lemma, Transliteration, Morphologie, Glosse,
 * Bedeutung. Eine Strong-Nummer verteilt sich über mehrere Unterscheidungs-
 * zeilen (G0040G, G0040H, …) und kann eine Unterteilung a/b tragen (H0671a).
 * Die erste Zeile je schlichter Nummer ist die Grundbedeutung, spätere Zeilen
 * werden übergangen.
 */
function parseStepLexicon(
  text: string,
  includeMeaning: boolean
): Map<string, { gloss: string; meaning: string }> {
  const out = new Map<string, { gloss: string; meaning: string }>();
  for (const line of text.split("\n")) {
    const m = /^([GH])0*(\d+)[a-z]?\t/.exec(line);
    if (!m) continue;
    const key = m[1]! + m[2]!;
    if (out.has(key)) continue;
    const cols = line.split("\t");
    if (cols.length < 7) {
      throw new Error(`STEPBible row for ${cols[0]} has only ${cols.length} columns — format changed?`);
    }
    out.set(key, {
      gloss: cols[6]!.trim(),
      meaning: includeMeaning ? cleanStepHtml(cols[7] ?? "") : "",
    });
  }
  if (out.size === 0) throw new Error("No STEPBible rows parsed — format changed?");
  return out;
}

export async function main(): Promise<void> {
  console.log("=== Strong's Lexicon (Open Scriptures, Greek + Hebrew) Download ===");
  console.log(`Database: ${DB_PATH}`);

  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
    ensureStrongDefsSchema(db);
    db.exec("DELETE FROM strong_defs");

    const insert = db.prepare(
      "INSERT INTO strong_defs (strong, lemma, translit, definition, kjv) VALUES (?, ?, ?, ?, ?)"
    );
    const digests: SourceDigest[] = [];

    for (const [prefix, url] of DICTS) {
      console.log(`Fetching ${prefix === "G" ? "Greek" : "Hebrew"} dictionary…`);
      const digest = createSourceDigest(url);
      const js = await fetchText(url);
      digest.add(js);
      digests.push(digest);
      const dict = parseDict(js);
      let count = 0;
      db.transaction(() => {
        for (const [key, e] of Object.entries(dict)) {
          if (!/^[GH]\d+$/.test(key)) continue;
          insert.run(
            key,
            e.lemma ?? "",
            e.translit ?? e.xlit ?? "",
            (e.strongs_def ?? "").trim(),
            (e.kjv_def ?? "").trim()
          );
          count++;
        }
      })();
      console.log(`  ${count} ${prefix}-entries stored`);
    }

    // Mit Glossen und Bedeutungen von STEPBible anreichern, und zwar nur für
    // Zeilen, deren Strong-Nummer oben vorkommt: Die erweiterten eStrong-Nummern
    // ab G6000 werden von original_words nie referenziert und fallen weg.
    const update = db.prepare(
      "UPDATE strong_defs SET gloss = ?, meaning = ? WHERE strong = ?"
    );
    for (const [prefix, url, includeMeaning] of STEP_LEXICONS) {
      console.log(`Fetching STEPBible ${prefix === "G" ? "TBESG (Greek)" : "TBESH (Hebrew)"}…`);
      const digest = createSourceDigest(url);
      const text = await fetchText(url);
      digest.add(text);
      digests.push(digest);
      const entries = parseStepLexicon(text, includeMeaning);
      let matched = 0;
      db.transaction(() => {
        for (const [key, e] of entries) {
          if (!key.startsWith(prefix)) continue;
          matched += update.run(e.gloss, e.meaning, key).changes;
        }
      })();
      if (matched < 5000) {
        throw new Error(`Only ${matched} ${prefix}-entries matched strong_defs — format changed?`);
      }
      console.log(`  ${entries.size} entries parsed, ${matched} matched Strong's numbers`);
    }

    const n = (db.query("SELECT COUNT(*) as n FROM strong_defs").get() as { n: number }).n;
    if (n === 0) throw new Error("No entries stored — dictionary format changed?");
    console.log(`\nDone! ${n} Strong's definitions stored.`);

    writeProvenance(db, "download-lexicon.ts", digests);
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
