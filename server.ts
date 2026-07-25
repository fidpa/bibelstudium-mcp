#!/usr/bin/env bun
/**
 * Bibelstudium MCP Server — word-precise Bible study over a local SQLite DB.
 *
 * Six tools (exact German verses, original-language morphology, concordance,
 * cross-references, full-text search, edition comparison) plus three guided
 * prompts. German output fields, English tool names.
 *
 * Translations: four freely licensed German translations (see translations.ts),
 * default Luther 1912. Data is built locally via the download-*.ts scripts.
 *
 * File layout: setup, prepared statements (one section per table), editions,
 * the three morphology decoders, helpers (generic, then per tool), tool
 * registration, guided prompts, dispatch, handlers, bootstrap.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest, GetPromptRequest } from "@modelcontextprotocol/sdk/types.js";
import { Database } from "bun:sqlite";
import { DB_PATH } from "./db-path.ts";
import {
  DEFAULT_TRANSLATION,
  TRANSLATIONS,
  resolveTranslation,
  type TranslationCode,
} from "./translations.ts";

// --- Setup — database connection and integrity check -----------------------
// DB_PATH comes from db-path.ts, which the data-building scripts import too.
// Both sides must name the same file: bible_setup calls those scripts, and if
// they disagreed the download would land where the server never looks.

/**
 * Why a missing database no longer ends the process.
 *
 * Someone who installed the MCPB bundle has no terminal in the loop: exiting
 * here would show them "server disconnected" and nothing else. Instead the
 * server starts against an empty in-memory database, reports `dataMissing`, and
 * offers bible_setup to build the real one. Every other tool refuses with a
 * pointer to it (see handleCallTool).
 *
 * The in-memory schema exists so the prepared statements below can compile; it
 * is never written to and is replaced by a restart once the download finished.
 * Only the three tables the statements require are declared — the optional ones
 * are detected by existence, and their absence is already a supported state.
 */
function emptyDatabase(): Database {
  const mem = new Database(":memory:");
  mem.exec("CREATE TABLE books (book_id INTEGER PRIMARY KEY, name TEXT NOT NULL, chapters INTEGER NOT NULL)");
  mem.exec("CREATE TABLE aliases (alias TEXT PRIMARY KEY COLLATE NOCASE, book_id INTEGER NOT NULL)");
  mem.exec(
    "CREATE TABLE verses (translation TEXT NOT NULL, book_id INTEGER NOT NULL, " +
      "chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL, " +
      "PRIMARY KEY (translation, book_id, chapter, verse))"
  );
  return mem;
}

/** Why the real database cannot be used, or null when it can. */
function databaseProblem(candidate: Database): string | null {
  const tables = new Set(
    (candidate
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>).map((r) => r.name)
  );
  const missing = ["books", "aliases", "verses"].filter((t) => !tables.has(t));
  if (missing.length > 0) {
    return `Der Datenbank fehlen Tabellen (${missing.join(", ")}).`;
  }
  // A verses table from an older single-translation layout lacks the
  // `translation` column; download.ts migrates it on the next run.
  const verseCols = (candidate.query("PRAGMA table_info(verses)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!verseCols.includes("translation")) {
    return "Die Tabelle 'verses' hat keine Spalte 'translation' (alter Aufbau).";
  }
  const verseCount = (candidate.query("SELECT COUNT(*) AS n FROM verses").get() as { n: number }).n;
  if (verseCount === 0) {
    return "Die Datenbank enthält keine Verse.";
  }
  return null;
}

let db: Database;
let dataMissing: string | null = null;
try {
  // No WAL pragma — database is read-only; WAL sidecar files could be tampered with.
  // The download script checkpoints WAL before closing so the DB is self-contained.
  const candidate = new Database(DB_PATH, { readonly: true });
  const problem = databaseProblem(candidate);
  if (problem === null) {
    db = candidate;
    console.error(`Bible DB loaded: ${DB_PATH}`);
  } else {
    candidate.close();
    dataMissing = problem;
    db = emptyDatabase();
    console.error(`${problem} Erwartet unter: ${DB_PATH}`);
  }
} catch (error) {
  dataMissing = "Es ist noch keine Bibeldatenbank vorhanden.";
  db = emptyDatabase();
  console.error(`No Bible database at ${DB_PATH}: ${error}`);
}

if (dataMissing !== null) {
  console.error("Der Server läuft, bis auf bible_setup sind alle Werkzeuge gesperrt.");
}

// --- Prepared statements — books, aliases, verses --------------------------
const stmtAlias = db.prepare<{ book_id: number }, [string]>(
  "SELECT book_id FROM aliases WHERE alias = ? COLLATE NOCASE"
);

const stmtVerses = db.prepare<{ verse: number; text: string }, [string, number, number]>(
  "SELECT verse, text FROM verses WHERE translation = ? AND book_id = ? AND chapter = ? ORDER BY verse"
);

const stmtVerse = db.prepare<{ verse: number; text: string }, [string, number, number, number]>(
  "SELECT verse, text FROM verses WHERE translation = ? AND book_id = ? AND chapter = ? AND verse = ?"
);

const stmtVerseRange = db.prepare<
  { verse: number; text: string },
  [string, number, number, number, number]
>(
  "SELECT verse, text FROM verses WHERE translation = ? AND book_id = ? AND chapter = ? AND verse >= ? AND verse <= ? ORDER BY verse"
);

// Which translations are actually populated (for validation + error messages).
const availableTranslations: Set<string> = new Set(
  (db.query("SELECT DISTINCT translation FROM verses").all() as Array<{
    translation: string;
  }>).map((r) => r.translation)
);

const stmtBookName = db.prepare<{ name: string }, [number]>(
  "SELECT name FROM books WHERE book_id = ?"
);

const stmtBookByName = db.prepare<{ book_id: number }, [string]>(
  "SELECT book_id FROM books WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY book_id LIMIT 1"
);

// --- Original-language (morphology) support --------------------------------
// The `original_words` table is optional; it exists only after
// download-morph.ts has run. Guard so the server still starts without it.
const hasOriginal =
  db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='original_words'"
    )
    .get() !== null;

const stmtOriginal = hasOriginal
  ? db.prepare<
      {
        word_index: number;
        surface: string;
        lemma: string;
        strong: string;
        pos: string;
        parse: string;
        lang: string;
      },
      [string, number, number, number]
    >(
      "SELECT word_index, surface, lemma, strong, pos, parse, lang FROM original_words " +
        "WHERE edition = ? AND book_id = ? AND chapter = ? AND verse = ? ORDER BY word_index"
    )
  : null;

// Which editions are actually populated (for validation + error messages).
const availableEditions: Set<string> = new Set(
  hasOriginal
    ? (db.query("SELECT DISTINCT edition FROM original_words").all() as Array<{
        edition: string;
      }>).map((r) => r.edition)
    : []
);

// Concordance lookups scan one edition's rows (no dedicated index; the DB is
// opened read-only, and a full edition scan is a few ms in local SQLite).
const stmtConcordStrong = hasOriginal
  ? db.prepare<
      { book_id: number; chapter: number; verse: number; surface: string; lemma: string; strong: string },
      [string, string]
    >(
      "SELECT book_id, chapter, verse, surface, lemma, strong FROM original_words " +
        "WHERE edition = ? AND strong = ? ORDER BY book_id, chapter, verse, word_index"
    )
  : null;

const stmtConcordLemma = hasOriginal
  ? db.prepare<
      { book_id: number; chapter: number; verse: number; surface: string; lemma: string; strong: string },
      [string, string]
    >(
      "SELECT book_id, chapter, verse, surface, lemma, strong FROM original_words " +
        "WHERE edition = ? AND lemma = ? ORDER BY book_id, chapter, verse, word_index"
    )
  : null;

// --- Strong's definitions (optional table, download-lexicon.ts) ------------
const hasStrongDefs =
  db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='strong_defs'")
    .get() !== null;

// gloss/meaning are the newer STEPBible columns (meaning is Greek-only, see
// schema.ts). A DB built before that migration lacks them — the DB is opened
// read-only here, so select '' placeholders instead until download-lexicon.ts
// reruns.
const hasStepCols = hasStrongDefs
  ? (db.query("PRAGMA table_info(strong_defs)").all() as Array<{ name: string }>).some(
      (c) => c.name === "gloss"
    )
  : false;
const stmtStrongDef = hasStrongDefs
  ? db.prepare<
      { lemma: string; translit: string; definition: string; kjv: string; gloss: string; meaning: string },
      [string]
    >(
      hasStepCols
        ? "SELECT lemma, translit, definition, kjv, gloss, meaning FROM strong_defs WHERE strong = ?"
        : "SELECT lemma, translit, definition, kjv, '' AS gloss, '' AS meaning FROM strong_defs WHERE strong = ?"
    )
  : null;

// --- TAGNT edition attestation (optional table, download-tagnt.ts) ---------
const hasTagnt =
  db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='tagnt_words'")
    .get() !== null;

const stmtTagnt = hasTagnt
  ? db.prepare<
      {
        surface: string;
        word_type: string;
        editions: string;
        meaning_variant: string;
        spelling_variant: string;
      },
      [number, number, number]
    >(
      "SELECT surface, word_type, editions, meaning_variant, spelling_variant FROM tagnt_words " +
        "WHERE book_id = ? AND chapter = ? AND verse = ? ORDER BY word_index"
    )
  : null;

// --- Full-text search over the German verses (optional FTS5 table) ---------
// `translation` is UNINDEXED in the FTS table; filtering is a plain equality
// post-filter on top of the MATCH.
const hasFts =
  db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='verses_fts'")
    .get() !== null;

const stmtSearchCount = hasFts
  ? db.prepare<{ n: number }, [string, string]>(
      "SELECT COUNT(*) as n FROM verses_fts WHERE verses_fts MATCH ? AND translation = ?"
    )
  : null;
const stmtSearchCountBook = hasFts
  ? db.prepare<{ n: number }, [string, string, number]>(
      "SELECT COUNT(*) as n FROM verses_fts WHERE verses_fts MATCH ? AND translation = ? AND book_id = ?"
    )
  : null;
const stmtSearch = hasFts
  ? db.prepare<
      { book_id: number; chapter: number; verse: number; text: string },
      [string, string, number]
    >(
      "SELECT book_id, chapter, verse, highlight(verses_fts, 0, '⟦', '⟧') as text " +
        "FROM verses_fts WHERE verses_fts MATCH ? AND translation = ? ORDER BY book_id, chapter, verse LIMIT ?"
    )
  : null;
const stmtSearchBook = hasFts
  ? db.prepare<
      { book_id: number; chapter: number; verse: number; text: string },
      [string, string, number, number]
    >(
      "SELECT book_id, chapter, verse, highlight(verses_fts, 0, '⟦', '⟧') as text " +
        "FROM verses_fts WHERE verses_fts MATCH ? AND translation = ? AND book_id = ? ORDER BY chapter, verse LIMIT ?"
    )
  : null;

const stmtSearchAll = hasFts
  ? db.prepare<{ text: string }, [string, string, number]>(
      "SELECT highlight(verses_fts, 0, '⟦', '⟧') as text " +
        "FROM verses_fts WHERE verses_fts MATCH ? AND translation = ? LIMIT ?"
    )
  : null;
const stmtSearchAllBook = hasFts
  ? db.prepare<{ text: string }, [string, string, number, number]>(
      "SELECT highlight(verses_fts, 0, '⟦', '⟧') as text " +
        "FROM verses_fts WHERE verses_fts MATCH ? AND translation = ? AND book_id = ? LIMIT ?"
    )
  : null;

// Occurrence counting reads every matching verse, so it is capped: beyond this
// the field is omitted rather than paid for. Broad queries ("der") hit it,
// word studies never do.
const OCCURRENCE_SCAN_LIMIT = 1000;

// Hit markers must not occur in the verse text itself. The obvious «…» collides
// with the translations' own guillemets — Menge carries them in 8339 verses,
// Schlachter in 887, and they nest the other way round (»quote«), so a closing
// « reads as a marker both to a counter and to a human. ⟦⟧ appears in none of
// the four translations (checked 25.07.2026).
// Must stay identical to the delimiters in the two `highlight()` calls above.
const HIT_OPEN = "⟦";

// --- Cross-references (OpenBible.info / TSK, optional table) ---------------
const hasXrefs =
  db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='cross_references'"
    )
    .get() !== null;

const stmtXrefs = hasXrefs
  ? db.prepare<
      {
        to_book: number;
        to_chapter: number;
        to_verse: number;
        to_chapter_end: number;
        to_verse_end: number;
        votes: number;
      },
      [number, number, number, number]
    >(
      "SELECT to_book, to_chapter, to_verse, to_chapter_end, to_verse_end, votes " +
        "FROM cross_references WHERE from_book = ? AND from_chapter = ? AND from_verse = ? " +
        "ORDER BY votes DESC LIMIT ?"
    )
  : null;

// --- Editions — metadata, aliases, text-type resolution --------------------
const EDITION_META: Record<
  string,
  { label: string; hinweis: string; sprache: string; decoder: "robinson" | "morphgnt" | "hebrew" }
