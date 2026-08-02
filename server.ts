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
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolRequest,
  GetPromptRequest,
  ReadResourceRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { Database } from "bun:sqlite";
import packageJson from "./package.json";
import { DB_PATH } from "./db-path.ts";
import {
  DEFAULT_TRANSLATION,
  TRANSLATIONS,
  resolveTranslation,
  type TranslationCode,
} from "./translations.ts";

/** Die eine Versionsangabe, aus der auch das MCPB-Manifest gebaut wird. */
const PACKAGE_VERSION: string = packageJson.version;

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

/**
 * Whether this process serves HTTP instead of stdio.
 *
 * Read here, next to `dataMissing`, because the two together decide whether
 * bible_setup exists at all. Over stdio the caller started this process and owns
 * the machine, so a tool that downloads ~145 MB from eight sources and replaces
 * the database file is a convenience. On an HTTP endpoint the caller is a
 * stranger: the tool would let anyone trigger those downloads repeatedly, and
 * the state that unlocks it — no database — is exactly what a failed or damaged
 * install produces. So it is a stdio-only tool. The operator of an HTTP endpoint
 * builds the data with `--setup` or `bun run setup` instead (see main()).
 *
 * Derived from the environment rather than passed down from main(), so the value
 * cannot disagree with the transport actually chosen there.
 */
const HTTP_MODE = (process.env["MCP_HTTP_PORT"] ?? "") !== "";

/** True when started to build the database instead of to serve (see main()). */
const SETUP_CLI = process.argv.includes("--setup");