> = {
  byzantine: {
    label: "Byzantinischer Mehrheitstext (Robinson-Pierpont 2005)",
    sprache: "Griechisch (Koine)",
    decoder: "robinson",
    hinweis:
      "Mehrheitstext (Textus-Receptus-Familie, aber breiter bezeugt); enthält z. B. " +
      "kein Comma Johanneum (1Joh 5,7). Von der Mehrheitstext-Position (u. a. R. Liebi) " +
      "als zuverlässiger Grundtext vertreten. " +
      "Das Feld 'wort' ist unakzentuiert gespeichert (so liegt die Quelle vor) — " +
      "beim Zitieren nicht um Akzente oder Interpunktion ergänzen; akzentuiert steht " +
      "der Text nur im SBLGNT (texttyp 'sblgnt').",
  },
  sblgnt: {
    label: "SBL Greek New Testament (kritische Edition)",
    sprache: "Griechisch (Koine)",
    decoder: "morphgnt",
    hinweis:
      "Kritische (eklektische) Edition, Nestle-Aland-nah — nicht Mehrheitstext. " +
      "Bei Lesarten-Fragen den Texttyp beachten; die Morphologie ist davon unberührt.",
  },
  tr: {
    label: "Textus Receptus (Robinson, Scrivener/Stephens-Tradition)",
    sprache: "Griechisch (Koine)",
    decoder: "robinson",
    hinweis:
      "Textus Receptus — die einzige der drei Editionen mit dem Comma Johanneum " +
      "(1Joh 5,7 Langform) und weiteren TR-Sonderlesarten. Zum direkten Lesarten-" +
      "vergleich; die Mehrheitstext-Position sieht den TR als enge Reformationsform " +
      "des Mehrheitstextes, nicht als Grundtext. " +
      "Das Feld 'wort' ist unakzentuiert gespeichert (so liegt die Quelle vor) — " +
      "beim Zitieren nicht um Akzente oder Interpunktion ergänzen.",
  },
  wlc: {
    label: "Westminster Leningrad Codex (masoretisch, OSHB-Morphologie)",
    sprache: "Hebräisch/Aramäisch",
    decoder: "hebrew",
    hinweis:
      "Masoretischer Text (Ben Ascher, Leningrad-Codex). Geschriebener Text = Ketiv " +
      "(die Qere-Lesart der Randmasora ist nicht enthalten). Für das AT die von der " +
      "masoretischen Position (u. a. R. Liebi) getragene Textbasis. " +
      "Das Feld 'wort' enthält Vokal- und Akzentzeichen (Teamim) sowie den " +
      "OSHB-Morphemtrenner '/' zwischen Präfix und Wort (z. B. 'בְּ/רֵאשִׁ֖ית') — beim " +
      "Zitieren weder Zeichen entfernen noch ergänzen.",
  },
};

const EDITION_ALIASES: Record<string, string> = {
  byzantine: "byzantine", byz: "byzantine", mehrheitstext: "byzantine",
  mehrheit: "byzantine", majority: "byzantine", mt: "byzantine",
  sblgnt: "sblgnt", sbl: "sblgnt", kritisch: "sblgnt", "nestle-aland": "sblgnt", na: "sblgnt",
  tr: "tr", textusreceptus: "tr", "textus-receptus": "tr", receptus: "tr", scrivener: "tr",
  wlc: "wlc", masoretisch: "wlc", hebräisch: "wlc", hebraeisch: "wlc", hebrew: "wlc", masoretic: "wlc",
};

// Which editions apply to which testament (book_id 1–39 = OT, 40–66 = NT).
const OT_EDITIONS = new Set(["wlc"]);
const NT_EDITIONS = new Set(["byzantine", "sblgnt", "tr"]);

/** Absent or empty input resolves to byzantine; an unknown alias to null. */
function resolveEdition(input: unknown): string | null {
  if (input === undefined || input === null || input === "") return EDITION_ALIASES["byzantine"]!;
  if (typeof input !== "string") return null;
  return EDITION_ALIASES[input.trim().toLowerCase()] ?? null;
}

// --- Greek morphology — MorphGNT codes (sblgnt) ----------------------------
// A parse code is 8 chars in fixed field order: person, tense, voice, mood,
// case, number, gender, degree; "-" = field not applicable.
const POS_LABELS: Record<string, string> = {
  "N-": "Substantiv", "A-": "Adjektiv", "V-": "Verb", "RA": "Artikel",
  "RP": "Pronomen", "RD": "Demonstrativpronomen", "RI": "Interrog./Indef.-Pronomen",
  "RR": "Relativpronomen", "C-": "Konjunktion", "D-": "Adverb",
  "P-": "Präposition", "I-": "Interjektion", "X-": "Partikel",
};
const PERSON: Record<string, string> = { "1": "1. Person", "2": "2. Person", "3": "3. Person" };
const TENSE: Record<string, string> = {
  P: "Präsens", I: "Imperfekt", F: "Futur",
  A: "Aorist", X: "Perfekt", Y: "Plusquamperfekt",
};
const VOICE: Record<string, string> = { A: "Aktiv", M: "Medium", P: "Passiv" };
const MOOD: Record<string, string> = {
  I: "Indikativ", D: "Imperativ", S: "Konjunktiv",
  O: "Optativ", N: "Infinitiv", P: "Partizip",
};
const GCASE: Record<string, string> = {
  N: "Nominativ", G: "Genitiv", D: "Dativ", A: "Akkusativ", V: "Vokativ",
};
const GNUMBER: Record<string, string> = { S: "Singular", P: "Plural" };
const GENDER: Record<string, string> = { M: "maskulin", F: "feminin", N: "neutrum" };
const DEGREE: Record<string, string> = { C: "Komparativ", S: "Superlativ" };

function decodeParse(parse: string): string {
  const p = parse.padEnd(8, "-");
  const parts: string[] = [];
  const push = (map: Record<string, string>, ch: string | undefined) => {
    if (ch && ch !== "-" && map[ch]) parts.push(map[ch]!);
  };
  push(PERSON, p[0]);
  push(TENSE, p[1]);
  push(VOICE, p[2]);
  push(MOOD, p[3]);
  push(GCASE, p[4]);
  push(GNUMBER, p[5]);
  push(GENDER, p[6]);
  push(DEGREE, p[7]);
  return parts.join(" ");
}

function posLabel(pos: string): string {
  return POS_LABELS[pos] ?? pos;
}

// --- Greek morphology — Robinson codes (byzantine, tr) ---------------------
// Hyphen-separated, e.g. "N-APN", "V-PAM-2P", "T-GSM".
// Format: POS[-tense/voice/mood]-[person][case][number][gender].
const ROB_POS: Record<string, string> = {
  N: "Substantiv", A: "Adjektiv", T: "Artikel", V: "Verb",
  P: "Personalpronomen", R: "Relativpronomen", C: "Reziprok-/Demonstrativpron.",
  D: "Demonstrativpronomen", K: "Korrelativpronomen", I: "Interrogativpronomen",
  X: "Indefinitpronomen", Q: "Korrelativ-/Interrog.-Pron.", F: "Reflexivpronomen",
  S: "Possessivpronomen", ADV: "Adverb", CONJ: "Konjunktion", COND: "Konditional",
  PRT: "Partikel", PREP: "Präposition", INJ: "Interjektion", ARAM: "aramäisch",
  HEB: "hebräisch", "N-PRI": "Eigenname (indekl.)", "A-NUI": "Zahlwort (indekl.)",
};
const ROB_TENSE: Record<string, string> = {
  P: "Präsens", I: "Imperfekt", F: "Futur", A: "Aorist",
  R: "Perfekt", L: "Plusquamperfekt", X: "Perfekt",
  "2A": "Aorist", "2F": "Futur", "2R": "Perfekt", "2P": "Präsens",
};
const ROB_VOICE: Record<string, string> = {
  A: "Aktiv", M: "Medium", P: "Passiv", E: "Medium/Passiv",
  D: "Deponens (Med.)", O: "Deponens (Pass.)", N: "Deponens (Med./Pass.)",
  Q: "unpersönlich", X: "kein",
};
// Robinson mood letters differ from MorphGNT: imperative is "M" (iMperative), not "D".
const ROB_MOOD: Record<string, string> = {
  I: "Indikativ", M: "Imperativ", S: "Konjunktiv",
  O: "Optativ", N: "Infinitiv", P: "Partizip",
};

/** Decode one Robinson morph code (Byzantine edition) into readable German. */
function decodeRobinson(code: string): string {
  const raw = code.trim();
  if (!raw) return "—";
  const parts = raw.split("-");
  const head = parts[0]!;
  const out: string[] = [];

  // Verb: V-<tense+voice+mood>-<person+number> or V-<tvm>-<case+number+gender> (participle)
  if (head === "V") {
    out.push("Verb");
    const tvm = parts[1] ?? "";
    // tense may be 1 or 2 chars ("2A"), then voice (1), then mood (1)
    let i = 0;
    let tense = tvm[i] ?? "";
    if (tense === "2" && tvm[i + 1]) { tense = "2" + tvm[i + 1]; i += 2; } else { i += 1; }
    const voice = tvm[i] ?? ""; i += 1;
    const mood = tvm[i] ?? "";
    if (ROB_TENSE[tense]) out.push(ROB_TENSE[tense]!);
    if (ROB_VOICE[voice]) out.push(ROB_VOICE[voice]!);
    if (ROB_MOOD[mood]) out.push(ROB_MOOD[mood]!);
    const tail = parts[2] ?? "";
    if (mood === "P") {
      // participle: case, number, gender
      if (GCASE[tail[0] ?? ""]) out.push(GCASE[tail[0]!]!);
      if (GNUMBER[tail[1] ?? ""]) out.push(GNUMBER[tail[1]!]!);
      if (GENDER[tail[2] ?? ""]) out.push(GENDER[tail[2]!]!);
    } else if (tail) {
      // finite: person + number
      if (PERSON[tail[0] ?? ""]) out.push(PERSON[tail[0]!]!);
      if (GNUMBER[tail[1] ?? ""]) out.push(GNUMBER[tail[1]!]!);
    }
    return out.join(" ");
  }

  // Non-verb: POS then optional case+number+gender block (e.g. N-APN, T-GSM, A-NPM).
  // Only declinable word classes carry a case/number/gender suffix; for particles,
  // conjunctions etc. a trailing "-N"/"-I" is a function marker (negative/interrog.),
  // not a declension, so it must not be read as a case.
  out.push(ROB_POS[head] ?? head);
  const DECLINABLE = new Set(["N", "A", "T", "P", "R", "C", "D", "K", "I", "X", "Q", "F", "S"]);
  const decl = parts[1] ?? "";
  if (DECLINABLE.has(head) && decl && decl !== "PRI" && decl !== "NUI") {
    // Personal pronoun with leading person digit, e.g. P-1DS, P-2AP
    let d = decl;
    if (/^[123]/.test(d)) { if (PERSON[d[0]!]) out.push(PERSON[d[0]!]!); d = d.slice(1); }
    if (GCASE[d[0] ?? ""]) out.push(GCASE[d[0]!]!);
    if (GNUMBER[d[1] ?? ""]) out.push(GNUMBER[d[1]!]!);
    if (GENDER[d[2] ?? ""]) out.push(GENDER[d[2]!]!);
  }
  return out.join(" ") || "—";
}

// --- Hebrew/Aramaic morphology (OSHB codes) --------------------------------
const HEB_STEM: Record<string, string> = {
  q: "Qal", N: "Nifal", p: "Piel", P: "Pual", h: "Hifil", H: "Hofal",
  t: "Hitpael", o: "Polel", O: "Polal", r: "Hitpolel", m: "Poel", M: "Poal",
  k: "Palel", K: "Pulal", Q: "Qal passiv", l: "Pilpel", L: "Polpal",
  f: "Hitpalpel", D: "Nitpael", j: "Pealal", i: "Pilel", u: "Hotpaal",
  c: "Tifil", v: "Hištafel", w: "Nitpalel", y: "Nitpoel", z: "Hitpoel",
};
const ARC_STEM: Record<string, string> = {
  q: "Peal", Q: "Peil", u: "Hitpeel", p: "Pael", P: "Itpaal", M: "Hitpaal",
  a: "Afel", h: "Hafel", s: "Šafel", e: "Šafel", H: "Hofal", i: "Itpeel",
  t: "Hištafel", v: "Ištafel", w: "Hitafel", o: "Polel", z: "Itpoel",
  r: "Hitpolel", f: "Hitpalpel", b: "Hefal", c: "Tifel", m: "Poel",
  l: "Palpel", L: "Itpalpel", O: "Itpolel", G: "Ittafal",
};
const HEB_CONJ: Record<string, string> = {
  p: "Perfekt", q: "seq. Perfekt", i: "Imperfekt", w: "seq. Imperfekt",
  h: "Kohortativ", j: "Jussiv", v: "Imperativ", r: "Partizip aktiv",
  s: "Partizip passiv", a: "Infinitiv absolut", c: "Infinitiv konstrukt",
};
const HEB_PERSON: Record<string, string> = { "1": "1. Person", "2": "2. Person", "3": "3. Person" };
const HEB_GENDER: Record<string, string> = {
  b: "m./f.", c: "gemeins.", f: "feminin", m: "maskulin",
};
const HEB_NUMBER: Record<string, string> = { s: "Singular", d: "Dual", p: "Plural" };
const HEB_STATE: Record<string, string> = { a: "absolut", c: "konstrukt", d: "determiniert" };
const HEB_ADJ_TYPE: Record<string, string> = {
  a: "Adjektiv", c: "Kardinalzahl", g: "Adjektiv (Gentilicum)", o: "Ordinalzahl",
};
const HEB_PRON_TYPE: Record<string, string> = {
  d: "Demonstrativ", f: "Indefinit", i: "Interrogativ", p: "Personal", r: "Relativ",
};
const HEB_PART_TYPE: Record<string, string> = {
  a: "Affirmation", d: "Artikel", e: "Exhortativ", i: "Interrogativ",
  j: "Interjektion", m: "Demonstrativ", n: "Negation", o: "Objektmarker",
  r: "Relativ",
};
const HEB_SUFF_TYPE: Record<string, string> = {
  d: "Richtungs-He", h: "paragog. He", n: "paragog. Nun", p: "Pronominalsuffix",
};