// Not while building the database: "Der Server läuft" would be plainly wrong
// there, and the tool availability it reports never comes into play.
if (dataMissing !== null && !SETUP_CLI) {
  console.error(
    HTTP_MODE
      ? "Der Server läuft, aber ALLE Werkzeuge sind gesperrt: im HTTP-Modus gibt es " +
          "bible_setup nicht. Datenbank mit '--setup' aufbauen und den Server neu starten."
      : "Der Server läuft, bis auf bible_setup sind alle Werkzeuge gesperrt."
  );
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

// The whole table, for the `bible://buecher` resource. `chapters` is carried in
// the schema but was never read until now.
const stmtBooks = db.prepare<{ book_id: number; name: string; chapters: number }, []>(
  "SELECT book_id, name, chapters FROM books ORDER BY book_id"
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

// Newest fetch recorded in the provenance table, date only. The one number that
// dates the whole inventory: "your data is from 2026-07-23" answers more support
// questions than any count. Table is optional (older builds lack it) and the
// source URLs stay out — those are the same for every install and documented in
// the README, so repeating them here would only inflate the payload.
const dataFetchedAt: string | null = (() => {
  const hasProvenance =
    db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='provenance'").get() !==
    null;
  if (!hasProvenance) return null;
  const row = db.query("SELECT MAX(fetched_at) AS t FROM provenance").get() as { t: string | null };
  return row?.t ? row.t.slice(0, 10) : null;
})();

// Which original-language editions this file actually carries, for
// bible_server_info. Queried once: the set is fixed for the lifetime of the file,
// and it is the honest answer to "which source texts do you have" — the download
// steps are separate, so wlc without sblgnt (or the reverse) is a real state.
const originalEditions: readonly string[] = hasOriginal
  ? (
      db.query("SELECT DISTINCT edition FROM original_words ORDER BY edition").all() as Array<{
        edition: string;
      }>
    ).map((r) => r.edition)
  : [];

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

// book_id and chapter ride along so one scan serves both the occurrence total
// and the per-book/per-chapter breakdown — see the `verteilung` block below.
const stmtSearchAll = hasFts
  ? db.prepare<{ book_id: number; chapter: number; text: string }, [string, string, number]>(
      "SELECT book_id, chapter, highlight(verses_fts, 0, '⟦', '⟧') as text " +
        "FROM verses_fts WHERE verses_fts MATCH ? AND translation = ? LIMIT ?"
    )
  : null;
const stmtSearchAllBook = hasFts
  ? db.prepare<
      { book_id: number; chapter: number; text: string },
      [string, string, number, number]
    >(
      "SELECT book_id, chapter, highlight(verses_fts, 0, '⟦', '⟧') as text " +
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
/**
 * Eine Quellenangabe, wie sie im Feld `quellen` einer Antwort erscheint.
 *
 * `nennung` trägt nur, was die Lizenz beim Weitergeben verlangt, und ist sonst
 * `null`. Public-Domain-Quellen brauchen keine, CC-BY-Quellen schon: Ein
 * gehosteter Endpunkt macht die Daten öffentlich verfügbar, und das ist nach
 * CC 4.0 ein „Share". Wer nur über MCP zugreift, sieht weder das Repository
 * noch die Website, also muss die Nennung an der Antwort hängen. Vorbild ist
 * orthotomeo, das dasselbe tut.
 */
interface Quelle {
  readonly werk: string;
  readonly lizenz: string;
  readonly nennung: string | null;
}

const EDITION_META: Record<
  string,
  {
    label: string;
    hinweis: string;
    sprache: string;
    decoder: "robinson" | "morphgnt" | "hebrew";
    // Neben `label`, damit Text und Lizenz einer Edition nicht getrennt
    // gepflegt werden und auseinanderlaufen können.
    quelle: Quelle;
  }
> = {
  byzantine: {
    label: "Byzantinischer Mehrheitstext (Robinson-Pierpont 2005)",
    sprache: "Griechisch (Koine)",
    decoder: "robinson",
    quelle: {
      werk: "Byzantinischer Mehrheitstext (Robinson-Pierpont 2005), Text und Robinson-Parsing",
      lizenz: "Public Domain",
      nennung: null,
    },
    hinweis:
      "Mehrheitstext (Textus-Receptus-Familie, aber breiter bezeugt); enthält z. B. " +
      "kein Comma Johanneum (1Joh 5,7). Von der Mehrheitstext-Position (u. a. R. Liebi) " +
      "als zuverlässiger Grundtext vertreten. " +
      "Das Feld 'wort' ist unakzentuiert gespeichert (so liegt die Quelle vor): " +
      "beim Zitieren nicht um Akzente oder Interpunktion ergänzen; akzentuiert steht " +
      "der Text nur im SBLGNT (texttyp 'sblgnt').",
  },
  sblgnt: {
    label: "SBL Greek New Testament (kritische Edition)",
    sprache: "Griechisch (Koine)",
    decoder: "morphgnt",
    quelle: {
      werk: "SBL Greek New Testament (Text) mit MorphGNT-Morphologie",
      lizenz: "Text: CC BY 4.0; Morphologie: CC BY-SA 3.0",
      nennung:
        "SBL Greek New Testament, © Society of Biblical Literature und Logos Bible " +
        "Software, CC BY 4.0, https://sblgnt.com/license/. Morphologie: MorphGNT, " +
        "CC BY-SA 3.0, https://github.com/morphgnt/sblgnt. Die Morphologiecodes " +
        "werden hier aufgeloest, also bearbeitet: Wer diese Ausgabe " +
        "weiterveroeffentlicht, gibt sie unter CC BY-SA weiter.",
    },
    hinweis:
      "Kritische (eklektische) Edition, Nestle-Aland-nah, nicht Mehrheitstext. " +
      "Bei Lesarten-Fragen den Texttyp beachten; die Morphologie ist davon unberührt.",
  },
  tr: {
    label: "Textus Receptus (Robinson, Scrivener/Stephens-Tradition)",
    sprache: "Griechisch (Koine)",
    decoder: "robinson",
    quelle: {
      werk: "Textus Receptus (Scrivener-/Stephanus-Tradition), Text und Robinson-Parsing",
      lizenz: "Public Domain",
      nennung: null,
    },
    hinweis:
      "Textus Receptus, die einzige der drei Editionen mit dem Comma Johanneum " +
      "(1Joh 5,7 Langform) und weiteren TR-Sonderlesarten. Zum direkten Lesarten-" +
      "vergleich; die Mehrheitstext-Position sieht den TR als enge Reformationsform " +
      "des Mehrheitstextes, nicht als Grundtext. " +
      "Das Feld 'wort' ist unakzentuiert gespeichert (so liegt die Quelle vor): " +
      "beim Zitieren nicht um Akzente oder Interpunktion ergänzen.",
  },
  wlc: {
    label: "Westminster Leningrad Codex (masoretisch, OSHB-Morphologie)",
    sprache: "Hebräisch/Aramäisch",
    decoder: "hebrew",
    quelle: {
      werk: "Westminster Leningrad Codex mit OSHB-Morphologie",
      lizenz: "Text: Public Domain; Morphologie und Lemmata: CC BY 4.0",
      nennung:
        "Morphologie und Lemmata: Open Scriptures Hebrew Bible Project, CC BY 4.0, " +
        "https://github.com/openscriptures/morphhb",
    },
    hinweis:
      "Masoretischer Text (Ben Ascher, Leningrad-Codex). Geschriebener Text = Ketiv " +
      "(die Qere-Lesart der Randmasora ist nicht enthalten). Für das AT die von der " +
      "masoretischen Position (u. a. R. Liebi) getragene Textbasis. " +
      "Das Feld 'wort' enthält Vokal- und Akzentzeichen (Teamim) sowie den " +
      "OSHB-Morphemtrenner '/' zwischen Präfix und Wort (z. B. 'בְּ/רֵאשִׁ֖ית'): beim " +
      "Zitieren weder Zeichen entfernen noch ergänzen.",
  },
};

/**
 * Quellen, die keine Edition sind: Querverweise, Bezeugung, Lexika.
 *
 * Konkrete Schlüssel statt `Record<string, Quelle>`, und Zugriff per Punkt statt
 * per Klammer: Unter `noUncheckedIndexedAccess` liefert ein verschriebener
 * Klammerzugriff `Quelle | undefined`, und genau dieser Typ ist in `quellen()`
 * der legitime Kanal für „bedingt unbenutzt". Ein Tippfehler würde also
 * kompilieren, alle Tests grün lassen und eine lizenzpflichtige Nennung
 * stillschweigend weglassen: genau der Fehler, den dieses Feld verhindern soll.
 * So ist ein falscher Name ein Typfehler.
 */
const DATASET_QUELLEN = {
  crossrefs: {
    werk: "Querverweise: Treasury of Scripture Knowledge (erweitert, mit Community-Stimmen)",
    lizenz: "CC BY 4.0",
    nennung: "OpenBible.info, CC BY 4.0, https://www.openbible.info/labs/cross-references/",
  },
  tagnt: {
    werk: "Bezeugung über acht griechische Editionen (STEPBible TAGNT)",
    lizenz: "CC BY 4.0",
    nennung:
      "STEPBible-Data (TAGNT), © Tyndale House, Cambridge, CC BY 4.0, " +
      "https://github.com/STEPBible/STEPBible-Data",
  },
  lexikon_strongs: {
    werk: "Strong-Wörterbücher 1890 (Grundformen, Umschriften, Definitionen)",
    lizenz: "CC BY-SA (Version von der Quelle nicht angegeben)",
    nennung:
      "Open Scriptures, https://github.com/openscriptures/strongs. Das Werk von " +
      "James Strong (1890) ist gemeinfrei; die Share-Alike-Pflicht betrifft die " +
      "digitale Aufbereitung von 2009, die hier in ein eigenes Schema überführt ist.",
  },
  lexikon_step: {
    werk: "Tyndale-Glossen und Abbott-Smith-Lexikon (STEPBible TBESG/TBESH)",
    lizenz: "CC BY 4.0",
    nennung:
      "STEPBible-Data (TBESG/TBESH), © Tyndale House, Cambridge, CC BY 4.0, " +
      "https://github.com/STEPBible/STEPBible-Data",
  },
} as const satisfies Record<string, Quelle>;

/**
 * Baut das Feld `quellen` aus genau den Quellen, die die Antwort benutzt hat.
 *
 * Bewusst kein konstanter Block über allen Werkzeugen: Eine Antwort aus
 * `bible_lookup` mit Luther 1912 berührt keine CC-BY-Quelle, und eine
 * Attribution zu behaupten, die gar nicht einschlägig ist, ist derselbe Fehler
 * wie eine weggelassene. `null`-Einträge fallen weg, damit die Liste kurz
 * bleibt.
 */
function quellen(...verwendet: ReadonlyArray<Quelle | undefined>): Quelle[] {
  const seen = new Set<string>();
  const out: Quelle[] = [];
  for (const q of verwendet) {
    if (q === undefined || seen.has(q.werk)) continue;
    seen.add(q.werk);
    out.push(q);
  }
  return out;
}

/** Quellenangabe einer Übersetzung, aus der Registry in translations.ts. */
function translationQuelle(code: TranslationCode): Quelle {
  const meta = TRANSLATIONS[code];
  return { werk: meta.name, lizenz: meta.license, nennung: meta.attribution };
}

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

// The NT editions in comparison order, and the only place that lists them:
// `bible_compare` renders them in this order and the `variant-check` prompt
// names those of them that are loaded. NT_EDITIONS above is the membership
// test, this is the order — a second literal list would drift from it.
const NT_EDITION_ORDER = ["byzantine", "tr", "sblgnt"] as const;

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

/**
 * Successful result: the same payload twice, as the text block every client has
 * always received and as `structuredContent` (protocol revision 2025-06-18).
 *
 * Built from one value on purpose. A client of the 1.x SDK throws
 * `InvalidRequest` when a tool declaring an `outputSchema` returns a successful
 * result without `structuredContent` (client/index.js:500), so a return path
 * that forgets it is no longer a missing field but a hard client error. There is
 * exactly one way to build such a result, and this is it — never assemble the
 * pair by hand.
 *
 * Error results stay plain text via `errorResult`: the same client check exempts
 * `isError`, and the messages are prose, not JSON.
 */
function jsonResult(response: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
    structuredContent: response,
  };
}

/**
 * Strip leftover HTML tags. Precaution, not running business: `download.ts`
 * already strips on insert, and `verses` holds no "<" at all in any of the four
 * translations (measured 26.07.2026). Same for invisible characters — no soft
 * hyphen (U+00AD), no NBSP, no ZWSP in any row — so nothing else is removed
 * here; anything that would be removed has to stay in step with
 * `rebuildVersesFts`, or search output and quotation drift apart.
 */
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
// picked up as a label and pinned to the wrong case (see the hint of
// bible_compare).
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
 * Uniform "book not found" wording: names the nearest known book when there is
 * one, and states the canon scope. Without the scope note a miss on "Sirach"
 * looks like a typo rather than a book this DB does not carry (66 books,
 * protestant canon) — the caller cannot tell the two apart from "not found".
 *
 * The message and its packaging are separate because the same miss reaches the
 * caller through two channels: tools return it as an `isError` result, resources
 * have no such channel and must throw. One wording, two envelopes — a second
 * formulation would drift, as the boundary messages already did (25.07.2026).
 */
function bookNotFoundMessage(book: string): string {
  if (APOKRYPHEN.test(book)) {
    return (
      `"${book}" gehört zu den apokryphen/deuterokanonischen Schriften. Diese ` +
      "Datenbank enthält ausschließlich die 66 Bücher des protestantischen Kanons: " +
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
  return (
    `"${book}" ist kein Buch dieser Bibel-Datenbank.` +
    (nahe !== null
      ? ` Am nächsten kommt "${nahe}". Falls das gemeint war, damit erneut abfragen.`
      : "") +
    " Diese Datenbank enthält die 66 Bücher des protestantischen Kanons; apokryphe/" +
    "deuterokanonische Schriften fehlen. Erwartet wird der deutsche Buchname " +
    '(z. B. "Jesaja", "1. Mose", "Römer") oder eine Abkürzung (z. B. "Jes", "1Mo", "Röm").'
  );
}

function bookNotFound(book: string): ReturnType<typeof errorResult> {
  return errorResult(bookNotFoundMessage(book));
}

// Reference bounds. Shared so that the limit and the message that reports it
// cannot drift apart: three handlers used to reject `verse=999` with "must be a
// positive integer", which names a condition the input satisfies (25.07.2026).
const MAX_CHAPTER = 150; // Psalms has the most chapters (150)
const MAX_VERSE = 200; // Longest chapter (Psalm 119) has 176 verses
const MAX_VERSE_PARTS = 30; // comma-separated segments in `verses`
const MAX_BOOK_LENGTH = 50; // longest German book name is ~20 chars
const MAX_LEMMA_LENGTH = 50; // own field, own limit — not the book bound

// Derived, not chosen: the longest legal `verses` string is MAX_VERSE_PARTS
// segments of the form "176-176" plus the commas between them. A hand-picked
// 200 used to sit here, colliding with MAX_VERSE by accident and cutting into
// valid input: 30 segments of "100-176" (239 characters, every number legal)
// were rejected (26.07.2026). Note that this bound can never be the only one
// violated — any longer string necessarily breaks the segment or the value
// bound as well. It exists so that an oversized input is turned away before
// the first split, not as a rule of its own; there is no test case for it
// alone, and none can be constructed.
const MAX_VERSE_PART_LENGTH = 2 * String(MAX_VERSE).length + 1; // "176-176"
const MAX_VERSES_LENGTH =
  MAX_VERSE_PARTS * MAX_VERSE_PART_LENGTH + (MAX_VERSE_PARTS - 1);

const chapterOutOfRange = `Error: 'chapter' must be an integer between 1 and ${MAX_CHAPTER}`;
const verseOutOfRange = `Error: 'verse' must be an integer between 1 and ${MAX_VERSE}`;
const bookTooLong = `Error: 'book' must be at most ${MAX_BOOK_LENGTH} characters (e.g. 'Jesaja', '1. Mose', 'Römer')`;
// One message per condition. A single collective message names the form of
// `verses`, and the form was in order in exactly the case that hit the bound.
const versesNotAString = `Error: 'verses' must be a string like "4", "16-17" or "1-3,7"`;
const versesTooLong = `Error: 'verses' must be at most ${MAX_VERSES_LENGTH} characters`;
const versesTooManyParts = `Error: 'verses' must list at most ${MAX_VERSE_PARTS} comma-separated segments`;
const versesOutOfBounds = `Error: every verse number in 'verses' must be between 1 and ${MAX_VERSE}`;

// --- bible_lookup helpers --------------------------------------------------
/**
 * Parse a verse reference string like "4", "16-17", "1,3,5", "1-3,7".
 * Returns an array of individual verse numbers.
 */
function parseVerses(versesStr: string): number[] {
  const verses: number[] = [];
  // Second line only: the handler rejects an overlong list with a message
  // before it gets here. This slice used to be the reporting layer and said
  // nothing — "1,2,…,35" on Ps 119 came back as verses 1-30, isError false, no
  // hint, and the answer looked complete (measured 26.07.2026).
  const parts = versesStr.split(",").map((p) => p.trim()).slice(0, MAX_VERSE_PARTS);

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

/**
 * The verse payload shared by `bible_lookup` and the two text resources.
 * Returns null when the reference resolves to no verse at all; the caller words
 * that miss, because only it knows how the reference was spelled.
 *
 * `form` decides how the verses are carried, and that is the one difference
 * between the two callers. The tool has always delivered a single `text` with
 * the verse numbers folded in; a resource carries `verse_einzeln` instead,
 * because it is attached to a conversation and quoted from, and a composite
 * string is exactly what got cut at both ends in `bible_crossrefs` (25.07.2026,
 * Joh 11,25-26). Carrying both would cost 2,57× (Psalm 119, Luther: 13 562 →
 * 34 876 characters), `verse_einzeln` alone costs 1,58× — so it replaces `text`
 * rather than joining it. In the tool the surcharge would count twice, since
 * the payload also travels as `structuredContent`; that is why the tool keeps
 * the composite string.
 */
function lookupPayload(
  code: TranslationCode,
  bookId: number,
  chapter: number,
  versesStr: string,
  form: "text" | "verse_einzeln"
): Record<string, unknown> | null {
  const results = lookupVerses(code, bookId, chapter, versesStr);
  if (results.length === 0) return null;

  const verse_einzeln = results.map((r) => ({ verse: r.verse, text: stripHtml(r.text) }));
  const reference =
    `${getBookDisplayName(bookId)} ${chapter},` +
    formatVerseReference(verse_einzeln.map((r) => r.verse));
  const hinweise = bracketHints(verse_einzeln.map((r) => r.text));

  return {
    reference,
    translation: TRANSLATIONS[code].name,
    ...(form === "text"
      ? {
          text: verse_einzeln
            .map((r) => (verse_einzeln.length > 1 ? `${r.verse} ${r.text}` : r.text))
            .join(" "),
        }
      : { verse_einzeln }),
    ...(hinweise.length > 0 ? { hinweis: hinweise.join(" ") } : {}),
    quellen: quellen(translationQuelle(code)),
  };
}

// --- bible_original helpers ------------------------------------------------
/**
 * Edition routing, lookup and word payload for one verse, shared by the
 * `bible_original` tool and the `bible://grundtext/…` resource.
 *
 * Starts after the argument check, because the two callers read their arguments
 * from different places (a tool argument object, a URI segment) but must route
 * and answer identically from there on. `bookLabel` appears only in the "no
 * data" message and is the caller's spelling, so that message stays what it was.
 */
function originalPayload(
  bookLabel: string,
  bookId: number,
  chapter: number,
  verse: number,
  texttyp: unknown
): { payload: Record<string, unknown> } | { error: string } {
  if (!stmtOriginal || availableEditions.size === 0) {
    return {
      error:
        "Urtext-Daten nicht geladen. Bitte zuerst 'bun run download:byz' " +
        "(und optional 'bun run download:sblgnt') ausführen.",
    };
  }

  // Route by testament: OT (1–39) → Hebrew WLC; NT (40–66) → Greek text type.
  const isOT = bookId < 40;
  let edition: string;
  let hinweisZusatz = "";
  if (isOT) {
    edition = "wlc";
    const wanted = resolveEdition(texttyp);
    if (texttyp && wanted !== "wlc") {
      hinweisZusatz =
        ` (Der Texttyp "${String(texttyp)}" gilt nur fürs NT; fürs AT wird der hebräische WLC verwendet.)`;
    }
  } else {
    const wanted = resolveEdition(texttyp);
    if (wanted === null || !NT_EDITIONS.has(wanted)) {
      return {
        error:
          `Error: Unbekannter oder fürs NT ungültiger texttyp "${String(texttyp)}". ` +
          `Erlaubt fürs NT: "byzantine" (Mehrheitstext, Standard), "sblgnt" (kritisch), "tr" (Textus Receptus).`,
      };
    }
    edition = wanted;
  }

  if (!availableEditions.has(edition)) {
    return {
      error:
        `Texttyp "${edition}" ist nicht geladen. Verfügbar: ${[...availableEditions].join(", ")}. ` +
        (edition === "wlc" ? "Für das AT bitte 'bun run download:heb' ausführen." : ""),
    };
  }

  const rows = stmtOriginal.all(edition, bookId, chapter, verse);
  if (rows.length === 0) {
    return {
      error: `Keine Urtext-Daten für ${bookLabel} ${chapter},${verse} (Texttyp ${edition}).`,
    };
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

  return {
    payload: {
      reference: `${getBookDisplayName(bookId)} ${chapter},${verse}`,
      texttyp: edition,
      edition: meta0.label,
      sprache: meta0.sprache,
      hinweis: meta0.hinweis + hinweisZusatz,
      woerter,
      quellen: quellen(meta0.quelle),
    },
  };
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
          `${t.ed} liest hier "${liesForm}"; die TAGNT-Notiz führt dafür nur ` +
            `${[...v.zeugen].join("+") || "keine Edition"} als Zeugen. Für diese Edition gilt ` +
            "der Editionstext."
        );
      } else if (!liestVariante && genannt) {
        abgleich.push(
          `${t.ed} liest hier "${liesForm}", nicht "${v.form}"; die TAGNT-Notiz nennt ` +
            `${label} jedoch als Zeugen für "${v.form}". Für diese Edition gilt der Editionstext.`
        );
      }
    }
  }
  return { belege, abgleich };
}


// --- Output schemas — one per read tool ------------------------------------
// Declared so a consuming program can find a field instead of parsing prose,
// and so `structuredContent` has something to be checked against.
//
// Two rules hold for all of them, and both are load-bearing:
//
// 1. `required` lists ONLY fields present in every successful return path. For a
//    client of the 1.x SDK a declared schema is stricter than none: a successful
//    answer that does not match is rejected outright (client/index.js:500),
//    where before it was merely an answer with a field missing. Every entry
//    below therefore names the condition under which the field is absent, and
//    tests/test-golden.ts carries one case per condition. Widening `required`
//    without a matching case is how this turns into an outage.
// 2. No `additionalProperties: false`, anywhere. Adding an output field has to
//    stay a non-breaking change, which is the house rule for this interface.
//
// Field descriptions are used sparingly and only where a consumer has actually
// been measured to go wrong (counts, caveats, source fidelity). Whether a
// description inside an output schema reaches a model at all is NOT established
// — unlike the one on the tool itself, which is (see bible_lookup).

/** Identical in every answer, so it is declared once. `nennung: null` means the
 *  licence requires no attribution; that is a statement, not a missing value. */
const QUELLEN_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      werk: { type: "string" },
      lizenz: { type: "string" },
      nennung: { type: ["string", "null"] },
    },
    required: ["werk", "lizenz", "nennung"],
  },
};

/** Conditional: `hinweis` (only when the text carries bracketed words — Menge
 *  has 137 such verses, the other three translations none). */
const LOOKUP_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
    translation: { type: "string" },
    text: { type: "string" },
    hinweis: { type: "string" },
    quellen: QUELLEN_SCHEMA,
  },
  required: ["reference", "translation", "text", "quellen"],
};

/** Conditional: `woerter[].strong` (absent for all 137 554 SBLGNT words and for
 *  5951 WLC words; byzantine and tr carry it throughout). */
const ORIGINAL_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
    texttyp: { type: "string" },
    edition: { type: "string" },
    sprache: { type: "string" },
    hinweis: { type: "string" },
    woerter: {
      type: "array",
      items: {
        type: "object",
        properties: {
          wort: {
            type: "string",
            description:
              "Verbatim from the edition: byzantine/tr unaccented, sblgnt accented, wlc with " +
              "cantillation marks and the OSHB morpheme separator. Quote as is; do not add " +
              "accents and do not smooth characters away.",
          },
          grundform: { type: "string" },
          morphologie: { type: "string" },
          code: { type: "string" },
          strong: { type: "string" },
        },
        required: ["wort", "grundform", "morphologie", "code"],
      },
    },
    quellen: QUELLEN_SCHEMA,
  },
  required: ["reference", "texttyp", "edition", "sprache", "hinweis", "woerter", "quellen"],
};

/** Conditional: `verweise[].verse_einzeln` (only for a multi-verse target inside
 *  one chapter), `lesehinweis` (only when some reference carries it), `hinweis`
 *  (bracketed words). */
const CROSSREFS_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
    verweise: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stelle: { type: "string" },
          votes: { type: "integer" },
          text: { type: "string" },
          verse_einzeln: {
            type: "array",
            items: {
              type: "object",
              properties: { nr: { type: "integer" }, text: { type: "string" } },
              required: ["nr", "text"],
            },
            description:
              "One entry per verse, without embedded verse numbers. Quote the verses in full " +
              "from here; the joined `text` gets cut at both ends when consumers split it.",
          },
        },
        required: ["stelle", "votes", "text"],
      },
    },
    lesehinweis: { type: "string" },
    hinweis: { type: "string" },
    quellen: QUELLEN_SCHEMA,
  },
  required: ["reference", "verweise", "quellen"],
};

/** Conditional: the six lexicon fields (`strong`, `umschrift`, `kurzbedeutung`,
 *  `bedeutung`, `kjv_woerter`, `lexikon`; the last is Greek-only and all depend
 *  on strong_defs being loaded and holding an entry), `hinweis` (only when the
 *  occurrence list was capped by `limit`). */
const CONCORDANCE_OUTPUT = {
  type: "object" as const,
  properties: {
    suche: { type: "string" },
    grundform: { type: "string" },
    strong: { type: "string" },
    umschrift: { type: "string" },
    kurzbedeutung: { type: "string" },
    bedeutung: { type: "string" },
    kjv_woerter: { type: "string" },
    lexikon: { type: "string" },
    texttyp: { type: "string" },
    edition: { type: "string" },
    gesamt: {
      type: "integer",
      description: "Occurrences of the word, exact. Counts are never capped by `limit`.",
    },
    verse: { type: "integer", description: "Distinct verses containing it, exact." },
    buecher: {
      type: "array",
      items: {
        type: "object",
        properties: { buch: { type: "string" }, anzahl: { type: "integer" } },
        required: ["buch", "anzahl"],
      },
      description: "Full distribution over all occurrences, not only the listed ones.",
    },
    vorkommen: {
      type: "array",
      items: {
        type: "object",
        properties: { stelle: { type: "string" }, wort: { type: "string" } },
        required: ["stelle", "wort"],
      },
    },
    hinweis: { type: "string" },
    quellen: QUELLEN_SCHEMA,
  },
  required: [
    "suche", "grundform", "texttyp", "edition", "gesamt", "verse", "buecher", "vorkommen", "quellen",
  ],
};

/** Conditional: `vorkommen_gesamt` (only when counted AND different from
 *  `treffer`), `verteilung` (only when counted and more than one bucket). Both
 *  drop out above OCCURRENCE_SCAN_LIMIT; `hinweis` says so in that case. */
const SEARCH_OUTPUT = {
  type: "object" as const,
  properties: {
    suche: { type: "string" },
    uebersetzung: { type: "string" },
    treffer: {
      type: "integer",
      description:
        "Number of matching VERSES, not of word occurrences: a verse can match several times.",
    },
    vorkommen_gesamt: {
      type: "integer",
      description:
        "Number of word occurrences across all matching verses. Absent when the occurrences " +
        "were not counted (see `hinweis`); do not estimate it in that case.",
    },
    verteilung: {
      type: "array",
      items: {
        type: "object",
        properties: {
          buch: { type: "string" },
          kapitel: { type: "integer" },
          treffer: { type: "integer" },
          vorkommen: { type: "integer" },
        },
        required: ["treffer", "vorkommen"],
      },
      description:
        "Counted over all hits, not over the listed verses. Carries `buch` for a whole-Bible " +
        "search and `kapitel` when restricted to one book. Take these numbers; do not derive " +
        "them from the result list.",
    },
    verse: {
      type: "array",
      items: {
        type: "object",
        properties: { stelle: { type: "string" }, text: { type: "string" } },
        required: ["stelle", "text"],
      },
    },
    hinweis: { type: "string" },
    quellen: QUELLEN_SCHEMA,
  },
  required: ["suche", "uebersetzung", "treffer", "verse", "hinweis", "quellen"],
};

/** Conditional: `warnung` + `quellenkonflikte` (only when the TAGNT attestation
 *  contradicts the edition text), `bezeugung` (only when TAGNT knows the verse —
 *  9 NT verses have no row at all), and inside it `lesehinweis`,
 *  `bedeutungsvariante`, `schreibvariante`, `in_dieser_db`, `abgleich`.
 *  `vergleiche[]` has two shapes, so only `paar` is required. */
const COMPARE_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
    sprache: { type: "string" },
    warnung: {
      type: "string",
      description:
        "The TAGNT attestation contradicts the edition text here. Belongs in the answer about " +
        "this verse, not in a footnote.",
    },
    quellenkonflikte: {
      type: "array",
      items: { type: "string" },
      description:
        "Per affected form, what the edition actually reads. The edition text governs, not the " +
        "TAGNT note.",
    },
    editionen: {
      type: "array",
      items: {
        type: "object",
        properties: {
          texttyp: { type: "string" },
          edition: { type: "string" },
          woerter: { type: "integer" },
          text: { type: "string" },
        },
        required: ["texttyp", "edition", "woerter", "text"],
      },
    },
    vergleiche: {
      type: "array",
      items: {
        type: "object",
        properties: {
          paar: { type: "string" },
          ergebnis: { type: "string" },
          unterschiede: { type: "array", items: { type: "string" } },
        },
        required: ["paar"],
      },
    },
    bezeugung: {
      type: "object",
      properties: {
        quelle: { type: "string" },
        woerter_gesamt: { type: "integer" },
        von_allen_acht_bezeugt: { type: "integer" },
        lesehinweis: { type: "string" },
        abweichend: {
          type: "array",
          items: {
            type: "object",
            properties: {
              wort: { type: "string" },
              typ: { type: "string" },
              editionen: { type: "string" },
              bedeutungsvariante: { type: "string" },
              schreibvariante: { type: "string" },
              in_dieser_db: {
                // Dynamic keys: one per attested word form.
                type: "object",
                additionalProperties: { type: "array", items: { type: "string" } },
                description:
                  "Which of the loaded editions actually reads which form. Governs over the " +
                  "TAGNT note for the question what an edition reads.",
              },
              abgleich: {
                type: "array",
                items: { type: "string" },
                description: "Where the TAGNT note and the edition text disagree.",
              },
            },
            required: ["wort", "typ", "editionen"],
          },
        },
      },
      required: ["quelle", "woerter_gesamt", "von_allen_acht_bezeugt", "abweichend"],
    },
    hinweis: { type: "string" },
    quellen: QUELLEN_SCHEMA,
  },
  required: ["reference", "sprache", "editionen", "vergleiche", "hinweis", "quellen"],
};

/** Conditional: `daten_stand` (only once a download recorded provenance),
 *  `hinweis` (only while the database is missing). */