/** Decode a run of feature chars in a fixed field order (skips 'x' placeholders). */
function hebFeatures(str: string, order: Array<Record<string, string>>): string[] {
  const out: string[] = [];
  for (let i = 0; i < order.length && i < str.length; i++) {
    const ch = str[i]!;
    if (ch === "x") continue;
    const label = order[i]![ch];
    if (label) out.push(label);
  }
  return out;
}

/** Decode one morpheme of an OSHB code (language already stripped). */
function decodeHebMorpheme(code: string, aramaic: boolean): string {
  if (!code) return "";
  const pos = code[0]!;
  const rest = code.slice(1);
  switch (pos) {
    case "C": return "Konjunktion";
    case "D": return "Adverb";
    case "R": return "Präposition" + (rest[0] === "d" ? " (mit Artikel)" : "");
    case "T": return "Partikel" + (HEB_PART_TYPE[rest[0] ?? ""] ? ` (${HEB_PART_TYPE[rest[0]!]})` : "");
    case "N": {
      const type = rest[0] ?? "";
      const head = type === "p" ? "Eigenname" : type === "g" ? "Substantiv (Gentilicum)" : "Substantiv";
      if (type === "p") return head; // proper names carry no further parsing
      return [head, ...hebFeatures(rest.slice(1), [HEB_GENDER, HEB_NUMBER, HEB_STATE])].join(" ");
    }
    case "A": {
      const head = HEB_ADJ_TYPE[rest[0] ?? ""] ?? "Adjektiv";
      return [head, ...hebFeatures(rest.slice(1), [HEB_GENDER, HEB_NUMBER, HEB_STATE])].join(" ");
    }
    case "P": {
      const head = `Pronomen${HEB_PRON_TYPE[rest[0] ?? ""] ? ` (${HEB_PRON_TYPE[rest[0]!]})` : ""}`;
      return [head, ...hebFeatures(rest.slice(1), [HEB_PERSON, HEB_GENDER, HEB_NUMBER])].join(" ");
    }
    case "S": {
      const head = HEB_SUFF_TYPE[rest[0] ?? ""] ?? "Suffix";
      return [head, ...hebFeatures(rest.slice(1), [HEB_PERSON, HEB_GENDER, HEB_NUMBER])].join(" ");
    }
    case "V": {
      const stem = (aramaic ? ARC_STEM : HEB_STEM)[rest[0] ?? ""] ?? rest[0] ?? "";
      const conjCh = rest[1] ?? "";
      const conj = HEB_CONJ[conjCh] ?? "";
      const feats = rest.slice(2);
      let tail: string[];
      if (conjCh === "r" || conjCh === "s") {
        tail = hebFeatures(feats, [HEB_GENDER, HEB_NUMBER, HEB_STATE]); // participle
      } else if (conjCh === "a" || conjCh === "c") {
        tail = []; // infinitive
      } else {
        tail = hebFeatures(feats, [HEB_PERSON, HEB_GENDER, HEB_NUMBER]); // finite
      }
      return ["Verb", stem, conj, ...tail].filter(Boolean).join(" ");
    }
    default: return pos;
  }
}

/** Decode a full OSHB morph string ("HR/Ncfsa" → "Präposition + Substantiv feminin Singular absolut"). */
function decodeHebrew(morph: string): string {
  if (!morph) return "—";
  const aramaic = morph[0] === "A";
  const body = morph.replace(/^[HA]/, "");
  const pieces = body.split("/").map((m) => decodeHebMorpheme(m, aramaic)).filter(Boolean);
  return pieces.join(" + ") || "—";
}

// --- Generic helpers — tool results, text, argument coercion ---------------
function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

/** Strip leftover HTML tags (e.g. <i> on psalm superscriptions). */
function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

// Words in square brackets are part of the edition's wording, not something this
// server added: Menge sets explanatory additions this way (137 verses; the other
// three translations use none, and none of the four carries footnote digits, so
// there is no numeric counterpart to distinguish here). Measured in the upstream
// repo on 25.07.2026: asked for a verse carrying such brackets, a client that had
// called the tool unwrapped them, turning an addition of the edition into plain
// text. No sample word in the hint on purpose — a concrete example has once been
// picked up as a label and pinned to the wrong case (see AGENTS.md).
const BRACKET_WORD_RE = /\[(?!\d+\])[^\]]+\]/;
const BRACKET_WORD_HINT =
  "Wörter in eckigen Klammern gehören zum Wortlaut der Übersetzung und sind " +
  "keine Einfügung dieses Servers. Beim Zitieren entfallen sie nicht: ohne die " +
  "Klammern steht der Einschub da wie der übrige Text, und die Ausgabe setzt " +
  "ihn gerade ab.";

/** Hint if any of `texts` carries bracketed words; empty otherwise. */
function bracketHints(texts: readonly string[]): string[] {
  return texts.some((t) => BRACKET_WORD_RE.test(t)) ? [BRACKET_WORD_HINT] : [];
}

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

/**
 * Accept an integer given as a number or digit string. MCP clients (LLMs)
 * regularly send "3" where the schema says number; be lenient rather than fail.
 */
function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return null;
}

// --- Book resolution and "not found" errors (all six tools) ----------------
function resolveBook(book: string): number | null {
  const normalized = book.trim().toLowerCase();

  // Try exact alias match first
  const aliasResult = stmtAlias.get(normalized);
  if (aliasResult) return aliasResult.book_id;

  // Try fuzzy match on full book names (LIKE '%search%')
  const nameResult = stmtBookByName.get(`%${escapeLike(normalized)}%`);
  if (nameResult) return nameResult.book_id;

  return null;
}

function getBookDisplayName(bookId: number): string {
  const result = stmtBookName.get(bookId);
  return result?.name ?? `Buch ${bookId}`;
}

let aliasCache: Array<{ alias: string; book_id: number }> | null = null;

// Deuterocanonical/apocryphal books, so a miss on them can be answered
// precisely instead of guessed at. Without this "Sirach" scored an edit
// distance of 2 against the alias "sach" and came back as "Meinten Sie
// Sacharja?" — a wrong answer dressed as a helpful one (25.07.2026).
// "zusatz" alone is too broad — it swallowed "Hesekiel-Zusatz", which is not an
// apocryphal book at all (there is none for Ezekiel) and is better served by the
// near-match suggestion. Only the actual titles count.
const APOKRYPHEN =
  /\b(tobit|tobias|judit|sirach|ecclesiasticus|weisheit salomos|baruch|makkab|manasse|esra\s*[34]|susanna|bel und|asarja|zus(a|ä)tze?\s+zu\s+(daniel|est(h)?er))/i;

/** Levenshtein distance, capped — only small distances interest us. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Nearest known book for an unresolved name, or null.
 *
 * Two cases seen in practice: a known book carrying an extra qualifier
 * ("Hesekiel-Zusatz" → Hesekiel) and a plain typo ("Hesekil"). The first is a
 * containment test, the second an edit distance of at most 2. Suggest only —
 * never resolve to it, or the answer silently covers a different book than the
 * one asked for.
 */
function suggestBook(book: string): string | null {
  const q = book.trim().toLowerCase();
  if (q.length < 3) return null;
  aliasCache ??= db.query("SELECT alias, book_id FROM aliases").all() as Array<{
    alias: string;
    book_id: number;
  }>;

  let best: { alias: string; book_id: number; score: number } | null = null;
  for (const row of aliasCache) {
    if (row.alias.length < 3) continue;
    let score: number;
    if (q.includes(row.alias)) {
      score = 100 - row.alias.length; // longest contained alias wins
    } else {
      // A distance of 2 is only meaningful on longer names: on a four-letter
      // alias it relates almost anything to anything.
      const d = editDistance(q, row.alias);
      const erlaubt = d <= 1 || (d === 2 && Math.min(q.length, row.alias.length) >= 6);
      if (!erlaubt) continue;
      score = 200 + d;
    }
    if (best === null || score < best.score) {
      best = { alias: row.alias, book_id: row.book_id, score };
    }
  }
  return best === null ? null : getBookDisplayName(best.book_id);
}

/**
 * Uniform "book not found" error: names the nearest known book when there is
 * one, and states the canon scope. Without the scope note a miss on "Sirach"
 * looks like a typo rather than a book this DB does not carry (66 books,
 * protestant canon) — the caller cannot tell the two apart from "not found".
 */
function bookNotFound(book: string): ReturnType<typeof errorResult> {
  if (APOKRYPHEN.test(book)) {
    return errorResult(
      `"${book}" gehört zu den apokryphen/deuterokanonischen Schriften. Diese ` +
        "Datenbank enthält ausschließlich die 66 Bücher des protestantischen Kanons — " +
        "Sirach, Tobit, Judit, Weisheit, Baruch, die Makkabäerbücher und die Zusätze zu " +
        "Daniel und Ester sind nicht enthalten. Kein Tippfehler und kein ähnlich " +
        "klingendes Buch des Kanons meinen."
    );
  }
  // Lead with the statement, not with "Error:". The apocrypha branch above
  // opens with a fact and gets relayed; this branch opened with "Error: Book …
  // not found" and was dropped as a failed call, suggestion and all
  // (25.07.2026, "Hesekiel-Zusatz"). Same lesson as `quellenkonflikte`.
  const nahe = suggestBook(book);
  return errorResult(
    `"${book}" ist kein Buch dieser Bibel-Datenbank.` +
      (nahe !== null
        ? ` Am nächsten kommt "${nahe}" — falls das gemeint war, damit erneut abfragen.`
        : "") +
      " Diese Datenbank enthält die 66 Bücher des protestantischen Kanons; apokryphe/" +
      "deuterokanonische Schriften fehlen. Erwartet wird der deutsche Buchname " +
      '(z. B. "Jesaja", "1. Mose", "Römer") oder eine Abkürzung (z. B. "Jes", "1Mo", "Röm").'
  );
}

// Reference bounds. Shared so that the limit and the message that reports it
// cannot drift apart: three handlers used to reject `verse=999` with "must be a
// positive integer", which names a condition the input satisfies (25.07.2026).
const MAX_CHAPTER = 150; // Psalms has the most chapters (150)
const MAX_VERSE = 200; // Longest chapter (Psalm 119) has 176 verses
const chapterOutOfRange = `Error: 'chapter' must be an integer between 1 and ${MAX_CHAPTER}`;
const verseOutOfRange = `Error: 'verse' must be an integer between 1 and ${MAX_VERSE}`;

// --- bible_lookup helpers --------------------------------------------------
/**
 * Parse a verse reference string like "4", "16-17", "1,3,5", "1-3,7".
 * Returns an array of individual verse numbers.
 */
function parseVerses(versesStr: string): number[] {
  const MAX_PARTS = 30; // Limit comma-separated segments to prevent excessive DB queries
  const verses: number[] = [];
  const parts = versesStr.split(",").map((p) => p.trim()).slice(0, MAX_PARTS);

  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr ?? "", 10);
      const end = parseInt(endStr ?? "", 10);
      if (!isNaN(start) && !isNaN(end) && start >= 1 && end >= 1 && start <= end && end <= MAX_VERSE) {
        for (let v = start; v <= end; v++) {
          verses.push(v);
        }
      }
    } else {
      const v = parseInt(part, 10);
      if (!isNaN(v) && v >= 1 && v <= MAX_VERSE) {
        verses.push(v);
      }
    }
  }

  // Dedupe and sort ascending so the returned text matches the canonical
  // order of the formatted reference ("5,3,3" → verses 3 and 5, once each).
  return [...new Set(verses)].sort((a, b) => a - b);
}