const SERVER_INFO_OUTPUT = {
  type: "object" as const,
  properties: {
    server: { type: "string" },
    version: { type: "string" },
    uebersetzungen: {
      type: "array",
      items: {
        type: "object",
        properties: { code: { type: "string" }, name: { type: "string" } },
        required: ["code", "name"],
      },
    },
    urtext_editionen: {
      type: "array",
      items: {
        type: "object",
        properties: { code: { type: "string" }, name: { type: "string" } },
        required: ["code", "name"],
      },
    },
    zusatzdaten: {
      type: "object",
      properties: {
        strong_lexikon: { type: "boolean" },
        strong_lexikon_vollstaendig: { type: "boolean" },
        editionsbezeugung: { type: "boolean" },
        querverweise: { type: "boolean" },
        volltextsuche: { type: "boolean" },
      },
      required: [
        "strong_lexikon", "strong_lexikon_vollstaendig", "editionsbezeugung",
        "querverweise", "volltextsuche",
      ],
    },
    ressourcen: {
      type: "object",
      properties: {
        statisch: { type: "array", items: { type: "string" } },
        vorlagen: { type: "array", items: { type: "string" } },
      },
      required: ["statisch", "vorlagen"],
    },
    daten_stand: { type: "string" },
    hinweis: { type: "string" },
  },
  required: [
    "server", "version", "uebersetzungen", "urtext_editionen", "zusatzdaten", "ressourcen",
  ],
};

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
    // Advertised only while data is missing, and never over HTTP: once the
    // database is in place this tool has nothing to offer, and a visible "set up
    // the database" action invites a model to re-run downloads that already
    // succeeded. On an HTTP endpoint it must not appear at all — see HTTP_MODE.
    //
    // The one tool without an outputSchema, and that is a decision rather than an
    // omission: it answers in two different shapes (the plan, and the result of a
    // run), it is the only tool that writes, and no consumer needs its output as
    // data. Declaring a schema would buy nothing and add a second shape to keep
    // in step. It therefore also keeps returning its result directly instead of
    // through jsonResult().
    ...(dataMissing !== null && !HTTP_MODE
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
              '"ELB" (Elberfelder 1871), "MB" (Menge 1939). Aliases like "luther", "schlachter" accepted.',
            default: "LUT",
          },
        },
        required: ["book", "chapter"],
      },
      outputSchema: LOOKUP_OUTPUT,
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
      outputSchema: ORIGINAL_OUTPUT,
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
      outputSchema: CROSSREFS_OUTPUT,
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
      outputSchema: CONCORDANCE_OUTPUT,
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
      outputSchema: SEARCH_OUTPUT,
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
      outputSchema: COMPARE_OUTPUT,
    },
    // Deliberately about the server, not about scripture: the version reaches
    // clients in the initialize handshake, but no client shows it to the user
    // and it does not reach the model either (measured 26.07.2026 — instructions
    // is set and still invisible in the chat). A tool result is the one channel
    // the model sees for certain, and "which version are you on?" is the first
    // question a bug report has to answer.
    //
    // Reports only what differs between installations: the release, and which
    // data this instance holds — data/ is built locally and not shipped, so two
    // servers on the same version can hold different texts. No host details
    // (uptime, paths, process, machine): this endpoint is public and
    // unauthenticated, and a stranger has no business learning them.
    {
      name: "bible_server_info",
      annotations: READ_ONLY_LOCAL,
      description:
        "Report this server's own release version and which Bible data it has loaded. " +
        "Use when asked which version runs, or when collecting facts for a bug report. " +
        "Returns no scripture — use bible_lookup for verse text.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
      outputSchema: SERVER_INFO_OUTPUT,
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

// A prompt argument is interpolated into a numbered instruction, so it gets the
// same treatment as a tool argument: a required one that is absent must say so
// rather than produce an instruction with a hole in it (`Wortstudie zu „"`),
// and line breaks or control characters would break the list the value lands
// in. 100 characters hold every legal value with room to spare — the longest
// reference is around 20 ("1. Thessalonicher 5,23"), a Strong's number five.
const MAX_PROMPT_ARG_LENGTH = 100;

/**
 * Read one prompt argument: fold whitespace and control characters, enforce the
 * length bound, and refuse an absent required value. Throws, because a prompt
 * result has no `isError` channel — the error belongs in the JSON-RPC response.
 */
function promptArg(args: Record<string, string>, name: string, required: boolean): string {
  const raw = args[name];
  const value =
    typeof raw === "string" ? raw.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim() : "";
  if (value === "") {
    if (required) throw new Error(`Missing required argument '${name}'`);
    return "";
  }
  if (value.length > MAX_PROMPT_ARG_LENGTH) {
    throw new Error(`Argument '${name}' must be at most ${MAX_PROMPT_ARG_LENGTH} characters`);
  }
  return value;
}

/** "\"LUT\" (Luther 1912), \"SCH\" (…)" — codes alone identify nothing. */
function loadedTranslationList(): string {
  return [...availableTranslations]
    .sort()
    .map((code) => `"${code}" (${TRANSLATIONS[code as TranslationCode]?.name ?? code})`)
    .join(", ");
}

const handleGetPrompt = async (request: GetPromptRequest) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, string>;

  let text: string;
  if (name === "word-study") {
    const word = promptArg(args, "word", true);
    const ref = promptArg(args, "reference", false);
    // Every step names the fields the answer actually carries, not the concepts
    // behind them: "Gloss, Definition, Abbott-Smith" used to stand here, while
    // the response speaks of `kurzbedeutung`, `bedeutung` and `lexikon`. Same
    // reason the bare edition keys got their names in `bible_server_info` —
    // a consumer cannot resolve a term the payload never uses.
    const lexikon = !hasStrongDefs
      ? " Lexikondaten sind in dieser Datenbank nicht geladen; das Bedeutungsspektrum ergibt sich dann allein aus den Belegstellen."
      : hasStepCols
        ? " Die Lexikondaten stehen in 'kurzbedeutung', 'bedeutung', 'umschrift', 'kjv_woerter' und, nur bei Griechisch, im vollständigen Abbott-Smith-Artikel unter 'lexikon'."
        : " Die Lexikondaten stehen in 'bedeutung', 'umschrift' und 'kjv_woerter'; 'kurzbedeutung' und 'lexikon' fehlen in dieser Datenbank.";
    const startpunkt = ref
      ? `Rufe bible_original für ${ref} ab und identifiziere dort das Wort (Grundform + Strong-Nummer).`
      : `Ist „${word}" bereits eine Strong-Nummer oder ein griechisches/hebräisches Lemma, nutze es direkt. Ist es ein deutsches Wort, ${hasFts ? "finde über bible_search eine typische Belegstelle und rufe für sie bible_original ab" : "erfrage eine Belegstelle beim Nutzer und rufe für sie bible_original ab: die Volltextsuche ist in dieser Datenbank nicht geladen"}.`;
    text =
      `Führe eine Wortstudie zu „${word}" durch. Arbeite ausschließlich mit den Bibelstudium-Tools: zitiere keinen Bibeltext aus dem Gedächtnis.\n\n` +
      `1. Bestimme das Urtext-Wort: ${startpunkt}\n` +
      `2. Rufe bible_concordance mit der Strong-Nummer ab. Die Zahlen stehen in der Antwort und werden übernommen, nicht nachgezählt: 'gesamt' sind die Vorkommen, 'verse' die Verse, 'buecher' die vollständige Verteilung, auch wenn die Liste 'vorkommen' gekürzt ist (dann sagt es 'hinweis'). Alle Zahlen gelten je Edition.${lexikon}\n` +
      `3. Wähle 2 bis 3 Vorkommen aus, und zwar nach der Verteilung in 'buecher' (verschiedene Bücher, auffällige Häufungen), nicht nach Bekanntheit. Rufe für sie bible_lookup ab${hasXrefs ? " und bible_crossrefs für die Parallelstellen" : ""}.\n` +
      `4. Fasse das Bedeutungsspektrum zusammen: Grundbedeutung, Bedeutungsnuancen nach Kontext, auffällige Verteilung. Belege jede Aussage mit einer konkret abgerufenen Stelle; kennzeichne offene Fragen als offen.`;
  } else if (name === "variant-check") {
    const ref = promptArg(args, "reference", true);
    // Derived from what is loaded, not from a fixed triple: an instance with
    // only two NT editions would otherwise be told to call a third.
    const geladen = NT_EDITION_ORDER.filter((e) => availableEditions.has(e));
    const editionen =
      geladen.map((e) => `texttyp "${e}" (${EDITION_META[e]!.label})`).join(", ") ||
      "keine NT-Edition (in dieser Datenbank ist keine geladen, der Vergleich ist hier nicht möglich)";
    // The attestation block is optional data: naming it unconditionally would
    // send the model looking for a field that an instance without TAGNT never
    // returns. Its caveat fields get named explicitly, because they are the
    // ones measured to be skipped when they sit deep in the response.
    const bezeugung = hasTagnt
      ? ` Dazu kommt in 'bezeugung' die Bezeugung pro Wort über acht Editionen.\n` +
        `2. Lies 'warnung' und 'quellenkonflikte' zuerst, falls sie dastehen: Dort widerspricht die TAGNT-Notiz dem Editionstext, und maßgeblich ist der Editionstext. In 'bezeugung.abweichend' gilt dasselbe je Wort: 'in_dieser_db' sagt, welche der geladenen Editionen eine Form tatsächlich liest, während die Notizen 'bedeutungsvariante'/'schreibvariante' nur die Zeugen des STEPBible-Apparats nennen. Aus einer Notiz folgt nicht, dass die übrigen Editionen anders lesen.\n`
      : ` Die Editionsbezeugung (TAGNT) ist in dieser Datenbank nicht geladen; die Antwort trägt dann kein Feld 'bezeugung'.\n`;
    text =
      `Prüfe die Textüberlieferung von ${ref}. Der Editionsvergleich gilt nur fürs Neue Testament. Arbeite ausschließlich mit den Bibelstudium-Tools: keine Behauptungen ohne Tool-Beleg.\n\n` +
      `1. Rufe bible_compare für ${ref} ab: Wort-Diff über die geladenen Editionen, hier ${editionen}.${bezeugung}` +
      `${hasTagnt ? 3 : 2}. Bei relevanten Unterschieden: Rufe bible_original für ${ref} mit jedem betroffenen texttyp ab, um die Lesarten im Wortlaut zu sehen. Das Feld 'wort' ist quellentreu (byzantine und tr sind unakzentuiert gespeichert, sblgnt akzentuiert): so zitieren, wie es dasteht, keine Akzente ergänzen.\n` +
      `${hasTagnt ? 4 : 3}. Rufe bible_lookup für ${ref} ab und prüfe, welcher Lesart der deutsche Text folgt.\n` +
      `${hasTagnt ? 5 : 4}. Ordne nüchtern ein: Welche Editionen bezeugen welche Lesart? Im Feld 'typ' steht N für Nestle-Aland, K für die KJV/TR-Tradition, O für andere; ein Kleinbuchstabe heißt „ohne Übersetzungsrelevanz". Ändert die Variante die Aussage des Verses? Keine Wertung über „besser/schlechter" ohne Datengrundlage: benenne nur, was die Editionen tatsächlich lesen.`;
  } else if (name === "translation-compare") {
    const ref = promptArg(args, "reference", true);
    const liste = loadedTranslationList();
    // Menge sets explanatory additions in square brackets (137 verses, and only
    // there). Naming it up front rather than relying on the hint in the answer:
    // the whole point of this prompt is a word-by-word comparison, which is
    // exactly where an unwrapped addition reads as the edition's own wording.
    const klammern = availableTranslations.has("MB")
      ? " Wörter in eckigen Klammern gehören zum Wortlaut der Ausgabe und bleiben beim Zitieren stehen; sie sind keine Einfügung dieses Servers."
      : "";
    text =
      `Vergleiche die deutschen Übersetzungen von ${ref}. Arbeite ausschließlich mit den Bibelstudium-Tools.\n\n` +
      `1. Rufe bible_lookup für ${ref} mit jeder geladenen Übersetzung ab: ${liste || "keine (in dieser Datenbank ist keine Übersetzung geladen)"}.\n` +
      `2. Stelle die Wortlaute gegenüber und benenne die Unterschiede (Wortwahl, Satzbau, ausgelassene/ergänzte Wörter).${klammern}\n` +
      `3. Prüfe auffällige Unterschiede am Urtext: Rufe bible_original für ${ref} ab (AT: hebräischer WLC; NT: nach texttyp) und kläre, welche Wiedergabe dem Grundtext am nächsten kommt. Bei NT-Versen zusätzlich bible_compare, denn die Übersetzungen können verschiedenen Editionen folgen.\n` +
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

// --- MCP server — resources ------------------------------------------------
// The third primitive, and the only one the *user* reaches for: a tool or a
// prompt is picked by the model, a resource is attached by hand. That is why the
// names, descriptions and URI words here are German while tool and prompt
// identifiers are English — the audience is different.
//
// The catalogue stays small on purpose. `resources/list` crosses the wire at
// every session start, and this database holds 31 102 verses in 1190 chapters:
// enumerating any part of that would dwarf `tools/list` (14 969 characters,
// measured 02.08.2026). The parameterised space lives in URI templates, the
// list carries four fixed entries that describe the inventory itself.

const URI_SCHEME = "bible://";

// Derived from the bounds the segments already carry, not chosen: the scheme,
// four name-like segments (each bounded by MAX_BOOK_LENGTH, the widest such
// bound in use), a verse list of MAX_VERSES_LENGTH, the separators, and a
// factor of three because percent-encoding turns one non-ASCII character into
// up to nine (three UTF-8 bytes at three characters each). Like
// MAX_VERSES_LENGTH this can never be the only bound violated — it exists to
// turn away an oversized URI before the first split, not as a rule of its own.
const MAX_URI_LENGTH =
  URI_SCHEME.length + 4 + (4 * MAX_BOOK_LENGTH + MAX_VERSES_LENGTH) * 3;

const RESOURCES = [
  {
    uri: "bible://buecher",
    name: "Bücher",
    description:
      "Die 66 Bücher mit Nummer, Name, Kapitelzahl und Testament. Die Namen und " +
      "ihre Abkürzungen sind es, die in den URI-Vorlagen als {buch} stehen.",
    mimeType: "application/json",
  },
  {
    uri: "bible://uebersetzungen",
    name: "Übersetzungen",
    description:
      "Die geladenen deutschen Übersetzungen mit Kürzel, Name, Lizenz und " +
      "geforderter Namensnennung, dazu die Voreinstellung.",
    mimeType: "application/json",
  },
  {
    uri: "bible://editionen",
    name: "Grundtext-Editionen",
    description:
      "Die geladenen Editionen des Grundtextes mit Sprache, Eigenheiten der " +
      "Schreibung, Lizenz und Namensnennung, dazu die Zuordnung nach Testament.",
    mimeType: "application/json",
  },
  {
    uri: "bible://quellen",
    name: "Quellen und Lizenzen",
    description:
      "Alle Quellen, aus denen diese Instanz tatsächlich Daten führt, mit Lizenz " +
      "und der Nennung, die beim Weitergeben verlangt ist.",
    mimeType: "application/json",
  },
] as const;

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "bible://kapitel/{uebersetzung}/{buch}/{kapitel}",
    name: "Kapitel",
    description:
      "Ein ganzes Kapitel in einer Übersetzung, Vers für Vers. {uebersetzung} " +
      'nimmt Kürzel oder Namen ("LUT", "Schlachter"), {buch} den deutschen ' +
      'Buchnamen oder eine Abkürzung ("Johannes", "1. Mose", "Röm").',
    mimeType: "application/json",
  },
  {
    uriTemplate: "bible://vers/{uebersetzung}/{buch}/{kapitel}/{verse}",
    name: "Vers oder Versbereich",
    description:
      'Einzelne Verse einer Übersetzung. {verse} nimmt "16", einen Bereich ' +
      '"16-17" oder eine Liste "1-3,7".',
    mimeType: "application/json",
  },
  {
    uriTemplate: "bible://grundtext/{edition}/{buch}/{kapitel}/{vers}",
    name: "Grundtext eines Verses",
    description:
      "Ein Vers Wort für Wort mit Grundform, Strong-Nummer und aufgelöster " +
      'Morphologie. {edition} nimmt "byzantine", "sblgnt", "tr" (Neues ' +
      'Testament) oder "wlc" (Altes Testament).',
    mimeType: "application/json",
  },
] as const;

/**
 * Why the lists are empty without data, and why reading throws.
 *
 * A resource result has no `isError` channel, so a refusal belongs in the
 * JSON-RPC response — same as with prompts. And the wording splits by transport
 * for the same reason the tool gate does: over stdio the caller started this
 * process and can run bible_setup, over HTTP the caller is a stranger for whom
 * naming that tool describes something that does not exist there.
 */
function requireData(): void {
  if (dataMissing === null) return;
  throw new Error(
    HTTP_MODE
      ? `${dataMissing} Dieser Endpunkt hat derzeit keine Bibeldaten. Das lässt sich ` +
          "nur serverseitig beheben; ein erneuter Abruf hilft nicht."
      : `${dataMissing} Dieser Server bringt die Bibeldaten nicht mit. Über das ` +
          "Werkzeug bible_setup lassen sie sich einmalig laden; danach ist die " +
          "Ressource abrufbar."
  );
}

const handleListResources = async () => ({
  resources: dataMissing !== null ? [] : RESOURCES.map((r) => ({ ...r })),
});

const handleListResourceTemplates = async () => ({
  resourceTemplates: dataMissing !== null ? [] : RESOURCE_TEMPLATES.map((t) => ({ ...t })),
});

// --- Resources — URI segments ----------------------------------------------
// Every segment check reuses the bound and the message the tools already use.
// Six of those messages once named a condition the input satisfied because the
// limit sat next to a separately worded text (25.07.2026); a resource path with
// its own wording would repeat that, so there is none here.

/**
 * Check arity and reject empty segments, then hand back a copy.
 *
 * The empty check is not cosmetic: `resolveTranslation("")` answers with the
 * default, so "bible://kapitel/…//23" would silently serve Luther for a
 * translation the caller never named. Callers index the result with `!`, and
 * this length check is what justifies it.
 *
 * No "Error:" prefix on the messages formulated here — the house rule is that a
 * message opens with the statement, and a client of the 1.x SDK already prefixes
 * a JSON-RPC error with "MCP error <code>: " (types.js:2031), so the word would
 * appear twice. The messages inherited from the tools keep their prefix: there
 * being character-identical to the tool is worth more than the house style.
 */
function requireSegments(rest: readonly string[], count: number, form: string): string[] {
  if (rest.length !== count || rest.some((s) => s === "")) {
    throw new Error(`Falsche Form der URI. Erwartet: "${form}".`);
  }
  return [...rest];
}

/**
 * Length and resolution are separate because the tools check them at different
 * points: `bible_lookup` bounds the book name first but resolves it only after
 * chapter and verses, so a URI that violates two conditions must report the same
 * one the tool would. Folded together, the resource named the book while the
 * tool named the chapter.
 */
function requireBookLength(segment: string): void {
  if (segment.length > MAX_BOOK_LENGTH) throw new Error(bookTooLong);
}

function segmentBookId(segment: string): number {
  const bookId = resolveBook(segment);
  if (bookId === null) throw new Error(bookNotFoundMessage(segment));
  return bookId;
}

function segmentChapter(segment: string): number {
  const chapter = toInt(segment);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    throw new Error(chapterOutOfRange);
  }
  return chapter;
}

function segmentVerse(segment: string): number {
  const verse = toInt(segment);
  if (verse === null || verse < 1 || verse > MAX_VERSE) throw new Error(verseOutOfRange);
  return verse;
}

/** Same four checks, same order and same messages as in `bible_lookup`. */
function segmentVerses(segment: string): string {
  if (segment.length > MAX_VERSES_LENGTH) throw new Error(versesTooLong);
  if (segment.split(",").length > MAX_VERSE_PARTS) throw new Error(versesTooManyParts);
  const ausserhalb = [...segment.matchAll(/\d+/g)].some(([n]) => {
    const value = parseInt(n, 10);
    return value < 1 || value > MAX_VERSE;
  });
  if (ausserhalb) throw new Error(versesOutOfBounds);
  return segment;
}

function segmentTranslation(segment: string): TranslationCode {
  const resolved = requireTranslation(segment);
  if ("error" in resolved) throw new Error(resolved.error);
  return resolved.code;
}

// --- Resources — payloads ---------------------------------------------------
// Each of the four fixed resources reports what this instance actually carries,
// never a fixed list: an installation without the Hebrew download would
// otherwise advertise an edition it cannot serve. Same rule the prompts follow
// since 0.5.7.

function booksPayload(): Record<string, unknown> {
  return {
    buecher: stmtBooks.all().map((b) => ({
      nummer: b.book_id,
      name: b.name,
      kapitel: b.chapters,
      testament: b.book_id < 40 ? "AT" : "NT",
    })),
    hinweis:
      "Die Nummern sind die Zählung dieser Datenbank: 1 bis 39 Altes Testament, " +
      "40 bis 66 Neues Testament. Als {buch} in einer URI genügt auch eine " +
      'Abkürzung ("Röm", "1Mo"); aufgelöst wird sie wie bei den Werkzeugen.',
  };
}

/** The loaded translations in registry order, so the output is deterministic. */
function loadedTranslationCodes(): TranslationCode[] {
  return (Object.keys(TRANSLATIONS) as TranslationCode[]).filter((code) =>
    availableTranslations.has(code)
  );
}

function translationsPayload(): Record<string, unknown> {
  return {
    uebersetzungen: loadedTranslationCodes().map((code) => ({
      kuerzel: code,
      name: TRANSLATIONS[code].name,
      lizenz: TRANSLATIONS[code].license,
      nennung: TRANSLATIONS[code].attribution,
    })),
    voreinstellung: DEFAULT_TRANSLATION,
    hinweis:
      "Aufgeführt ist, was diese Instanz geladen hat. Steht bei 'nennung' null, " +
      "verlangt die Lizenz keine Namensnennung.",
  };
}

/**
 * OT edition first, then the NT editions in comparison order. Every entry is a
 * literal key of EDITION_META, which is what justifies the `!` on the lookups
 * below; a new edition has to be added to both or the assertion loses its base.
 */
const EDITION_ORDER: readonly string[] = ["wlc", ...NT_EDITION_ORDER];

function editionsPayload(): Record<string, unknown> {
  return {
    editionen: EDITION_ORDER.filter((e) => availableEditions.has(e)).map((e) => {
      const meta = EDITION_META[e]!;
      return {
        kuerzel: e,
        edition: meta.label,
        sprache: meta.sprache,
        hinweis: meta.hinweis,
        lizenz: meta.quelle.lizenz,
        nennung: meta.quelle.nennung,
      };
    }),
    zuordnung:
      "Altes Testament immer 'wlc'. Fürs Neue Testament entscheidet die Angabe " +
      "in der URI, Voreinstellung ist 'byzantine'.",
  };
}

function sourcesPayload(): Record<string, unknown> {
  return {
    quellen: quellen(
      ...loadedTranslationCodes().map(translationQuelle),
      ...EDITION_ORDER.filter((e) => availableEditions.has(e)).map((e) => EDITION_META[e]!.quelle),
      hasXrefs ? DATASET_QUELLEN.crossrefs : undefined,
      hasTagnt ? DATASET_QUELLEN.tagnt : undefined,
      hasStrongDefs ? DATASET_QUELLEN.lexikon_strongs : undefined,
      hasStepCols ? DATASET_QUELLEN.lexikon_step : undefined
    ),
    hinweis:
      "Genannt ist nur, wovon diese Instanz Daten führt. Das Feld 'nennung' ist " +
      "eine Lizenzbedingung, keine Herkunftsnotiz: wer den Text weitergibt, gibt " +
      "sie vollständig mit weiter, samt Adresse. Steht dort null, verlangt die " +
      "Lizenz keine Nennung.",
  };
}

function versesPayload(
  uebersetzung: string,
  buch: string,
  kapitel: string,
  verse: string
): Record<string, unknown> {
  // Same order as bible_lookup: bound the name, then chapter, then the verse
  // list, then resolve. See requireBookLength.
  requireBookLength(buch);
  const chapter = segmentChapter(kapitel);
  const versesStr = segmentVerses(verse);
  const bookId = segmentBookId(buch);
  const code = segmentTranslation(uebersetzung);

  const payload = lookupPayload(code, bookId, chapter, versesStr, "verse_einzeln");
  if (payload === null) {
    throw new Error(
      `Keine Verse für ${buch} ${chapter}${versesStr ? "," + versesStr : ""}. ` +
        "Kapitel- und Versnummern prüfen."
    );
  }
  return payload;
}