function lookupVerses(
  translation: TranslationCode,
  bookId: number,
  chapter: number,
  versesStr: string
): ReadonlyArray<{ verse: number; text: string }> {
  // If no specific verses requested, return entire chapter
  if (!versesStr || versesStr.trim() === "") {
    return stmtVerses.all(translation, bookId, chapter);
  }

  // Check if it's a simple range (e.g., "3-7") — use range query for efficiency
  const rangeMatch = versesStr.trim().match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]!, 10);
    const end = parseInt(rangeMatch[2]!, 10);
    return stmtVerseRange.all(translation, bookId, chapter, start, end);
  }

  // Parse complex verse references and query individually
  const verseNums = parseVerses(versesStr);
  const results: Array<{ verse: number; text: string }> = [];
  for (const v of verseNums) {
    const row = stmtVerse.get(translation, bookId, chapter, v);
    if (row) {
      results.push(row);
    }
  }
  return results;
}

/**
 * Format verse numbers into a compact reference string.
 * [1,2,3,5,7,8,9] → "1-3.5.7-9"
 */
function formatVerseReference(verses: number[]): string {
  if (verses.length === 0) return "";
  if (verses.length === 1) return String(verses[0]);

  const sorted = [...verses].sort((a, b) => a - b);
  const ranges: string[] = [];
  let rangeStart = sorted[0]!;
  let rangePrev = sorted[0]!;

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    if (current === rangePrev + 1) {
      rangePrev = current;
    } else {
      ranges.push(rangeStart === rangePrev ? String(rangeStart) : `${rangeStart}-${rangePrev}`);
      rangeStart = current;
      rangePrev = current;
    }
  }
  ranges.push(rangeStart === rangePrev ? String(rangeStart) : `${rangeStart}-${rangePrev}`);

  return ranges.join(".");
}

/**
 * Resolve a `translation` tool argument to a loaded translation code, or an
 * error message for the caller to return.
 */
function requireTranslation(input: unknown): { code: TranslationCode } | { error: string } {
  const code = resolveTranslation(input);
  if (code === null) {
    return {
      error:
        `Error: Unknown translation "${String(input)}". Allowed: ` +
        Object.entries(TRANSLATIONS)
          .map(([c, m]) => `"${c}" (${m.name})`)
          .join(", ") +
        ".",
    };
  }
  if (!availableTranslations.has(code)) {
    return {
      error:
        `Übersetzung "${code}" (${TRANSLATIONS[code].name}) ist nicht geladen. ` +
        `Bitte 'bun run download ${code}' ausführen. Geladen: ` +
        `${[...availableTranslations].join(", ") || "keine"}.`,
    };
  }
  return { code };
}

// --- bible_concordance helpers ---------------------------------------------
// Lemma strings with combining marks (Hebrew niqqud, Greek accents) can differ
// in code-point order between the stored data and a caller's input while being
// canonically equivalent. Resolve such misses via a lazy per-edition map of
// NFC-normalized → stored lemma (built once per edition, ~10k entries).
const lemmaIndexCache = new Map<string, Map<string, string>>();
function findStoredLemma(edition: string, lemma: string): string | null {
  let idx = lemmaIndexCache.get(edition);
  if (idx === undefined) {
    idx = new Map();
    const rows = db
      .query("SELECT DISTINCT lemma FROM original_words WHERE edition = ?")
      .all(edition) as Array<{ lemma: string }>;
    for (const r of rows) idx.set(r.lemma.normalize("NFC"), r.lemma);
    lemmaIndexCache.set(edition, idx);
  }
  return idx.get(lemma.normalize("NFC")) ?? null;
}

// --- bible_search helpers --------------------------------------------------
/**
 * Turn free-form user input into a safe FTS5 MATCH expression.
 * Quoted segments become phrases; bare words are ANDed; a trailing `*` on a
 * word makes it a prefix query. Returns null if no searchable token remains.
 */
function buildFtsQuery(input: string): string | null {
  const terms: string[] = [];
  const parts = input.split('"');
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if (i % 2 === 1) {
      // inside quotes → one phrase
      const words = seg.match(/[\p{L}\p{N}]+/gu) ?? [];
      if (words.length > 0) terms.push(`"${words.join(" ")}"`);
    } else {
      for (const m of seg.matchAll(/([\p{L}\p{N}]+)(\*)?/gu)) {
        terms.push(m[2] ? `"${m[1]}" *` : `"${m[1]}"`);
      }
    }
  }
  return terms.length > 0 ? terms.join(" ") : null;
}

// --- bible_compare helpers -------------------------------------------------
/**
 * Normalize a Greek surface form for edition comparison: strip diacritics,
 * lowercase, fold final sigma. byzantine/tr are stored unaccented, sblgnt is
 * accented — without this every word pair would differ.
 */
function normForCompare(w: string): string {
  return w
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ");
}

/**
 * LCS word diff between two editions of a verse. Compares normalized forms,
 * reports original surfaces. Each segment holds the differing run of words on
 * either side ("" = missing on that side).
 */