function grundtextPayload(
  edition: string,
  buch: string,
  kapitel: string,
  vers: string
): Record<string, unknown> {
  // Same order as bible_original, for the same reason as above.
  requireBookLength(buch);
  const chapter = segmentChapter(kapitel);
  const verse = segmentVerse(vers);
  const bookId = segmentBookId(buch);

  const result = originalPayload(buch, bookId, chapter, verse, edition);
  if ("error" in result) throw new Error(result.error);
  return result.payload;
}

// --- Resources — read -------------------------------------------------------
const handleReadResource = async (request: ReadResourceRequest) => {
  const uri = request.params.uri;
  requireData();

  if (uri.length > MAX_URI_LENGTH) {
    throw new Error(`Die URI darf höchstens ${MAX_URI_LENGTH} Zeichen lang sein.`);
  }
  if (!uri.startsWith(URI_SCHEME)) {
    throw new Error(
      `Unbekannte URI "${uri}". Die Ressourcen dieses Servers beginnen mit "${URI_SCHEME}".`
    );
  }

  // Parsed by hand, not through `new URL()`: that would read the first segment
  // as an authority and lower-case it, so "bible://kapitel/SCH/…" would arrive
  // with a translation code this server does not know.
  let segments: string[];
  try {
    segments = uri.slice(URI_SCHEME.length).split("/").map(decodeURIComponent);
  } catch {
    throw new Error(
      `Die URI "${uri}" enthält eine unvollständige Prozentkodierung. Sonderzeichen ` +
        'im Buchnamen als UTF-8 kodieren (z. B. "R%C3%B6mer").'
    );
  }

  const kind = segments[0] ?? "";
  const rest = segments.slice(1);
  let payload: Record<string, unknown>;

  if (kind === "buecher") {
    requireSegments(rest, 0, "bible://buecher");
    payload = booksPayload();
  } else if (kind === "uebersetzungen") {
    requireSegments(rest, 0, "bible://uebersetzungen");
    payload = translationsPayload();
  } else if (kind === "editionen") {
    requireSegments(rest, 0, "bible://editionen");
    payload = editionsPayload();
  } else if (kind === "quellen") {
    requireSegments(rest, 0, "bible://quellen");
    payload = sourcesPayload();
  } else if (kind === "kapitel") {
    const p = requireSegments(rest, 3, "bible://kapitel/{uebersetzung}/{buch}/{kapitel}");
    payload = versesPayload(p[0]!, p[1]!, p[2]!, "");
  } else if (kind === "vers") {
    const p = requireSegments(rest, 4, "bible://vers/{uebersetzung}/{buch}/{kapitel}/{verse}");
    payload = versesPayload(p[0]!, p[1]!, p[2]!, p[3]!);
  } else if (kind === "grundtext") {
    const p = requireSegments(rest, 4, "bible://grundtext/{edition}/{buch}/{kapitel}/{vers}");
    payload = grundtextPayload(p[0]!, p[1]!, p[2]!, p[3]!);
  } else {
    throw new Error(
      `Unbekannte Ressource "${uri}". Bekannt sind ` +
        `${RESOURCES.map((r) => r.uri).join(", ")} sowie die Vorlagen ` +
        `${RESOURCE_TEMPLATES.map((t) => t.uriTemplate).join(", ")}.`
    );
  }

  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2),
      },
    ],
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
  // Hiding the tool from tools/list is not enough: a caller may name any tool it
  // likes, and this one writes. The refusal has to sit in the handler.
  if (HTTP_MODE) {
    return errorResult(
      "Dieses Werkzeug steht im HTTP-Modus nicht zur Verfügung. Die Datenbank baut " +
        "die Betreiberin oder der Betreiber des Endpunkts auf, nicht der aufrufende Client."
    );
  }

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
      "beenden und neu starten; erst danach kann dieser Server sie lesen. Gib diesen Satz " +
      "unbedingt weiter.",
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

/**
 * Version and data inventory of this instance. Field names are German like the
 * other tool payloads. Every value comes from a check already made at startup,
 * so the call costs nothing beyond serialising.
 *
 * Inventory rather than statistics: a verse total says nothing a caller can act
 * on, while "does this server have the original text, Strong's, cross-references"
 * decides which questions it can answer at all. The download steps are separate
 * and each optional, so an instance missing one of them is a normal state — and
 * the usual cause when a tool comes back empty.
 */