function diffSegments(aWords: string[], bWords: string[]): Array<{ a: string; b: string }> {
  const an = aWords.map(normForCompare);
  const bn = bWords.map(normForCompare);
  const m = an.length;
  const n = bn.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = an[i] === bn[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const segs: Array<{ a: string[]; b: string[] }> = [];
  let cur: { a: string[]; b: string[] } | null = null;
  const flush = (): void => {
    if (cur) { segs.push(cur); cur = null; }
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (an[i] === bn[j]) {
      flush();
      i++; j++;
    } else {
      cur ??= { a: [], b: [] };
      if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { cur.a.push(aWords[i]!); i++; }
      else { cur.b.push(bWords[j]!); j++; }
    }
  }
  if (i < m || j < n) {
    cur ??= { a: [], b: [] };
    while (i < m) cur.a.push(aWords[i++]!);
    while (j < n) cur.b.push(bWords[j++]!);
  }
  flush();
  return segs.map((s) => ({ a: s.a.join(" "), b: s.b.join(" ") }));
}

/** TAGNT's witness label per edition loaded here; its other six have no local text. */
const TAGNT_LABEL: Record<string, string> = {
  byzantine: "Byz",
  tr: "TR",
  sblgnt: "SBL",
};

const TAGNT_WITNESS_RE = /\b(?:NA28|NA27|Tyn|SBL|WH|Treg|TR|Byz)\b/g;
const GREEK_RUN_RE = /\p{Script=Greek}+/gu;

/**
 * Greek letters only. The Script=Greek range also carries non-letters — koronis
 * ᾽ (U+1FBD) marks elision ("ἀλλ᾽") and would otherwise ride along into the
 * compared form, so "ἀλλ᾽" never matched the stored "αλλ".
 */
function greekLettersOnly(s: string): string {
  return (s.match(GREEK_RUN_RE) ?? []).join("").replace(/[^\p{L}]/gu, "");
}

/**
 * True when two normalized forms differ only by an elided final vowel
 * ("αλλ" ↔ "αλλα", "αφ" ↔ "απο" is NOT this case). Editions elide by different
 * conventions, so such a pair is an orthographic split, not a textual variant —
 * worth showing in `in_dieser_db`, not worth warning about.
 */
function istElision(a: string, b: string): boolean {
  const [kurz, lang] = a.length <= b.length ? [a, b] : [b, a];
  return lang.length === kurz.length + 1 && lang.startsWith(kurz) && /[αεηιουω]$/.test(lang);
}

/**
 * Cross-check a TAGNT variant note against the edition texts in this DB.
 *
 * TAGNT notes name only the witnesses its own apparatus records for a variant.
 * At 1Tim 3,16 that is "TR: ἀνελήφθη ;" — which reads as though every other
 * edition, Byz included, had the headword ἀνελήμφθη. The Robinson-Pierpont text
 * stored here reads ἀνελήφθη too, so the note alone leads to the wrong
 * conclusion about the Majority Text (measured 24.07.2026: over 362 random NT
 * verses note and edition text disagree in 11 %). Report which loaded edition
 * actually attests which form, straight from `original_words`, and flag the
 * disagreements.
 */
function crossCheckVariant(
  note: string,
  headword: string,
  texts: Array<{ ed: string; words: string[] }>
): { belege: Record<string, string[]>; abgleich: string[] } | undefined {
  const head = greekLettersOnly(headword);
  if (head === "") return undefined;

  // One ";"-separated segment per variant: its witnesses and its Greek form.
  const varianten = note
    .split(";")
    .map((seg) => ({
      zeugen: new Set(seg.match(TAGNT_WITNESS_RE) ?? []),
      form: (seg.match(GREEK_RUN_RE) ?? [])
        .map((f) => f.replace(/[^\p{L}]/gu, ""))
        .find((f) => f.length > 1),
    }))
    .filter(
      (v): v is { zeugen: Set<string>; form: string } =>
        v.form !== undefined && normForCompare(v.form) !== normForCompare(head)
    );

  const liest = (form: string): string[] => {
    const n = normForCompare(form);
    return texts.filter((t) => t.words.some((w) => normForCompare(w) === n)).map((t) => t.ed);
  };

  const belege: Record<string, string[]> = {};
  for (const form of [head, ...varianten.map((v) => v.form)]) {
    const eds = liest(form);
    if (eds.length > 0) belege[form] = eds;
  }
  if (Object.keys(belege).length === 0) return undefined;

  const abgleich: string[] = [];
  for (const v of varianten) {
    if (istElision(normForCompare(v.form), normForCompare(head))) continue;
    for (const t of texts) {
      const label = TAGNT_LABEL[t.ed];
      if (label === undefined) continue;
      const liestVariante = liest(v.form).includes(t.ed);
      const genannt = v.zeugen.has(label);
      // Lead with what the edition reads, then the note it contradicts. Phrased
      // the other way round ("TAGNT nennt … — der Text liest anders") it reads
      // as a remark about data quality and gets dropped when the finding is
      // retold; Mk 14,46 was reported twice without it (25.07.2026).
      const liesForm = liest(v.form).includes(t.ed) ? v.form : head;
      if (liestVariante && !genannt) {
        abgleich.push(
          `${t.ed} liest hier "${liesForm}" — die TAGNT-Notiz führt dafür nur ` +
            `${[...v.zeugen].join("+") || "keine Edition"} als Zeugen. Für diese Edition gilt ` +
            "der Editionstext."
        );
      } else if (!liestVariante && genannt) {
        abgleich.push(
          `${t.ed} liest hier "${liesForm}", nicht "${v.form}" — die TAGNT-Notiz nennt ` +
            `${label} jedoch als Zeugen für "${v.form}". Für diese Edition gilt der Editionstext.`
        );
      }
    }
  }
  return { belege, abgleich };
}


// All six tools only read: one local SQLite file opened read-only, no writes,
// no side effects, no network. Both spec defaults are wrong here (readOnlyHint
// defaults to false, openWorldHint to true), so both are stated. destructiveHint
// and idempotentHint stay out on purpose — the schema defines them as meaningful
// only when readOnlyHint is false.
const READ_ONLY_LOCAL = { readOnlyHint: true, openWorldHint: false } as const;

// bible_setup is the one tool that writes: it downloads the Bible data and
// replaces the database file. readOnlyHint and openWorldHint are therefore both
// wrong for it, and destructiveHint becomes meaningful — it only ever adds data,
// and running it again rebuilds the same tables, so it is neither destructive
// nor harmful to repeat.
const SETUP_ANNOTATIONS = {
  readOnlyHint: false,
  openWorldHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

const handleListTools = async () => ({
  tools: [
    // Advertised only while data is missing: once the database is in place this
    // tool has nothing to offer, and a visible "set up the database" action
    // invites a model to re-run downloads that already succeeded.
    ...(dataMissing !== null
      ? [
          {
            name: "bible_setup",
            annotations: SETUP_ANNOTATIONS,
            description:
              "Download the Bible data this server needs. The database is not shipped with " +
              "the server and has to be built once from the original sources; it takes about " +
              "a minute and needs an internet connection. " +
              "Call this only after the user has explicitly agreed to start the download: " +
              "ask first, then pass bestaetigung=true. Without that flag the tool only " +
              "reports what would be downloaded.",
            inputSchema: {
              type: "object" as const,
              properties: {
                bestaetigung: {
                  type: "boolean" as const,
                  description:
                    "Set to true only when the user has agreed to start the download now. " +
                    "Omit it to get the plan without downloading anything.",
                },
              },
            },
          },
        ]
      : []),
    {
      name: "bible_lookup",
      annotations: READ_ONLY_LOCAL,
      // The "quotes" framing alone was read as covering only requests for
      // wording: "Schlag mir Hesekiel-Zusatz 1,1 nach" was answered from memory
      // because the book seemed not to exist, so no quote was expected
      // (25.07.2026). Existence and canon questions are exactly the ones the
      // server can settle — say so.
      description:
        "Look up Bible verses by reference. Returns exact text from a freely licensed German " +
        "translation (default: Luther 1912). Use this for ALL Bible quotes — never quote " +
        "from memory. " +
        "Also call it when a book or reference looks unfamiliar, misspelled or made up, " +
        "and before answering whether a book exists or belongs to the canon: the error " +
        "names the nearest known book and states which canon this database covers. " +
        "Do not answer such questions from memory either — a reference that seems wrong " +
        "is a reason to call this tool, not to skip it.",
      inputSchema: {
        type: "object" as const,
        properties: {
          book: {
            type: "string",
            description:
              'Book name in German (e.g. "Jesaja", "1. Mose", "Römer", "Ps", "Mt")',
          },
          chapter: {
            type: "number",
            description: "Chapter number",
          },
          verses: {
            type: "string",
            description:
              'Verse(s): single "4", range "16-17", list "1,3,5", or combined "1-3,7". Omit for full chapter.',
          },
          translation: {
            type: "string",
            description:
              'Translation: "LUT" (Luther 1912, default), "SCH" (Schlachter 1951), ' +
              '"ELB" (Elberfelder 1871), "MB" (Menge). Aliases like "luther", "schlachter" accepted.',
            default: "LUT",
          },
        },
        required: ["book", "chapter"],
      },
    },
    {
      name: "bible_original",
      annotations: READ_ONLY_LOCAL,
      description:
        "Return one Bible verse word-by-word in the ORIGINAL language with lemma, Strong's " +
        "number and full morphology. Use this to verify what the original text says — e.g. " +
        "whether a noun is singular or plural — instead of inferring it from a translation. " +
        "Covers the whole Bible: the OT (book 1–39) is served from the Hebrew/Aramaic " +
        "Westminster Leningrad Codex; the NT (40–66) from a Greek text type chosen via " +
        '`texttyp` — "byzantine" (Majority Text, default), "sblgnt" (critical), or "tr" ' +
        "(Textus Receptus, the only one with the Comma Johanneum). Edition and text type are " +
        "labelled in the output.",
      inputSchema: {
        type: "object" as const,
        properties: {
          book: {
            type: "string",
            description: 'Book name in German (e.g. "1. Mose", "Jesaja", "Römer", "Galater")',
          },
          chapter: { type: "number", description: "Chapter number" },
          verse: { type: "number", description: "Single verse number" },
          texttyp: {
            type: "string",
            description:
              'NT text edition: "byzantine" (Majority Text, default), "sblgnt" (critical SBL), ' +
              'or "tr" (Textus Receptus). Ignored for the OT (always Hebrew WLC). Compare ' +
              "byzantine vs. tr to see TR-only readings such as the Comma Johanneum (1Joh 5,7).",
            default: "byzantine",
          },
        },
        required: ["book", "chapter", "verse"],
      },
    },
    {
      name: "bible_crossrefs",
      annotations: READ_ONLY_LOCAL,
      description:
        "Find cross-references (related/parallel passages) for one Bible verse, ranked by " +
        "relevance votes, each with its German text (default: Luther 1912). Use this to find " +
        "where a theme, quote or promise recurs elsewhere in Scripture. Data: Treasury of " +
        "Scripture Knowledge (expanded), OpenBible.info, CC-BY.",
      inputSchema: {
        type: "object" as const,
        properties: {
          book: {
            type: "string",
            description: 'Book name in German (e.g. "Jesaja", "1. Mose", "Römer")',
          },
          chapter: { type: "number", description: "Chapter number" },
          verse: { type: "number", description: "Single verse number" },
          limit: {
            type: "number",
            description: "Maximum number of references to return (default 10, max 30)",
            default: 10,
          },
          translation: {
            type: "string",
            description:
              'Translation for the quoted target texts: "LUT" (default), "SCH", "ELB", "MB".',
            default: "LUT",
          },
        },
        required: ["book", "chapter", "verse"],
      },
    },
    {
      name: "bible_concordance",
      annotations: READ_ONLY_LOCAL,
      description:
        "Concordance / word study: find ALL occurrences of an original-language word across " +
        'the Bible. Search by Strong\'s number (preferred; "G26" = Greek/NT, "H7225" = ' +
        "Hebrew/OT) or by exact lemma as returned by bible_original (e.g. \"ἀγάπη\", " +
        '"רֵאשִׁית"). Returns total count, per-book distribution, an occurrence list with ' +
        "the inflected surface forms, and English lexicon data (gloss, Strong's definition; " +
        "for Greek also the full Abbott-Smith entry). NT edition selectable via texttyp " +
        "(default byzantine).",
      inputSchema: {
        type: "object" as const,
        properties: {
          strong: {
            type: "string",
            description: 'Strong\'s number with testament prefix, e.g. "G26" or "H7225"',
          },
          lemma: {
            type: "string",
            description:
              "Exact Greek or Hebrew lemma (alternative to strong; script determines testament)",
          },
          texttyp: {
            type: "string",
            description:
              'NT text edition: "byzantine" (default), "sblgnt", or "tr". Ignored for Hebrew.',
            default: "byzantine",
          },
          limit: {
            type: "number",
            description: "Maximum occurrences to list (default 50, max 200); counts are always exact",
            default: 50,
          },
        },
        required: [],
      },
    },
    {
      name: "bible_search",
      annotations: READ_ONLY_LOCAL,
      description:
        "Full-text search over the German Bible text (default: Luther 1912). Finds verses " +
        "containing ALL given words (exact word forms; umlauts/accents are folded, so 'fuhrt' " +
        'matches "führt"). Quote phrases ("Gnade um Gnade"); a trailing * makes a prefix ' +
        "search (lieb* finds liebe/lieben/liebet …). Use this to locate a passage when the " +
        "wording is known but the reference is not. Optionally restrict to one book.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: 'Words or "phrases" to search for, e.g. \'Hirte mangeln\' or \'"Gnade um Gnade"\'',
          },
          book: {
            type: "string",
            description: 'Optional: restrict to one book (German name, e.g. "Psalmen", "Röm")',
          },
          limit: {
            type: "number",
            description: "Maximum verses to return (default 10, max 50); the total count is always exact",
            default: 10,
          },
          translation: {
            type: "string",
            description: 'Translation to search: "LUT" (default), "SCH", "ELB", "MB".',
            default: "LUT",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "bible_compare",
      annotations: READ_ONLY_LOCAL,
      description:
        "Compare one NT verse word-by-word across the Greek editions (byzantine Majority Text, " +
        "tr Textus Receptus, sblgnt critical text) and list the textual differences. " +
        "Accentuation/case are ignored (byzantine/tr are stored unaccented), so reported " +
        "differences are real variants or spelling variants (e.g. movable Ny). Additionally " +
        "reports per-word attestation across eight editions (NA27/28, Tyndale House, SBL, " +
        "Westcott-Hort, Tregelles, TR, Byzantine; STEPBible TAGNT). Use for questions about " +
        "textual variants (e.g. the Comma Johanneum, 1Jn 5:7). OT verses have only one " +
        "edition (WLC) and cannot be compared.",
      inputSchema: {
        type: "object" as const,
        properties: {
          book: {
            type: "string",
            description: 'NT book name in German (e.g. "Römer", "1Joh")',
          },
          chapter: { type: "number", description: "Chapter number" },
          verse: { type: "number", description: "Single verse number" },
        },
        required: ["book", "chapter", "verse"],
      },
    },
  ],
});

// --- MCP server — guided prompts -------------------------------------------
// Workflow prompts that orchestrate the six tools. Names/descriptions are
// English (like the tool names); the prompt bodies are German user-facing
// content, matching the German output fields.

const PROMPTS = [
  {
    name: "word-study",
    description:
      "Guided original-language word study: from a German word, lemma or Strong's number " +
      "to meaning spectrum, distribution and key passages.",
    arguments: [
      {
        name: "word",
        description: "German word, Greek/Hebrew lemma, or Strong's number (e.g. G26)",
        required: true,
      },
      {
        name: "reference",
        description: 'Optional Bible reference as starting point (e.g. "Johannes 3,16")',
        required: false,
      },
    ],
  },
  {
    name: "variant-check",
    description:
      "Guided text-critical check of one NT verse: edition diff, eight-edition attestation, " +
      "sober assessment.",
    arguments: [
      {
        name: "reference",
        description: 'NT verse reference (e.g. "1. Johannes 5,7")',
        required: true,
      },
    ],
  },
  {
    name: "translation-compare",
    description:
      "Compare one passage across all loaded German translations and check notable " +
      "renderings against the original text.",
    arguments: [
      {
        name: "reference",
        description: 'Bible reference (e.g. "Psalm 23,1" or "Römer 8,1")',
        required: true,
      },
    ],
  },
] as const;

const handleListPrompts = async () => ({
  prompts: PROMPTS.map((p) => ({ ...p, arguments: [...p.arguments] })),
});

const handleGetPrompt = async (request: GetPromptRequest) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, string>;

  let text: string;
  if (name === "word-study") {
    const word = args.word ?? "";
    const ref = args.reference ?? "";
    text =
      `Führe eine Wortstudie zu „${word}" durch. Arbeite ausschließlich mit den Bibelstudium-Tools — zitiere keinen Bibeltext aus dem Gedächtnis.\n\n` +
      `1. Bestimme das Urtext-Wort: ${ref ? `Rufe bible_original für ${ref} ab und identifiziere dort das Wort (Grundform + Strong-Nummer).` : `Ist „${word}" bereits eine Strong-Nummer oder ein griechisches/hebräisches Lemma, nutze es direkt. Ist es ein deutsches Wort, finde über bible_search eine typische Belegstelle und rufe für sie bible_original ab.`}\n` +
      `2. Rufe bible_concordance mit der Strong-Nummer ab: Gesamtzahl, Buchverteilung, Beugungsformen, Lexikon-Daten (Gloss, Definition, bei Griechisch Abbott-Smith).\n` +
      `3. Wähle 2–3 theologisch gewichtige Vorkommen und rufe für sie bible_lookup (Wortlaut) und bible_crossrefs (Parallelstellen) ab.\n` +
      `4. Fasse das Bedeutungsspektrum zusammen: Grundbedeutung, Bedeutungsnuancen nach Kontext, auffällige Verteilung. Belege jede Aussage mit einer konkret abgerufenen Stelle; kennzeichne offene Fragen als offen.`;
  } else if (name === "variant-check") {
    const ref = args.reference ?? "";
    text =
      `Prüfe die Textüberlieferung von ${ref}. Arbeite ausschließlich mit den Bibelstudium-Tools — keine Behauptungen ohne Tool-Beleg.\n\n` +
      `1. Rufe bible_compare für ${ref} ab: Wort-Diff über Mehrheitstext, Textus Receptus und SBLGNT sowie die Bezeugung pro Wort über acht Editionen (Feld „bezeugung").\n` +
      `2. Bei relevanten Unterschieden: Rufe bible_original für ${ref} mit jedem betroffenen texttyp ab (byzantine, tr, sblgnt), um die Lesarten im Wortlaut zu sehen.\n` +
      `3. Rufe bible_lookup für ${ref} ab und prüfe, welcher Lesart der deutsche Text folgt.\n` +
      `4. Ordne nüchtern ein: Welche Editionen bezeugen welche Lesart (N/K/O-Typ beachten: Kleinbuchstaben = ohne Übersetzungsrelevanz)? Ändert die Variante die Aussage des Verses? Keine Wertung über „besser/schlechter" ohne Datengrundlage — benenne nur, was die Editionen tatsächlich lesen.`;
  } else if (name === "translation-compare") {
    const ref = args.reference ?? "";
    text =
      `Vergleiche die deutschen Übersetzungen von ${ref}. Arbeite ausschließlich mit den Bibelstudium-Tools.\n\n` +
      `1. Rufe bible_lookup für ${ref} mit jeder geladenen Übersetzung ab (translation: "LUT", "SCH", "ELB", "MB").\n` +
      `2. Stelle die Wortlaute gegenüber und benenne die Unterschiede (Wortwahl, Satzbau, ausgelassene/ergänzte Wörter).\n` +
      `3. Prüfe auffällige Unterschiede am Urtext: Rufe bible_original für ${ref} ab und kläre, welche Wiedergabe dem Grundtext am nächsten kommt (bei NT-Versen ggf. bible_compare — Übersetzungen können verschiedenen Editionen folgen).\n` +
      `4. Fazit: Wo sind die Unterschiede nur stilistisch, wo inhaltlich? Belege am abgerufenen Text, nicht aus dem Gedächtnis.`;
  } else {
    throw new Error(`Unknown prompt: ${name}`);
  }

  const meta = PROMPTS.find((p) => p.name === name)!;
  return {
    description: meta.description,
    messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
  };
};

// --- bible_setup — build the database from inside the server ---------------
/**
 * Guarded by an explicit confirmation flag rather than running on first use.
 *
 * The download takes about a minute and reaches out to eight external sources;
 * that is not something to start behind the user's back because a model happened
 * to ask for a verse. Without `bestaetigung` the tool answers with the plan, so
 * the model has something concrete to present before asking.
 */
async function handleSetup(args: { bestaetigung?: unknown }) {
  if (dataMissing === null) {
    return errorResult(
      "Die Datenbank ist bereits vorhanden und vollständig. Es gibt nichts einzurichten."
    );
  }

  // Import here, not at module scope: this pulls in all eight download modules,
  // and a server that already has its data should never load them.
  const { runSetup, SETUP_STEPS } = await import("./scripts/setup.ts");

  if (args.bestaetigung !== true) {
    const plan = {
      status: "bestaetigung_erforderlich",
      grund: dataMissing,
      erklaerung:
        "Die Bibeldaten werden nicht mitgeliefert und müssen einmalig von den " +
        "Originalquellen geladen werden. Frage die Nutzerin oder den Nutzer, ob der " +
        "Download jetzt starten soll, und rufe dieses Werkzeug danach mit " +
        "bestaetigung=true erneut auf.",
      dauer: "ungefähr eine Minute",
      voraussetzung: "Internetverbindung",
      umfang_mb: 145,
      schritte: SETUP_STEPS.map((s) => ({ schritt: s.label, liefert: s.provides })),
      ziel: DB_PATH,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }] };
  }

  console.error("bible_setup: starting download");
  // The download scripts report progress with console.log, which is right for a
  // terminal and fatal here: stdout carries the JSON-RPC stream, and a single
  // stray line makes the client treat the server as broken. Measured — the first
  // end-to-end run of this tool produced an unparseable stream. Redirect for the
  // duration rather than rewriting every log line in eight scripts that are also
  // used standalone.
  const consoleLog = console.log;
  console.log = console.error;
  let report;
  try {
    report = await runSetup((label, i, total) => {
      console.error(`bible_setup [${i}/${total}] ${label}`);
    });
  } finally {
    console.log = consoleLog;
  }

  const fehlgeschlagen = report.steps.filter((s) => !s.ok);
  const gelungen = report.steps.filter((s) => s.ok).map((s) => s.label);

  if (report.aborted) {
    return errorResult(
      `Der Aufbau ist fehlgeschlagen: ${fehlgeschlagen[0]?.error ?? "unbekannter Fehler"}\n\n` +
        "Ohne die deutschen Übersetzungen entsteht keine Datenbank, deshalb wurden die " +
        "weiteren Schritte übersprungen. Die vorhandenen Daten sind unverändert geblieben. " +
        "Häufigste Ursache ist eine fehlende Internetverbindung; ein erneuter Aufruf " +
        "beginnt von vorn."
    );
  }

  // A restart is required because the connection and its prepared statements are
  // bound to the empty in-memory database this process started with.
  const result = {
    status: report.complete ? "fertig" : "teilweise_fertig",
    dauer_sekunden: Math.round(report.seconds),
    geladen: gelungen,
    ...(fehlgeschlagen.length > 0
      ? {
          fehlgeschlagen: fehlgeschlagen.map((s) => ({
            schritt: s.label,
            fehler: s.error,
            fehlt_dadurch: s.provides,
            nachholen_mit: s.command,
          })),
          hinweis_unvollstaendig:
            "Die übrigen Daten sind vollständig geladen und nutzbar. Die fehlgeschlagenen " +
            "Schritte lassen sich einzeln nachholen, ohne alles neu zu laden.",
        }
      : {}),
    naechster_schritt:
      "Die Daten liegen jetzt auf der Festplatte. Bitte Claude Desktop einmal vollständig " +
      "beenden und neu starten — erst danach kann dieser Server sie lesen. Gib diesen Satz " +
      "unbedingt weiter.",
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

// --- MCP server — request dispatch (bible_lookup handled inline) -----------
const handleCallTool = async (request: CallToolRequest) => {
  const toolName = request.params.name;
  // `arguments` is optional per the MCP schema, and clients do omit it when the
  // model calls a tool without parameters. Without this fallback every handler
  // would throw a raw TypeError into the JSON-RPC layer instead of returning
  // the "field is required" tool error the caller can act on.
  const rawArgs = request.params.arguments ?? {};

  if (toolName === "bible_setup") {
    return handleSetup(rawArgs as { bestaetigung?: unknown });
  }

  // One gate for all six data tools instead of a check per handler: without a
  // database every one of them would otherwise answer "book not found", which
  // reads like the reference was wrong rather than like nothing is loaded yet.
  if (dataMissing !== null) {
    return errorResult(
      `${dataMissing} Dieser Server bringt die Bibeldaten nicht mit, sie werden einmalig ` +
        "von den Originalquellen geladen (etwa eine Minute, Internetverbindung nötig).\n\n" +
        "Frage die Nutzerin oder den Nutzer, ob der Download jetzt starten soll, und rufe " +
        "dann bible_setup mit bestaetigung=true auf. Beantworte die Bibelfrage bis dahin " +
        "nicht aus dem Gedächtnis."
    );
  }

  if (toolName === "bible_original") {
    return handleOriginal(
      rawArgs as {
        book?: unknown;
        chapter?: unknown;
        verse?: unknown;
        texttyp?: unknown;
      }
    );
  }
  if (toolName === "bible_crossrefs") {
    return handleCrossrefs(
      rawArgs as {
        book?: unknown;
        chapter?: unknown;
        verse?: unknown;
        limit?: unknown;
        translation?: unknown;
      }
    );
  }
  if (toolName === "bible_concordance") {
    return handleConcordance(
      rawArgs as {
        strong?: unknown;
        lemma?: unknown;
        texttyp?: unknown;
        limit?: unknown;
      }
    );
  }
  if (toolName === "bible_search") {
    return handleSearch(
      rawArgs as {
        query?: unknown;
        book?: unknown;
        limit?: unknown;
        translation?: unknown;
      }
    );
  }
  if (toolName === "bible_compare") {
    return handleCompare(
      rawArgs as {
        book?: unknown;
        chapter?: unknown;
        verse?: unknown;
      }
    );
  }
  if (toolName !== "bible_lookup") {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const args = rawArgs as {
    book?: unknown;
    chapter?: unknown;
    verses?: unknown;
    translation?: unknown;
  };

  const { book, translation } = args;

  // Validate required inputs
  const MAX_BOOK_LENGTH = 50; // Longest German book name is ~20 chars
  if (!book || typeof book !== "string" || book.length > MAX_BOOK_LENGTH) {
    return {
      content: [{ type: "text" as const, text: "Error: 'book' is required and must be under 50 characters (e.g. 'Jesaja', '1. Mose')" }],
      isError: true,
    };
  }

  const chapter = toInt(args.chapter);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    return {
      content: [{ type: "text" as const, text: chapterOutOfRange }],
      isError: true,
    };
  }

  // Accept verses as string or single number (lenient towards MCP clients).
  const MAX_VERSES_LENGTH = 200;
  const verses =
    args.verses === undefined || args.verses === null
      ? ""
      : typeof args.verses === "string"
        ? args.verses
        : typeof args.verses === "number" && Number.isInteger(args.verses)
          ? String(args.verses)
          : null;
  if (verses === null || verses.length > MAX_VERSES_LENGTH) {
    return {
      content: [{ type: "text" as const, text: `Error: 'verses' must be a string like "4", "16-17" or "1-3,7" (max ${MAX_VERSES_LENGTH} characters)` }],
      isError: true,
    };
  }

  // Resolve book name to ID
  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }

  // Resolve translation (strict: unknown/unloaded codes are errors)
  const resolved = requireTranslation(translation);
  if ("error" in resolved) {
    return errorResult(resolved.error);
  }

  // Look up verses
  const results = lookupVerses(resolved.code, bookId, chapter, verses);
  if (results.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No verses found for ${book} ${chapter}${verses ? "," + verses : ""}. Check chapter and verse numbers.`,
        },
      ],
      isError: true,
    };
  }

  // Build response
  const bookName = getBookDisplayName(bookId);
  const translationName = TRANSLATIONS[resolved.code].name;

  // Format verse reference
  const verseNums = results.map((r) => r.verse);
  const verseRef = formatVerseReference(verseNums);
  const reference = `${bookName} ${chapter},${verseRef}`;

  // Format text (strip any remaining HTML tags from the database)
  const text = results
    .map((r) => {
      const clean = stripHtml(r.text);
      return results.length > 1 ? `${r.verse} ${clean}` : clean;
    })
    .join(" ");

  const hinweise = bracketHints([text]);
  const response = {
    reference,
    translation: translationName,
    text,
    ...(hinweise.length > 0 ? { hinweis: hinweise.join(" ") } : {}),
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
};

// --- Tool handlers ---------------------------------------------------------
/**
 * Handle the `bible_original` tool: return one NT verse word-by-word with
 * lemma and decoded morphology from the SBLGNT / MorphGNT data.
 */
function handleOriginal(args: {
  book?: unknown;
  chapter?: unknown;
  verse?: unknown;
  texttyp?: unknown;
}) {
  if (!stmtOriginal || availableEditions.size === 0) {
    return errorResult(
      "Urtext-Daten nicht geladen. Bitte zuerst 'bun run download:byz' " +
        "(und optional 'bun run download:sblgnt') ausführen."
    );
  }

  const { book } = args;

  if (!book || typeof book !== "string" || book.length > 50) {
    return errorResult("Error: 'book' is required (e.g. '1. Mose', 'Jesaja', 'Römer').");
  }
  const chapter = toInt(args.chapter);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    return errorResult(chapterOutOfRange);
  }
  const verse = toInt(args.verse);
  if (verse === null || verse < 1 || verse > MAX_VERSE) {
    return errorResult(verseOutOfRange);
  }

  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }

  // Route by testament: OT (1–39) → Hebrew WLC; NT (40–66) → Greek text type.
  const isOT = bookId < 40;
  let edition: string;
  let hinweisZusatz = "";
  if (isOT) {
    edition = "wlc";
    const wanted = resolveEdition(args.texttyp);
    if (args.texttyp && wanted !== "wlc") {
      hinweisZusatz =
        ` (Der Texttyp "${args.texttyp}" gilt nur fürs NT; fürs AT wird der hebräische WLC verwendet.)`;
    }
  } else {
    const wanted = resolveEdition(args.texttyp);
    if (wanted === null || !NT_EDITIONS.has(wanted)) {
      return errorResult(
        `Error: Unbekannter oder fürs NT ungültiger texttyp "${args.texttyp}". ` +
          `Erlaubt fürs NT: "byzantine" (Mehrheitstext, Standard), "sblgnt" (kritisch), "tr" (Textus Receptus).`
      );
    }
    edition = wanted;
  }

  if (!availableEditions.has(edition)) {
    return errorResult(
      `Texttyp "${edition}" ist nicht geladen. Verfügbar: ${[...availableEditions].join(", ")}. ` +
        (edition === "wlc"
          ? "Für das AT bitte 'bun run download:heb' ausführen."
          : "")
    );
  }

  const rows = stmtOriginal.all(edition, bookId, chapter, verse);
  if (rows.length === 0) {
    return errorResult(
      `Keine Urtext-Daten für ${book} ${chapter},${verse} (Texttyp ${edition}).`
    );
  }

  const meta0 = EDITION_META[edition]!;
  const decode =
    meta0.decoder === "hebrew" ? decodeHebrew :
    meta0.decoder === "morphgnt" ? decodeParse :
    decodeRobinson;
  const woerter = rows.map((r) => {
    // SBLGNT stores POS separately (r.pos); the other decoders fold it into the
    // morphology string, so prepend it here for a consistent output shape.
    const morph =
      meta0.decoder === "morphgnt"
        ? [posLabel(r.pos), decodeParse(r.parse)].filter(Boolean).join(" ")
        : decode(r.parse);
    const w: Record<string, string> = {
      wort: r.surface,
      grundform: r.lemma || "—",
      morphologie: morph || "—",
      code: r.parse,
    };
    if (r.strong) w.strong = (r.lang === "grc" ? "G" : "H") + r.strong;
    return w;
  });

  const response = {
    reference: `${getBookDisplayName(bookId)} ${chapter},${verse}`,
    texttyp: edition,
    edition: meta0.label,
    sprache: meta0.sprache,
    hinweis: meta0.hinweis + hinweisZusatz,
    woerter,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
  };
}

/**
 * Handle the `bible_crossrefs` tool: return cross-references for one verse,
 * ranked by OpenBible.info votes, each with its German target text.
 */
function handleCrossrefs(args: {
  book?: unknown;
  chapter?: unknown;
  verse?: unknown;
  limit?: unknown;
  translation?: unknown;
}) {
  if (!stmtXrefs) {
    return errorResult(
      "Querverweis-Daten nicht geladen. Bitte 'bun run download:crossrefs' ausführen."
    );
  }
  const resolved = requireTranslation(args.translation);
  if ("error" in resolved) {
    return errorResult(resolved.error);
  }
  const translation = resolved.code;

  const { book } = args;
  if (!book || typeof book !== "string" || book.length > 50) {
    return errorResult("Error: 'book' is required (e.g. '1. Mose', 'Jesaja', 'Römer').");
  }
  const chapter = toInt(args.chapter);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    return errorResult(chapterOutOfRange);
  }
  const verse = toInt(args.verse);
  if (verse === null || verse < 1 || verse > MAX_VERSE) {
    return errorResult(verseOutOfRange);
  }
  const limit = Math.min(Math.max(toInt(args.limit) ?? 10, 1), 30);

  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }

  const rows = stmtXrefs.all(bookId, chapter, verse, limit);
  if (rows.length === 0) {
    return errorResult(
      `Keine Querverweise für ${getBookDisplayName(bookId)} ${chapter},${verse} gefunden.`
    );
  }

  const verweise = rows.map((r) => {
    const bookName = getBookDisplayName(r.to_book);
    const sameChapter = r.to_chapter === r.to_chapter_end;
    const stelle = sameChapter
      ? r.to_verse === r.to_verse_end
        ? `${bookName} ${r.to_chapter},${r.to_verse}`
        : `${bookName} ${r.to_chapter},${r.to_verse}-${r.to_verse_end}`
      : `${bookName} ${r.to_chapter},${r.to_verse} – ${r.to_chapter_end},${r.to_verse_end}`;

    // Text: full range within one chapter (capped at 4 verses), otherwise the
    // first verse only — cross-chapter targets are rare and usually long.
    // Multi-verse ranges additionally ship as `verse_einzeln`: the joined form
    // embeds verse numbers into the string, which leaves consumers to split it
    // themselves — and they drop the outer edges when they do (observed
    // 25.07.2026, Joh 11,25-26 quoted without "Jesus spricht zu ihr:" and
    // without the closing question).
    let text = "";
    let einzeln: Array<{ nr: number; text: string }> | null = null;
    if (sameChapter) {
      const span = r.to_verse_end - r.to_verse + 1;
      const CAP = 4;
      const verses = stmtVerseRange.all(
        translation, r.to_book, r.to_chapter, r.to_verse, Math.min(r.to_verse_end, r.to_verse + CAP - 1)
      );
      text = verses
        .map((v) => (span > 1 ? `${v.verse} ${stripHtml(v.text)}` : stripHtml(v.text)))
        .join(" ");
      if (span > CAP) text += ` … [bis V. ${r.to_verse_end}]`;
      if (span > 1) einzeln = verses.map((v) => ({ nr: v.verse, text: stripHtml(v.text) }));
    } else {
      const v = stmtVerse.get(translation, r.to_book, r.to_chapter, r.to_verse);
      if (v) text = `${stripHtml(v.text)} … [Abschnitt bis ${r.to_chapter_end},${r.to_verse_end}]`;
    }
    return {
      stelle,
      votes: r.votes,
      text,
      ...(einzeln !== null ? { verse_einzeln: einzeln } : {}),
    };
  });

  const hinweise = bracketHints(verweise.map((v) => v.text));
  const response = {
    reference: `${getBookDisplayName(bookId)} ${chapter},${verse}`,
    quelle:
      "Treasury of Scripture Knowledge (erweitert), OpenBible.info (CC-BY); " +
      `Text: ${TRANSLATIONS[translation].name}`,
    verweise,
    ...(verweise.some((v) => "verse_einzeln" in v)
      ? {
          lesehinweis:
            "Mehrversige Verweise tragen zusätzlich 'verse_einzeln' (ein Eintrag je Vers, " +
            "ohne eingebettete Versnummern). Beim Zitieren daraus die Verse vollständig " +
            "übernehmen — nicht Anfang oder Ende des Abschnitts weglassen.",
        }
      : {}),
    ...(hinweise.length > 0 ? { hinweis: hinweise.join(" ") } : {}),
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
  };
}

/**
 * Handle the `bible_concordance` tool: all occurrences of an original-language
 * word (by Strong's number or exact lemma) in one edition, with statistics.
 */
function handleConcordance(args: {
  strong?: unknown;
  lemma?: unknown;
  texttyp?: unknown;
  limit?: unknown;
}) {
  if (!stmtConcordStrong || !stmtConcordLemma || availableEditions.size === 0) {
    return errorResult(
      "Urtext-Daten nicht geladen. Bitte zuerst 'bun run download:byz' " +
        "(und für das AT 'bun run download:heb') ausführen."
    );
  }

  // Determine search mode and testament.
  let strongDigits: string | null = null;
  let isHebrew: boolean;
  let suche: string;
  if (args.strong !== undefined && args.strong !== null && args.strong !== "") {
    if (typeof args.strong !== "string" || !/^[GHgh]\d{1,5}$/.test(args.strong.trim())) {
      return errorResult(
        'Error: \'strong\' muss eine Strong-Nummer mit Präfix sein, z. B. "G26" (NT) oder "H7225" (AT).'
      );
    }
    const s = args.strong.trim().toUpperCase();
    isHebrew = s[0] === "H";
    strongDigits = String(parseInt(s.slice(1), 10)); // normalize leading zeros
    suche = s;
  } else if (args.lemma !== undefined && args.lemma !== null && args.lemma !== "") {
    if (typeof args.lemma !== "string" || args.lemma.length > 50) {
      return errorResult("Error: 'lemma' must be a Greek or Hebrew word.");
    }
    const lemma = args.lemma.trim();
    if (/[֐-׿]/.test(lemma)) {
      isHebrew = true; // Hebrew block
    } else if (/[Ͱ-Ͽἀ-῿]/.test(lemma)) {
      isHebrew = false; // Greek + Greek Extended blocks
    } else {
      return errorResult(
        "Error: 'lemma' muss griechisch oder hebräisch geschrieben sein (wie von bible_original " +
          "zurückgegeben). Alternativ 'strong' verwenden (z. B. \"G26\", \"H7225\")."
      );
    }
    suche = lemma;
  } else {
    return errorResult("Error: entweder 'strong' (z. B. \"G26\") oder 'lemma' angeben.");
  }

  // Resolve edition: Hebrew → wlc; Greek → NT edition per texttyp.
  let edition: string;
  if (isHebrew) {
    edition = "wlc";
  } else {
    const wanted = resolveEdition(args.texttyp);
    if (wanted === null || !NT_EDITIONS.has(wanted)) {
      return errorResult(
        `Error: Unbekannter oder fürs NT ungültiger texttyp "${args.texttyp}". ` +
          `Erlaubt: "byzantine" (Standard), "sblgnt", "tr".`
      );
    }
    edition = wanted;
  }
  if (!availableEditions.has(edition)) {
    return errorResult(
      `Texttyp "${edition}" ist nicht geladen. Verfügbar: ${[...availableEditions].join(", ")}.`
    );
  }

  const limit = Math.min(Math.max(toInt(args.limit) ?? 50, 1), 200);
  let rows =
    strongDigits !== null
      ? stmtConcordStrong.all(edition, strongDigits)
      : stmtConcordLemma.all(edition, suche);
  if (rows.length === 0 && strongDigits === null) {
    // Exact match failed — retry via Unicode-normalized lemma lookup.
    const stored = findStoredLemma(edition, suche);
    if (stored !== null) rows = stmtConcordLemma.all(edition, stored);
  }
  if (rows.length === 0) {
    return errorResult(
      `Keine Vorkommen für "${suche}" in Edition "${edition}" gefunden. ` +
        "Hinweis: Lemma muss exakt (mit Akzenten/Punktierung) übereinstimmen — im Zweifel Strong-Nummer verwenden."
    );
  }

  // Aggregate: per-book counts and distinct verses (rows are in canonical order).
  const bookNames = new Map<number, string>();
  const name = (id: number): string => {
    let n = bookNames.get(id);
    if (n === undefined) { n = getBookDisplayName(id); bookNames.set(id, n); }
    return n;
  };
  const perBook = new Map<number, number>();
  const verseKeys = new Set<string>();
  for (const r of rows) {
    perBook.set(r.book_id, (perBook.get(r.book_id) ?? 0) + 1);
    verseKeys.add(`${r.book_id}-${r.chapter}-${r.verse}`);
  }

  const meta0 = EDITION_META[edition]!;
  const response: Record<string, unknown> = {
    suche,
    grundform: rows[0]!.lemma || "—",
  };
  // Enrich with the Strong's dictionary entry (transliteration + meaning) if
  // the lexicon table is loaded and a Strong's number is known.
  const strongKey =
    strongDigits !== null
      ? (isHebrew ? "H" : "G") + strongDigits
      : rows[0]!.strong
        ? (isHebrew ? "H" : "G") + rows[0]!.strong
        : null;
  if (strongKey !== null && stmtStrongDef) {
    const def = stmtStrongDef.get(strongKey);
    if (def) {
      response.strong = strongKey;
      if (def.translit) response.umschrift = def.translit;
      if (def.gloss) response.kurzbedeutung = def.gloss;
      if (def.definition) response.bedeutung = def.definition;
      if (def.kjv) response.kjv_woerter = def.kjv;
      // Full Abbott-Smith lexicon entry (STEPBible TBESG, Greek only) — the
      // scholarly meaning; typically a few hundred characters, worth the tokens.
      if (def.meaning) response.lexikon = def.meaning;
    }
  }
  response.texttyp = edition;
  response.edition = meta0.label;
  response.gesamt = rows.length;
  response.verse = verseKeys.size;
  response.buecher = [...perBook.entries()].map(([id, anzahl]) => ({ buch: name(id), anzahl }));
  response.vorkommen = rows.slice(0, limit).map((r) => ({
    stelle: `${name(r.book_id)} ${r.chapter},${r.verse}`,
    wort: r.surface,
  }));
  if (rows.length > limit) {
    response.hinweis =
      `Nur die ersten ${limit} von ${rows.length} Vorkommen gelistet; ` +
      "'buecher' zeigt die vollständige Verteilung.";
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
  };
}

/**
 * Handle the `bible_search` tool: full-text search over one translation's verses.
 */
function handleSearch(args: {
  query?: unknown;
  book?: unknown;
  limit?: unknown;
  translation?: unknown;
}) {
  if (!stmtSearch || !stmtSearchBook || !stmtSearchCount || !stmtSearchCountBook) {
    return errorResult(
      "Volltext-Index nicht gebaut. Bitte 'bun run build:fts' ausführen."
    );
  }
  const resolved = requireTranslation(args.translation);
  if ("error" in resolved) {
    return errorResult(resolved.error);
  }
  const translation = resolved.code;

  const { query } = args;
  if (!query || typeof query !== "string" || query.length > 100) {
    return errorResult(
      "Error: 'query' is required (max 100 characters), e.g. 'Hirte mangeln' or '\"Gnade um Gnade\"'."
    );
  }
  const match = buildFtsQuery(query);
  if (match === null) {
    return errorResult("Error: 'query' enthält kein durchsuchbares Wort.");
  }
  const limit = Math.min(Math.max(toInt(args.limit) ?? 10, 1), 50);

  let bookId: number | null = null;
  if (args.book !== undefined && args.book !== null && args.book !== "") {
    if (typeof args.book !== "string" || args.book.length > 50) {
      return errorResult("Error: 'book' must be a German book name.");
    }
    bookId = resolveBook(args.book);
    if (bookId === null) {
      return bookNotFound(args.book);
    }
  }

  const total =
    bookId === null
      ? stmtSearchCount.get(match, translation)!.n
      : stmtSearchCountBook.get(match, translation, bookId)!.n;
  if (total === 0) {
    return errorResult(
      `Keine Treffer für "${query}"${bookId !== null ? ` in ${getBookDisplayName(bookId)}` : ""} ` +
        `(${TRANSLATIONS[translation].name}). ` +
        "Gesucht wird nach exakten Wortformen — Beugungen mitdenken oder Präfixsuche " +
        'nutzen (z. B. "lieb*").'
    );
  }
  const rows =
    bookId === null
      ? stmtSearch.all(match, translation, limit)
      : stmtSearchBook.all(match, translation, bookId, limit);

  // `treffer` counts verses, not word occurrences — a verse can match several
  // times (1Joh 2,15 carries three forms of "lieb*"). Consumers read "Treffer"
  // as findings and try to break the number down per verse, guessing the
  // per-verse counts (observed 25.07.2026). Count the highlight markers over
  // all matching verses so the second number is stated rather than inferred.
  const vorkommen =
    total <= OCCURRENCE_SCAN_LIMIT && stmtSearchAll && stmtSearchAllBook
      ? (bookId === null
          ? stmtSearchAll.all(match, translation, OCCURRENCE_SCAN_LIMIT)
          : stmtSearchAllBook.all(match, translation, bookId, OCCURRENCE_SCAN_LIMIT)
        ).reduce((sum, r) => sum + r.text.split(HIT_OPEN).length - 1, 0)
      : null;

  const response: Record<string, unknown> = {
    suche: query,
    uebersetzung: TRANSLATIONS[translation].name,
    treffer: total,
    ...(vorkommen !== null && vorkommen !== total ? { vorkommen_gesamt: vorkommen } : {}),
    verse: rows.map((r) => ({
      stelle: `${getBookDisplayName(r.book_id)} ${r.chapter},${r.verse}`,
      text: r.text,
    })),
  };
  const hinweise: string[] = [];
  if (total > rows.length) {
    hinweise.push(
      `Nur die ersten ${rows.length} von ${total} Treffern gelistet (limit erhöhen oder auf ein Buch einschränken).`
    );
  }
  hinweise.push(
    vorkommen !== null && vorkommen !== total
      ? `'treffer' zählt Verse (${total}), nicht Wortvorkommen: in manchen Versen passt der Suchbegriff mehrfach, ` +
          `zusammen ${vorkommen} Vorkommen ('vorkommen_gesamt'). Die Fundstellen im Verstext sind mit ⟦…⟧ markiert — ` +
          "je Vers daran abzählen, nicht schätzen."
      : "'treffer' zählt Verse, nicht Wortvorkommen. Die Fundstellen im Verstext sind mit ⟦…⟧ markiert — " +
          "je Vers daran abzählen, nicht schätzen."
  );
  hinweise.push(...bracketHints(rows.map((r) => r.text)));
  response.hinweis = hinweise.join(" ");

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
  };
}

/**
 * Handle the `bible_compare` tool: word-diff one NT verse across the Greek
 * editions (pairwise, normalized comparison, original surfaces reported).
 */
function handleCompare(args: { book?: unknown; chapter?: unknown; verse?: unknown }) {
  if (!stmtOriginal || availableEditions.size === 0) {
    return errorResult(
      "Urtext-Daten nicht geladen. Bitte zuerst 'bun run download:byz' ausführen."
    );
  }

  const { book } = args;
  if (!book || typeof book !== "string" || book.length > 50) {
    return errorResult("Error: 'book' is required (e.g. 'Römer', '1Joh').");
  }
  const chapter = toInt(args.chapter);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    return errorResult(chapterOutOfRange);
  }
  const verse = toInt(args.verse);
  if (verse === null || verse < 1 || verse > MAX_VERSE) {
    return errorResult(verseOutOfRange);
  }
  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }
  if (bookId < 40) {
    return errorResult(
      "Der Editionsvergleich gilt nur fürs NT — fürs AT gibt es nur eine Edition (hebräischer WLC)."
    );
  }

  const editions = ["byzantine", "tr", "sblgnt"].filter((e) => availableEditions.has(e));
  if (editions.length < 2) {
    return errorResult(
      `Mindestens zwei NT-Editionen nötig; geladen: ${editions.join(", ") || "keine"}. ` +
        "Bitte die Download-Skripte (download-byz.ts, download-tr.ts, download-morph.ts) ausführen."
    );
  }

  const texts = editions.map((ed) => ({
    ed,
    words: stmtOriginal!.all(ed, bookId, chapter, verse).map((r) => r.surface),
  }));
  if (texts.every((t) => t.words.length === 0)) {
    return errorResult(
      `Keine Urtext-Daten für ${getBookDisplayName(bookId)} ${chapter},${verse}.`
    );
  }

  const vergleiche = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const A = texts[i]!;
      const B = texts[j]!;
      const paar = `${A.ed} ↔ ${B.ed}`;
      if (A.words.length === 0 || B.words.length === 0) {
        const fehlt = A.words.length === 0 ? A.ed : B.ed;
        vergleiche.push({ paar, ergebnis: `Vers fehlt in Edition "${fehlt}"` });
        continue;
      }
      const segs = diffSegments(A.words, B.words);
      if (segs.length === 0) {
        vergleiche.push({ paar, ergebnis: "identisch (nach Normalisierung)" });
      } else {
        vergleiche.push({
          paar,
          unterschiede: segs.map((s) =>
            s.a && s.b
              ? `${A.ed}: "${s.a}" ↔ ${B.ed}: "${s.b}"`
              : s.a
                ? `nur in ${A.ed}: "${s.a}"`
                : `nur in ${B.ed}: "${s.b}"`
          ),
        });
      }
    }
  }

  // Per-word attestation across eight editions (STEPBible TAGNT). Words the
  // full set attests are only counted; listed are the ones whose witness set
  // differs — that is where the text-critical signal sits.
  let bezeugung: Record<string, unknown> | undefined;
  const quellenkonflikte: string[] = [];
  if (stmtTagnt) {
    const rows = stmtTagnt.all(bookId, chapter, verse);
    if (rows.length > 0) {
      const FULL = "NA28+NA27+Tyn+SBL+WH+Treg+TR+Byz";
      const abweichend = rows.filter(
        (r) => r.editions !== FULL || r.meaning_variant !== "" || r.spelling_variant !== ""
      );
      const eintraege = abweichend.map((r) => {
        const notiz = [r.meaning_variant, r.spelling_variant].filter((s) => s !== "").join(" ; ");
        const check = notiz !== "" ? crossCheckVariant(notiz, r.surface, texts) : undefined;
        if (check !== undefined) {
          for (const w of check.abgleich) quellenkonflikte.push(`${r.surface}: ${w}`);
        }
        return {
          wort: r.surface,
          typ: r.word_type,
          editionen: r.editions,
          ...(r.meaning_variant !== "" ? { bedeutungsvariante: r.meaning_variant } : {}),
          ...(r.spelling_variant !== "" ? { schreibvariante: r.spelling_variant } : {}),
          ...(check !== undefined ? { in_dieser_db: check.belege } : {}),
          ...(check !== undefined && check.abgleich.length > 0
            ? { abgleich: check.abgleich }
            : {}),
        };
      });
      bezeugung = {
        quelle:
          "STEPBible TAGNT (CC BY 4.0); Editionen: NA28, NA27, Tyn(dale House), SBL, " +
          "WH (Westcott-Hort), Treg(elles), TR, Byz. typ: N=Nestle-Aland, K=KJV/TR-Tradition, " +
          "O=andere; Kleinbuchstabe = ohne Übersetzungsrelevanz; »n/«n = Wortstellung verschoben.",
        woerter_gesamt: rows.length,
        von_allen_acht_bezeugt: rows.length - abweichend.length,
        ...(eintraege.some((e) => "in_dieser_db" in e)
          ? {
              lesehinweis:
                "Die TAGNT-Notizen (bedeutungsvariante/schreibvariante) nennen nur die Zeugen " +
                "des eigenen Apparats — daraus folgt NICHT, dass alle übrigen Editionen die " +
                "Kopfform lesen. 'in_dieser_db' zeigt pro Form, welche der hier geladenen " +
                "Editionen sie tatsächlich lesen (aus original_words). Für die Frage 'was steht " +
                "in dieser Edition' gilt 'in_dieser_db', nicht die TAGNT-Notiz; 'abgleich' nennt " +
                "die Stellen, an denen beide auseinandergehen.",
            }
          : {}),
        abweichend: eintraege,
      };
    }
  }

  // Source conflicts sit four levels down in bezeugung.abweichend[].abgleich,
  // and consumers that treat the attestation block as optional detail never
  // reach them — Mk 14,46 was reported without the caveat (25.07.2026). Repeat
  // them at the top of the response, before the data they qualify.
  const response = {
    reference: `${getBookDisplayName(bookId)} ${chapter},${verse}`,
    sprache: "Griechisch (Koine)",
    ...(quellenkonflikte.length > 0
      ? {
          warnung:
            "An dieser Stelle widerspricht die TAGNT-Bezeugung dem Editionstext. " +
            "'quellenkonflikte' nennt für jede betroffene Form, was die Edition " +
            "tatsächlich liest — das gehört zur Antwort über diesen Vers, nicht in " +
            "eine Fußnote. Maßgeblich ist der Editionstext, nicht die TAGNT-Notiz.",
          quellenkonflikte,
        }
      : {}),
    editionen: texts.map((t) => ({
      texttyp: t.ed,
      edition: EDITION_META[t.ed]!.label,
      text: t.words.join(" ") || "— (Vers in dieser Edition nicht vorhanden)",
    })),
    vergleiche,
    ...(bezeugung !== undefined ? { bezeugung } : {}),
    // No example of a variant type here: the earlier "(z. B. bewegliches Ny)"
    // was picked up as a label and pinned onto an unrelated case — ἐπέβαλον /
    // ἐπέβαλαν in Mk 14,46 got called movable ny, though that is a thematic
    // vs. alpha aorist ending (25.07.2026). Point at the classifying fields
    // instead of seeding a term.
    hinweis:
      "Vergleich ignoriert Akzente, Groß-/Kleinschreibung und Schlusssigma (byzantine/tr sind " +
      "unakzentuiert gespeichert). Verbleibende Unterschiede sind echte Textvarianten oder " +
      "Schreibvarianten. Welche Art vorliegt, steht in 'bezeugung' ('schreibvariante' bzw. " +
      "'bedeutungsvariante', dazu 'typ') — nicht aus diesem Hinweis erschließen und die " +
      "sprachliche Erscheinung nicht benennen, wenn sie dort nicht steht.",
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
  };
}

// --- MCP server — construction and tool registration -----------------------
// A factory, not a singleton: one `Server` binds exactly one transport, so the
// HTTP mode below needs a fresh instance per session. Everything expensive
// (database, prepared statements, the tool list) lives at module level and is
// shared; an instance is just the handler wiring.
function createServer(): Server {
  const s = new Server(
    { name: "bibelstudium-mcp", version: "0.2.2" },
    { capabilities: { tools: {}, prompts: {} } }
  );
  s.setRequestHandler(ListToolsRequestSchema, handleListTools);
  s.setRequestHandler(ListPromptsRequestSchema, handleListPrompts);
  s.setRequestHandler(GetPromptRequestSchema, handleGetPrompt);
  s.setRequestHandler(CallToolRequestSchema, handleCallTool);
  return s;
}

// --- Bootstrap -------------------------------------------------------------
/**
 * HTTP mode, opt-in via MCP_HTTP_PORT. Without it the server speaks stdio as
 * before, so local clients and `bun run test` are unaffected.
 *
 * Binds to 127.0.0.1 unless MCP_HTTP_HOST says otherwise. That default is the
 * security-relevant part: reaching this server from outside should require a
 * deliberate step (a tunnel or reverse proxy that terminates TLS), never a
 * forgotten default. Publishing the port directly also exposes the machine's
 * address, and neither TLS nor access control is provided here.
 *
 * Stateless: `Server` binds a single transport, so each request gets its own
 * instance from createServer(). The database and every prepared statement stay
 * shared at module level, so a request costs almost nothing beyond the handler
 * wiring.
 */
// CORS, damit auch browserbasierte Clients den Endpunkt nutzen können. Für
// MCP-Clients ohne Browser ist es folgenlos: die schicken keinen Origin. Kein
// Widerspruch zur Origin-Prüfung unten — die entscheidet, WER antworten
// bekommt, diese Kopfzeilen sagen dem Browser nur, was er damit tun darf.
// Ohne 'expose' käme der Client nicht an die Sitzungs-ID heran.
const CORS_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveHttp(port: number): Promise<void> {
  const host = process.env["MCP_HTTP_HOST"] ?? "127.0.0.1";
  // Browser origins that may talk to this server. Empty by default: MCP clients
  // are not browsers and send no Origin at all, so the strict default costs
  // nothing and closes the DNS-rebinding hole the spec requires servers to
  // close. A web client is opt-in via MCP_HTTP_ALLOWED_ORIGINS.
  const allowedOrigins = (process.env["MCP_HTTP_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");

  Bun.serve({
    port,
    hostname: host,
    idleTimeout: 120,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
      }
      if (url.pathname === "/health") {
        return withCors(
          new Response(JSON.stringify({ status: "ok" }), {
            headers: { "content-type": "application/json" },
          })
        );
      }
      if (url.pathname !== "/mcp") return withCors(new Response("Not found", { status: 404 }));

      // Spec: servers MUST validate Origin. The SDK's own option for this is
      // deprecated in favour of exactly this kind of outer check.
      const origin = request.headers.get("origin");
      if (origin !== null && !allowedOrigins.includes(origin)) {
        return withCors(new Response("Forbidden origin", { status: 403 }));
      }

      // Stateless: one server plus transport per request, no session registry.
      // This server is pure request/response — it never pushes notifications and
      // has nothing to resume — so sessions would buy nothing and cost a registry
      // that has to be swept, capped and expired. An earlier stateful version
      // leaked exactly that way (21 requests, 21 sessions that never went away,
      // measured 25.07.2026). Both objects fall out of scope once the response
      // stream ends.
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await createServer().connect(transport);
      return withCors(await transport.handleRequest(request));
    },
  });

  console.error(`Bibelstudium MCP server running on http://${host}:${port}/mcp`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.error(
      `WARNUNG: gebunden an ${host}, also nicht nur lokal erreichbar. ` +
        "Ohne vorgelagertes TLS und Zugriffsschutz nicht ins offene Netz stellen."
    );
  }
}

async function main(): Promise<void> {
  const portRaw = process.env["MCP_HTTP_PORT"];
  if (portRaw !== undefined && portRaw !== "") {
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`MCP_HTTP_PORT ist keine gültige Portnummer: ${portRaw}`);
    }
    await serveHttp(port);
    return;
  }
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  console.error("Bibelstudium MCP server running on stdio");
}

main().catch((error) => {
  console.error("Bibelstudium MCP server failed to start:", error);
  process.exit(1);
});