function handleServerInfo() {
  const result = {
    server: "bibelstudium-mcp",
    version: PACKAGE_VERSION,
    uebersetzungen: [...availableTranslations].sort().map((code) => ({
      code,
      name: TRANSLATIONS[code as TranslationCode]?.name ?? code,
    })),
    // Same shape as `uebersetzungen`, and for the same reason: the bare keys
    // ("byzantine", "tr") do not identify an edition, and a caller cannot look
    // them up anywhere in this payload. Which text form is loaded decides which
    // questions this instance can answer at all, so the name belongs here.
    // Names come from EDITION_META, where text, license and hinweis already sit
    // together, rather than a second list that could drift from it. Empty when
    // download-morph.ts never ran; `?? code` keeps an edition the database
    // carries but the table does not know visible instead of dropping it.
    urtext_editionen: originalEditions.map((code) => ({
      code,
      name: EDITION_META[code]?.label ?? code,
    })),
    zusatzdaten: {
      strong_lexikon: hasStrongDefs,
      // Ältere Datenbanken haben strong_defs ohne die STEPBible-Spalten, dann
      // fehlen Gloss und Bedeutung trotz vorhandenem Lexikon.
      strong_lexikon_vollstaendig: hasStepCols,
      editionsbezeugung: hasTagnt,
      querverweise: hasXrefs,
      volltextsuche: hasFts,
    },
    // Bestand heißt auch: was dieser Server anbietet, nicht nur was er geladen
    // hat. Die vier festen Ressourcen stehen in `resources/list`, die drei
    // Vorlagen nur in `resources/templates/list`, und ob ein Client die
    // überhaupt abruft, ist nicht belegt. Diese Auskunft ist der Kanal, der das
    // Modell nachweislich erreicht (deshalb gibt es sie überhaupt), also stehen
    // die Vorlagen auch hier. Aus denselben Konstanten und mit derselben Sperre
    // wie die Listen, damit beide nicht auseinanderlaufen: eine Instanz ohne
    // Daten meldet hier nichts, was dort nicht abrufbar wäre.
    ressourcen: {
      statisch: dataMissing !== null ? [] : RESOURCES.map((r) => r.uri),
      vorlagen: dataMissing !== null ? [] : RESOURCE_TEMPLATES.map((t) => t.uriTemplate),
    },
    ...(dataFetchedAt !== null ? { daten_stand: dataFetchedAt } : {}),
    ...(dataMissing !== null ? { hinweis: dataMissing } : {}),
  };
  return jsonResult(result);
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

  // Answered before the dataMissing gate below, and deliberately so: an instance
  // without data is exactly when someone asks what this server is and what it
  // has. Sending "no Bible database" instead of the version would withhold the
  // one fact that was asked for.
  if (toolName === "bible_server_info") {
    return handleServerInfo();
  }

  // One gate for all six data tools instead of a check per handler: without a
  // database every one of them would otherwise answer "book not found", which
  // reads like the reference was wrong rather than like nothing is loaded yet.
  if (dataMissing !== null) {
    // Two audiences, two messages. Over stdio the caller can fix this, so name
    // the tool that does it. Over HTTP the caller is a stranger with no access to
    // the machine: pointing at bible_setup would name a tool that is not offered
    // and cannot be used. The one instruction that holds either way is the last
    // sentence.
    return errorResult(
      HTTP_MODE
        ? `${dataMissing} Dieser Endpunkt hat derzeit keine Bibeldaten und kann keine ` +
            "Stelle nachschlagen. Das lässt sich nur serverseitig beheben; ein erneuter " +
            "Aufruf hilft nicht. Beantworte die Bibelfrage nicht aus dem Gedächtnis, " +
            "sondern sage, dass der Bibelserver derzeit keine Daten hat."
        : `${dataMissing} Dieser Server bringt die Bibeldaten nicht mit, sie werden einmalig ` +
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

  // Validate required inputs. Presence and length are separate checks so that
  // each message names the condition that is actually violated.
  if (!book || typeof book !== "string") {
    return errorResult("Error: 'book' is required (e.g. 'Jesaja', '1. Mose', 'Römer').");
  }
  if (book.length > MAX_BOOK_LENGTH) {
    return errorResult(bookTooLong);
  }

  const chapter = toInt(args.chapter);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    return errorResult(chapterOutOfRange);
  }

  // Accept verses as string or single number (lenient towards MCP clients).
  const verses =
    args.verses === undefined || args.verses === null
      ? ""
      : typeof args.verses === "string"
        ? args.verses
        : typeof args.verses === "number" && Number.isInteger(args.verses)
          ? String(args.verses)
          : null;
  // Cheapest guard first: type, length, segment count, values.
  if (verses === null) {
    return errorResult(versesNotAString);
  }
  if (verses.length > MAX_VERSES_LENGTH) {
    return errorResult(versesTooLong);
  }
  if (verses.split(",").length > MAX_VERSE_PARTS) {
    return errorResult(versesTooManyParts);
  }
  // Ahead of both lookup paths, because they used to disagree: the fast path
  // for a simple span did not check MAX_VERSE at all ("1-500" answered like
  // valid input), while the parseVerses path dropped the offending segment
  // silently ("1-500,2" answered with verse 2 alone). Same meaning, two
  // results, decided by a comma (measured 26.07.2026).
  if ([...verses.matchAll(/\d+/g)].some(([n]) => {
    const value = parseInt(n, 10);
    return value < 1 || value > MAX_VERSE;
  })) {
    return errorResult(versesOutOfBounds);
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

  // Look up verses. Payload shared with the text resources; `text` is the shape
  // this tool has always returned (see lookupPayload).
  const response = lookupPayload(resolved.code, bookId, chapter, verses, "text");
  if (response === null) {
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

  return jsonResult(response);
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
  const { book } = args;

  if (!book || typeof book !== "string") {
    return errorResult("Error: 'book' is required (e.g. '1. Mose', 'Jesaja', 'Römer').");
  }
  if (book.length > MAX_BOOK_LENGTH) {
    return errorResult(bookTooLong);
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

  const result = originalPayload(book, bookId, chapter, verse, args.texttyp);
  if ("error" in result) {
    return errorResult(result.error);
  }

  return jsonResult(result.payload);
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
  if (!book || typeof book !== "string") {
    return errorResult("Error: 'book' is required (e.g. '1. Mose', 'Jesaja', 'Römer').");
  }
  if (book.length > MAX_BOOK_LENGTH) {
    return errorResult(bookTooLong);
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
    verweise,
    ...(verweise.some((v) => "verse_einzeln" in v)
      ? {
          lesehinweis:
            "Mehrversige Verweise tragen zusätzlich 'verse_einzeln' (ein Eintrag je Vers, " +
            "ohne eingebettete Versnummern). Beim Zitieren daraus die Verse vollständig " +
            "übernehmen, nicht Anfang oder Ende des Abschnitts weglassen.",
        }
      : {}),
    ...(hinweise.length > 0 ? { hinweis: hinweise.join(" ") } : {}),
    quellen: quellen(DATASET_QUELLEN.crossrefs, translationQuelle(translation)),
  };

  return jsonResult(response);
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
    if (typeof args.lemma !== "string") {
      return errorResult("Error: 'lemma' must be a Greek or Hebrew word.");
    }
    if (args.lemma.length > MAX_LEMMA_LENGTH) {
      return errorResult(`Error: 'lemma' must be at most ${MAX_LEMMA_LENGTH} characters`);
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
        "Hinweis: Lemma muss exakt (mit Akzenten/Punktierung) übereinstimmen; im Zweifel Strong-Nummer verwenden."
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
  // Which lexicon actually contributed decides the attribution below: translit,
  // definition and kjv come from the Strong's dictionaries (CC BY-SA), gloss and
  // the Abbott-Smith entry from STEPBible (CC BY 4.0). Naming a source that did
  // not contribute is the same error as omitting one that did.
  let usedStrongsLexicon = false;
  let usedStepLexicon = false;
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
      usedStrongsLexicon = Boolean(def.translit || def.definition || def.kjv);
      usedStepLexicon = Boolean(def.gloss || def.meaning);
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
  response.quellen = quellen(
    meta0.quelle,
    usedStrongsLexicon ? DATASET_QUELLEN.lexikon_strongs : undefined,
    usedStepLexicon ? DATASET_QUELLEN.lexikon_step : undefined
  );

  return jsonResult(response);
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
    if (typeof args.book !== "string") {
      return errorResult("Error: 'book' must be a German book name.");
    }
    if (args.book.length > MAX_BOOK_LENGTH) {
      return errorResult(bookTooLong);
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
        "Gesucht wird nach exakten Wortformen: Beugungen mitdenken oder Präfixsuche " +
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
  const scanSkipped = total > OCCURRENCE_SCAN_LIMIT;
  const scan =
    !scanSkipped && stmtSearchAll && stmtSearchAllBook
      ? bookId === null
        ? stmtSearchAll.all(match, translation, OCCURRENCE_SCAN_LIMIT)
        : stmtSearchAllBook.all(match, translation, bookId, OCCURRENCE_SCAN_LIMIT)
      : null;
  const hits = (text: string) => text.split(HIT_OPEN).length - 1;
  const vorkommen = scan === null ? null : scan.reduce((sum, r) => sum + hits(r.text), 0);

  // Any breakdown a consumer might want has to be counted here rather than left
  // to the model: over six measured runs the numbers the tool stated were right
  // 10/10, while self-derived chapter sums were wrong in three of five — and
  // wrong in a way that looks counted, because the total still adds up
  // (25.07.2026). Group by book for a whole-Bible search and by chapter when the
  // search is confined to one book: that is the level the question is asked at
  // in each case. Only emitted with more than one bucket — a single-entry
  // breakdown repeats `treffer` and teaches nothing.
  const verteilung: Array<Record<string, unknown>> = [];
  if (scan !== null) {
    const buckets = new Map<number, { treffer: number; vorkommen: number }>();
    for (const r of scan) {
      const key = bookId === null ? r.book_id : r.chapter;
      const bucket = buckets.get(key) ?? { treffer: 0, vorkommen: 0 };
      bucket.treffer += 1;
      bucket.vorkommen += hits(r.text);
      buckets.set(key, bucket);
    }
    if (buckets.size > 1) {
      for (const [key, bucket] of [...buckets].sort((a, b) => a[0] - b[0])) {
        verteilung.push({
          ...(bookId === null ? { buch: getBookDisplayName(key) } : { kapitel: key }),
          treffer: bucket.treffer,
          vorkommen: bucket.vorkommen,
        });
      }
    }
  }

  const response: Record<string, unknown> = {
    suche: query,
    uebersetzung: TRANSLATIONS[translation].name,
    treffer: total,
    ...(vorkommen !== null && vorkommen !== total ? { vorkommen_gesamt: vorkommen } : {}),
    ...(verteilung.length > 0 ? { verteilung } : {}),
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
          `zusammen ${vorkommen} Vorkommen ('vorkommen_gesamt'). Die Fundstellen im Verstext sind mit ⟦…⟧ markiert: ` +
          "je Vers daran abzählen, nicht schätzen."
      : "'treffer' zählt Verse, nicht Wortvorkommen. Die Fundstellen im Verstext sind mit ⟦…⟧ markiert: " +
          "je Vers daran abzählen, nicht schätzen."
  );
  // Above the scan limit both counted fields drop out, and nothing used to say
  // so: the answer named `treffer` and kept asking the caller to count the
  // markers per verse, while the two numbers that are otherwise stated were
  // simply absent (measured 26.07.2026, "der" with 13 033 hits). By the
  // measurement `verteilung` rests on, what is missing gets estimated and still
  // reads as counted. All three numbers are per translation (`total` and the
  // scan queries carry the same `translation`), which is why the way out names
  // it alongside the narrower query.
  if (scanSkipped) {
    hinweise.push(
      `Ab ${OCCURRENCE_SCAN_LIMIT} Treffern werden die Vorkommen nicht ausgezählt: ` +
        "'vorkommen_gesamt' und 'verteilung' fehlen deshalb hier, weil nicht gezählt wurde, " +
        "nicht weil es nichts zu zählen gäbe. Diese Zahlen nicht schätzen. Wer sie braucht, " +
        `schränkt mit 'book' auf ein Buch ein oder verengt den Suchbegriff; gezählt wird ` +
        `dann wie alle Zahlen hier für ${TRANSLATIONS[translation].name}.`
    );
  }
  if (verteilung.length > 0) {
    hinweise.push(
      `'verteilung' ist über alle ${total} Treffer ausgezählt, nicht über die gelisteten Verse: ` +
        `je ${bookId === null ? "Buch" : "Kapitel"} die Zahl der Verse ('treffer') und der Vorkommen ` +
        "('vorkommen'). Diese Zahlen übernehmen, nicht aus der Trefferliste selbst aufteilen."
    );
  }
  hinweise.push(...bracketHints(rows.map((r) => r.text)));
  response.hinweis = hinweise.join(" ");
  response.quellen = quellen(translationQuelle(translation));

  return jsonResult(response);
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
  if (!book || typeof book !== "string") {
    return errorResult("Error: 'book' is required (e.g. 'Römer', '1Joh').");
  }
  if (book.length > MAX_BOOK_LENGTH) {
    return errorResult(bookTooLong);
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
      "Der Editionsvergleich gilt nur fürs NT; fürs AT gibt es nur eine Edition (hebräischer WLC)."
    );
  }

  const editions = NT_EDITION_ORDER.filter((e) => availableEditions.has(e));
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
        // The word count of a variant run is stated, not left to be counted:
        // the Comma Johanneum was reported as "16 additional words" where the
        // edition diff and the TAGNT attestation both say 17 (25.07.2026).
        // Only for runs of two or more — "(1 Wort)" on every single-word
        // difference is noise that buries the cases that matter.
        const laenge = (s: string) => {
          const n = s === "" ? 0 : s.split(" ").length;
          return n > 1 ? ` (${n} Wörter)` : "";
        };
        vergleiche.push({
          paar,
          unterschiede: segs.map((s) =>
            s.a && s.b
              ? `${A.ed}: "${s.a}"${laenge(s.a)} ↔ ${B.ed}: "${s.b}"${laenge(s.b)}`
              : s.a
                ? `nur in ${A.ed}: "${s.a}"${laenge(s.a)}`
                : `nur in ${B.ed}: "${s.b}"${laenge(s.b)}`
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
                "des eigenen Apparats; daraus folgt NICHT, dass alle übrigen Editionen die " +
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
            "tatsächlich liest; das gehört zur Antwort über diesen Vers, nicht in " +
            "eine Fußnote. Maßgeblich ist der Editionstext, nicht die TAGNT-Notiz.",
          quellenkonflikte,
        }
      : {}),
    editionen: texts.map((t) => ({
      texttyp: t.ed,
      edition: EDITION_META[t.ed]!.label,
      woerter: t.words.length,
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
      "'bedeutungsvariante', dazu 'typ'). Nicht aus diesem Hinweis erschließen und die " +
      "sprachliche Erscheinung nicht benennen, wenn sie dort nicht steht. " +
      "Wortzahlen stehen im Ergebnis: je Edition in 'woerter', je Unterschied in Klammern " +
      "hinter der Lesart; diese Zahlen übernehmen, nicht selbst nachzählen.",
    // Aus `editions`, nicht aus einer festen Dreierliste: die Auswahl ist nach
    // dem tatsächlich geladenen Bestand gefiltert und kann zwei Editionen
    // umfassen. TAGNT nur, wenn eine Bezeugung in der Antwort steht.
    quellen: quellen(
      ...editions.map((ed) => EDITION_META[ed]!.quelle),
      bezeugung !== undefined ? DATASET_QUELLEN.tagnt : undefined
    ),
  };

  return jsonResult(response);
}

// --- MCP server — construction and tool registration -----------------------
// A factory, not a singleton: one `Server` binds exactly one transport, so the
// HTTP mode below needs a fresh instance per session. Everything expensive
// (database, prepared statements, the tool list) lives at module level and is
// shared; an instance is just the handler wiring.
function createServer(): Server {
  const s = new Server(
    // Version aus package.json, nicht daneben gepflegt: sie lief bereits
    // auseinander. Der v0.3.0-Commit hob die Zahl hier von 0.2.1 auf 0.2.2,
    // während das Paket auf 0.3.0 ging, und jeder Client sah seither im
    // initialize eine Version, die es als Release nicht gibt. Der Import
    // funktioniert unter `bun run` und im kompilierten Binary gleichermaßen
    // (beides geprüft); build-mcpb.ts liest dieselbe Datei für das Manifest.
    { name: "bibelstudium-mcp", version: PACKAGE_VERSION },
    {
      // Kein `subscribe` und kein `listChanged` bei den Ressourcen: Der Bestand
      // steht für die Lebensdauer des Prozesses fest, und Subscriptions führt
      // Anthropics Connector-Dokumentation ausdrücklich als nicht unterstützt.
      // Eine angekündigte Fähigkeit, die niemand bedient, ist ein Versprechen
      // an den Client, das der Server nicht hält.
      capabilities: { tools: {}, prompts: {}, resources: {} },
      // Version auch hier, nicht nur in serverInfo: das initialize trägt sie
      // ohnehin, aber kein Client zeigt sie an, und ein Bug-Report ohne
      // Versionsangabe kostet eine Rückfrage.
      //
      // Dieses Feld allein genügt dafür nicht: Claude Desktop reicht weder das
      // initialize-Result noch instructions an das Modell durch (gemessen am
      // 26.07.2026 in zwei Sitzungen). Im Chat ist die Frage hierüber also
      // nicht beantwortbar, und genau deshalb gibt es bible_server_info, dessen
      // Ergebnis das Modell sicher sieht. Gesetzt bleibt es trotzdem: andere
      // Clients dürfen es durchreichen, und es kostet keine tools/list.
      // Wer hier etwas ändert, ändert es dort mit.
      //
      // Dieselbe einzige Quelle wie serverInfo und das MCPB-Manifest, sie kann
      // also nicht auseinanderlaufen.
      instructions:
        `bibelstudium-mcp server, version ${PACKAGE_VERSION}. ` +
        `Quote scripture only from the bible_* tools, never from memory. ` +
        `When asked which server or MCP version is running, report this version.`,
    }
  );
  s.setRequestHandler(ListToolsRequestSchema, handleListTools);
  s.setRequestHandler(ListPromptsRequestSchema, handleListPrompts);
  s.setRequestHandler(GetPromptRequestSchema, handleGetPrompt);
  s.setRequestHandler(ListResourcesRequestSchema, handleListResources);
  s.setRequestHandler(ListResourceTemplatesRequestSchema, handleListResourceTemplates);
  s.setRequestHandler(ReadResourceRequestSchema, handleReadResource);
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
//
// 'expose' nennt die Sitzungs-ID aus der Zeit vor dem zustandslosen Umbau.
// Dieser Server vergibt keine und sendet die Kopfzeile nie, ein Browser bekommt
// hier also nichts freigegeben, was es gibt. Die Zeile steht folgenlos und wird
// mit dem Umstieg auf die Revision 2026-07-28 fällig, die das Feld ganz
// streicht ("do not mint or echo session IDs").
const CORS_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};

/**
 * Why /health queries the database instead of reporting `dataMissing`.
 *
 * `dataMissing` is decided once, at startup. A file that is swapped or damaged
 * while the process runs would leave it at `null`, and /health would keep
 * answering "ok" for a server that can no longer answer a single lookup. The
 * cheapest query that proves the whole path still works is one row from the
 * table every tool needs; it is served from SQLite's page cache and costs
 * microseconds, so a monitor may poll it.
 *
 * Returns null when healthy, otherwise the reason, so the caller has something
 * to put in the response body.
 */
function healthProblem(): string | null {
  if (dataMissing !== null) return dataMissing;
  try {
    const row = db.query("SELECT COUNT(*) AS n FROM books").get() as { n: number } | null;
    if (row === null || row.n === 0) return "Die Datenbank antwortet, enthält aber keine Bücher.";
    return null;
  } catch (error) {
    return `Die Datenbank ist nicht lesbar: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Why the endpoint records which protocol revision its callers speak.
 *
 * Revision 2026-07-28 removed `initialize` and the session: a modern client
 * carries version, identity and capabilities in each request's `_meta` and
 * mirrors the version into the `MCP-Protocol-Version` header. This server runs
 * on the 1.x SDK and speaks only the handshake-based revisions, so per the
 * spec's compatibility matrix a modern client either fails outright or, worse,
 * has an era-ambiguous method served under legacy semantics: the stateless POST
 * path accepts requests without a handshake, so nothing here would notice.
 * Moving to the v2 SDK is a package split plus a rewrite of every handler
 * registration, so the trigger should be a measured client, not a date. This is
 * that measurement.
 *
 * One line per protocol version, not per request and not per client. The
 * endpoint is public and authless: a line per request would be an access log
 * nobody asked for and a free way to fill the journal. The set is capped for
 * the same reason the session registry was removed — it grows on
 * caller-supplied input, and an unbounded one is exactly the leak this server
 * already had once.
 *
 * Nothing caller-supplied is written verbatim. The version is validated against
 * the revision format rather than merely sanitised, and the client's self-
 * reported name is not recorded at all. Both follow from the privacy notice
 * this endpoint publishes, which promises operational events "ohne
 * Personenbezug": a promise about free-form text from strangers is only ever
 * kept by the goodwill of their software, whereas a value matched against
 * `YYYY-MM-DD` before it reaches the journal is kept by construction. Both the
 * `Mcp-Protocol-Version` header and `params.protocolVersion` are caller-
 * controlled — an address or a name fits in either.
 */
const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
/**
 * First revision carrying version and identity per request. Revision names are
 * ISO dates, so a string compare orders them and `>=` is the era test.
 */
const FIRST_MODERN_REVISION = "2026-07-28";
const MAX_PROTOCOL_SIGHTINGS = 20;
const protocolSightings = new Set<string>();
let modernLogged = false;

/** Stands in for a version that is not a revision name, so no such value is logged. */
const UNKNOWN_REVISION = "unbekannte Angabe";

/**
 * A protocol revision is named by its release date. Anything else is refused
 * rather than cleaned up: this is the only value from the request that reaches
 * the journal, so it is worth constraining to a shape that cannot carry a
 * message, an identifier or a control character.
 */
function asRevision(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function noteProtocolVersion(request: Request): Promise<void> {
  // The cheap path, taken by every request once a version has been seen: a
  // header lookup and a set lookup, no body read.
  const headerRevision = asRevision(request.headers.get("mcp-protocol-version"));

  // Modern sightings collapse into a single line, legacy ones are keyed by
  // version. The useful fact about a modern caller is that one exists, not
  // which date it names, and keying them by version hands an authless caller
  // both a line per invented future date and a way to crowd the real sighting
  // out of the capped set. Measured 28.07.2026: twenty fake dates produced
  // twenty warnings and then swallowed the genuine 2026-07-28 client.
  const headerModern = headerRevision !== null && headerRevision >= FIRST_MODERN_REVISION;
  if (headerModern && modernLogged) return;
  if (!headerModern) {
    if (headerRevision !== null && protocolSightings.has(headerRevision)) return;
    if (protocolSightings.size >= MAX_PROTOCOL_SIGHTINGS) return;
  }

  let bodyRevision: string | null = null;
  let modernMeta = false;
  let discover = false;

  // Read the body only for a version not yet recorded, so at most once per
  // version. The header is absent exactly on a legacy `initialize`, and on
  // clients older than 2025-06-18, which never defined it.
  try {
    const body = asRecord(await request.clone().json());
    if (body !== null) {
      discover = body["method"] === "server/discover";
      const params = asRecord(body["params"]);
      if (params !== null) {
        // Legacy: `initialize` states the version in params.
        bodyRevision = asRevision(params["protocolVersion"]);
        // Modern: every request states it in _meta instead.
        const meta = asRecord(params["_meta"]);
        if (meta !== null && typeof meta[META_PROTOCOL_VERSION] === "string") {
          modernMeta = true;
          bodyRevision = asRevision(meta[META_PROTOCOL_VERSION]);
        }
      }
    }
  } catch {
    // Not JSON, or a body this server will reject anyway. The header alone
    // still identifies the era, and failing here must not fail the request.
  }

  const revision = bodyRevision ?? headerRevision;
  // `server/discover` exists only in the modern era, so it identifies one even
  // if a caller omits the version.
  const modern = modernMeta || discover || (revision !== null && revision >= FIRST_MODERN_REVISION);
  // A caller that names no valid revision still gets counted, but under a fixed
  // label: its own string must not reach the journal.
  const shown = revision ?? UNKNOWN_REVISION;

  if (modern) {
    if (modernLogged) return;
    modernLogged = true;
  } else {
    if (protocolSightings.has(shown)) return;
    if (protocolSightings.size >= MAX_PROTOCOL_SIGHTINGS) return;
    protocolSightings.add(shown);
    if (headerRevision !== null) protocolSightings.add(headerRevision);
  }

  if (modern) {
    console.error(
      `MCP-Protokoll: ${shown} (zustandslose Revision). ` +
        "Dieser Server spricht sie nicht: er läuft auf dem 1.x-SDK und kennt nur " +
        "das initialize-Verfahren. Umstieg auf das v2-SDK prüfen."
    );
  } else {
    console.error(`MCP-Protokoll: ${shown} (initialize-Verfahren).`);
  }
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
    // Bun nimmt sonst bis zu 128 MB je Rumpf an. Die größte legitime Anfrage
    // dieses Servers ist ein Werkzeugaufruf mit einer Bibelstelle, also einige
    // hundert Byte; 1 MB lässt jeden davon durch und nimmt einem anonymen
    // Aufrufer die Möglichkeit, Speicher über den JSON-Parser zu binden.
    maxRequestBodySize: 1024 * 1024,
    // Ohne das richtet sich der Modus nach NODE_ENV, und im Entwicklungsmodus
    // liefert Bun bei einer ungefangenen Ausnahme einen Stacktrace an den
    // Aufrufer aus. Heute fängt der SDK-Transport alle geprüften Fehlerpfade
    // sauber ab; die Zeile sorgt dafür, dass ein künftiges `throw` im Handler
    // nicht zum Informationsleck wird.
    development: false,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
      }
      if (url.pathname === "/health") {
        // Reports whether the service works, not just that the process is up.
        // An HTTP endpoint has no terminal watching stderr, and with bible_setup
        // gone there is no in-band way left to notice a broken database: every
        // tool would simply refuse, one at a time. 503 rather than 200 so a
        // monitor sees it without parsing the body.
        const problem = healthProblem();
        return withCors(
          new Response(
            JSON.stringify(problem === null ? { status: "ok" } : { status: "fehler", grund: problem }),
            {
              status: problem === null ? 200 : 503,
              headers: { "content-type": "application/json" },
            }
          )
        );
      }
      if (url.pathname !== "/mcp") return withCors(new Response("Not found", { status: 404 }));

      // Spec: servers MUST validate Origin. The SDK's own option for this is
      // deprecated in favour of exactly this kind of outer check.
      const origin = request.headers.get("origin");
      if (origin !== null && !allowedOrigins.includes(origin)) {
        return withCors(new Response("Forbidden origin", { status: 403 }));
      }

      // GET wird beantwortet, aber nicht offengehalten.
      //
      // Der GET-Kanal dient server-initiierten Nachrichten. Dieser Server sendet
      // keine: er ist zustandslos, schiebt nichts und hat nichts fortzusetzen.
      // Ohne diesen Zweig lief ein GET trotzdem durch den Transport und blieb als
      // SSE-Stream offen, der nie ein Byte liefert: gemessen 120 Sekunden je
      // Verbindung (Bun `idleTimeout`), 30 parallele GETs hielten 30
      // Dateideskriptoren samt je einer Serverinstanz. Für einen anonymen
      // Endpunkt ist das ein kostenloser Verbindungshalter, und eine
      // Ratenbegrenzung davor greift bei offenen Verbindungen schlecht.
      //
      // Warum 200 und nicht 405, das die Spezifikation ausdrücklich erlaubt: Der
      // einzige fremde Endpunkt, der als authloser Custom Connector in claude.ai
      // nachweislich funktioniert, antwortet auf GET mit 200, und dieser Server
      // wurde am 25.07.2026 eigens darauf angeglichen (vorher 400). Ob claude.ai
      // den Status überhaupt auswertet, ist unbelegt (n=1). Solange das offen
      // ist, wird die gemessene Angleichung nicht wegen einer Stilfrage
      // aufgegeben: 200 bleibt, der Stream entfällt.
      if (request.method === "GET") {
        return withCors(new Response(null, { status: 200 }));
      }

      // Records the protocol revision of the caller, at most one line per
      // version seen. Never fails the request: a caller must not be able to
      // break a lookup by sending a body this cannot read.
      await noteProtocolVersion(request);

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
  /**
   * Build the database and exit — the operator's counterpart to bible_setup.
   *
   * Needed because bible_setup is stdio-only (see HTTP_MODE): without this flag,
   * setting up an HTTP endpoint would require Bun and a checkout on the host, and
   * the whole point of the compiled binary is that neither is there.
   *
   * The flag is read at module level (SETUP_CLI) because the startup log there
   * has to know about it too; argv is indexed differently for `bun run server.ts`
   * than for a compiled binary, so it is matched with `includes` rather than at a
   * fixed position and works in both.
   */
  if (SETUP_CLI) {
    // Anders als bible_setup lehnt diese Flagge bei vorhandener Datenbank nicht
    // ab: sie ist der Weg, Daten auch zu erneuern. Dann aber sagen, was passiert.
    if (dataMissing === null) {
      console.log(`Es liegt bereits eine Datenbank unter ${DB_PATH}. Sie wird neu aufgebaut.`);
    }
    const { runSetup } = await import("./scripts/setup.ts");
    const report = await runSetup((label, i, total) => {
      console.log(`[${i}/${total}] ${label}`);
    });
    for (const step of report.steps) {
      console.log(`${step.ok ? "ok  " : "FEHL"} ${step.label} (${step.seconds.toFixed(1)}s)`);
      if (!step.ok) console.log(`     ${step.error}. Nachholen mit: ${step.command}`);
    }
    console.log(`Ziel: ${DB_PATH}`);
    if (report.aborted) {
      console.error("Abgebrochen: ohne die Übersetzungen gibt es keine Datenbank.");
      process.exit(1);
    }
    return;
  }

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
