#!/usr/bin/env bun
/**
 * Bibelstudium-MCP-Server: wortgetreue Bibelarbeit über eine lokale
 * SQLite-Datenbank.
 *
 * Sieben Werkzeuge (wortgetreue deutsche Verse, Morphologie des Grundtextes,
 * Konkordanz, Querverweise, Volltextsuche, Editionsvergleich, Serverauskunft),
 * dazu `bible_setup` nur über stdio, drei geführte Prompts sowie Ressourcen
 * samt URI-Vorlagen. Deutsche Ausgabefelder, englische Werkzeugnamen.
 *
 * Übersetzungen: vier frei lizenzierte deutsche Ausgaben (siehe
 * translations.ts), voreingestellt Luther 1912. Die Daten entstehen lokal über
 * die download-*.ts-Skripte.
 *
 * Aufbau der Datei: Setup, vorbereitete Statements (ein Abschnitt je Tabelle),
 * Editionen, die drei Morphologie-Dekoder, Helfer (erst generische, dann je
 * Werkzeug), Ausgabeschemata, Werkzeug-Registrierung, Prompts, Ressourcen,
 * Dispatch, Handler, Bootstrap.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
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

// --- Setup: Datenbankverbindung und Unversehrtheitsprüfung -----------------
// DB_PATH kommt aus db-path.ts, das auch die Skripte des Datenaufbaus
// importieren. Beide Seiten müssen dieselbe Datei meinen: bible_setup ruft jene
// Skripte, und wichen sie voneinander ab, landete der Download dort, wo der
// Server nie nachsieht.

/**
 * Warum eine fehlende Datenbank den Prozess nicht mehr beendet.
 *
 * Wer das MCPB-Bundle installiert hat, hat kein Terminal dazwischen: Ein
 * Abbruch an dieser Stelle zeigte ihm „server disconnected" und sonst nichts.
 * Stattdessen startet der Server gegen eine leere Datenbank im Speicher, meldet
 * `dataMissing` und bietet bible_setup an, um die echte aufzubauen. Jedes
 * andere Werkzeug weist mit einem Verweis darauf ab (siehe handleCallTool).
 *
 * Das Schema im Speicher gibt es, damit die vorbereiteten Statements unten
 * übersetzt werden können; geschrieben wird nie hinein, und ein Neustart
 * ersetzt es, sobald der Download fertig ist. Deklariert sind nur die drei
 * Tabellen, die die Statements brauchen: Die optionalen werden über ihr
 * Vorhandensein erkannt, und ihr Fehlen ist ohnehin ein vorgesehener Zustand.
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

/** Warum die echte Datenbank nicht taugt, oder null, wenn sie taugt. */
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
  // Einer verses-Tabelle aus dem älteren Aufbau für eine einzige Übersetzung
  // fehlt die Spalte `translation`; download.ts migriert sie beim nächsten Lauf.
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
  // Kein WAL-Pragma: Die Datenbank wird nur gelesen, und WAL-Sidecar-Dateien
  // ließen sich manipulieren. Das Download-Skript setzt vor dem Schließen einen
  // WAL-Checkpoint, die Datenbank ist damit selbstgenügsam.
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
 * Ob dieser Prozess HTTP bedient statt stdio.
 *
 * Hier ausgelesen, neben `dataMissing`, weil die beiden zusammen entscheiden,
 * ob es bible_setup überhaupt gibt. Über stdio hat der Aufrufer diesen Prozess
 * gestartet und verfügt über die Maschine; ein Werkzeug, das rund 145 MB von
 * acht Quellen lädt und die Datenbankdatei ersetzt, ist dort eine
 * Bequemlichkeit. An einem HTTP-Endpunkt ist der Aufrufer ein Fremder: Das
 * Werkzeug ließe jeden diese Downloads beliebig oft auslösen, und der Zustand,
 * der es freischaltet, nämlich keine Datenbank, ist genau der, den eine
 * gescheiterte oder beschädigte Installation herstellt. Es ist deshalb ein
 * Werkzeug allein für stdio. Wer einen HTTP-Endpunkt betreibt, baut die Daten
 * stattdessen mit `--setup` oder `bun run setup` auf (siehe main()).
 *
 * Aus der Umgebung abgeleitet statt aus main() durchgereicht, damit der Wert
 * dem dort tatsächlich gewählten Transport nicht widersprechen kann.
 */
const HTTP_MODE = (process.env["MCP_HTTP_PORT"] ?? "") !== "";

/** Wahr, wenn der Start dem Datenbankaufbau gilt statt dem Bedienen (siehe main()). */
const SETUP_CLI = process.argv.includes("--setup");

// Nicht während des Datenbankaufbaus: „Der Server läuft" wäre dort schlicht
// falsch, und die gemeldete Werkzeugverfügbarkeit kommt nie zum Tragen.
if (dataMissing !== null && !SETUP_CLI) {
  console.error(
    HTTP_MODE
      ? "Der Server läuft, aber ALLE Werkzeuge sind gesperrt: im HTTP-Modus gibt es " +
          "bible_setup nicht. Datenbank mit '--setup' aufbauen und den Server neu starten."
      : "Der Server läuft, bis auf bible_setup sind alle Werkzeuge gesperrt."
  );
}

// --- Vorbereitete Statements: books, aliases, verses -----------------------
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

// Welche Übersetzungen tatsächlich gefüllt sind (für Prüfung und Meldungen).
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

// Die ganze Tabelle, für die Ressource `bible://buecher`. `chapters` führt das
// Schema seit je mit, gelesen wurde es bislang nie.
const stmtBooks = db.prepare<{ book_id: number; name: string; chapters: number }, []>(
  "SELECT book_id, name, chapters FROM books ORDER BY book_id"
);

// --- Grundtext: Morphologie ------------------------------------------------
// Die Tabelle `original_words` ist optional, es gibt sie erst, nachdem
// download-morph.ts gelaufen ist. Die Absicherung sorgt dafür, dass der Server
// auch ohne sie startet.
const hasOriginal =
  db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='original_words'"
    )
    .get() !== null;

// Der jüngste in der provenance-Tabelle vermerkte Abruf, nur das Datum. Die eine
// Zahl, die den ganzen Bestand datiert: „Ihre Daten sind vom 2026-07-23"
// beantwortet mehr Rückfragen als jede Anzahl. Die Tabelle ist optional (älteren
// Aufbauten fehlt sie), und die Quell-URLs bleiben draußen: Sie sind für jede
// Installation dieselben und stehen im README, hier wiederholt blähten sie nur
// die Nutzlast auf.
const dataFetchedAt: string | null = (() => {
  const hasProvenance =
    db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='provenance'").get() !==
    null;
  if (!hasProvenance) return null;
  const row = db.query("SELECT MAX(fetched_at) AS t FROM provenance").get() as { t: string | null };
  return row?.t ? row.t.slice(0, 10) : null;
})();

// Welche Grundtext-Editionen diese Datei tatsächlich führt, für
// bible_server_info. Einmal abgefragt: Die Menge steht für die Lebensdauer der
// Datei fest, und sie ist die ehrliche Antwort auf „welche Grundtexte haben
// Sie". Die Download-Schritte sind getrennt, wlc ohne sblgnt (oder umgekehrt)
// ist also ein wirklich vorkommender Zustand.
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

// Welche Editionen tatsächlich gefüllt sind (für Prüfung und Meldungen).
const availableEditions: Set<string> = new Set(
  hasOriginal
    ? (db.query("SELECT DISTINCT edition FROM original_words").all() as Array<{
        edition: string;
      }>).map((r) => r.edition)
    : []
);

// Konkordanzabfragen laufen über die Zeilen einer Edition (ohne eigenen Index;
// die Datenbank wird nur lesend geöffnet, und ein voller Editionsdurchlauf
// kostet im lokalen SQLite wenige Millisekunden).
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

// --- Strong-Definitionen (optionale Tabelle, download-lexicon.ts) ----------
const hasStrongDefs =
  db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='strong_defs'")
    .get() !== null;

// gloss und meaning sind die neueren STEPBible-Spalten (meaning gibt es nur im
// Griechischen, siehe schema.ts). Einer vor dieser Migration gebauten Datenbank
// fehlen sie, und geöffnet wird hier nur lesend; deshalb werden stattdessen
// Platzhalter '' ausgewählt, bis download-lexicon.ts erneut läuft.
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

// --- TAGNT-Bezeugung (optionale Tabelle, download-tagnt.ts) ----------------
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

// --- Volltextsuche über die deutschen Verse (optionale FTS5-Tabelle) -------
// `translation` ist in der FTS-Tabelle UNINDEXED; gefiltert wird schlicht über
// Gleichheit, im Nachgang zum MATCH.
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

// book_id und chapter reisen mit, damit ein Durchlauf sowohl die Gesamtzahl der
// Vorkommen als auch die Aufschlüsselung je Buch und Kapitel trägt: siehe den
// `verteilung`-Block weiter unten.
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

// Das Zählen der Vorkommen liest jeden passenden Vers, deshalb ist es gedeckelt:
// Jenseits dieser Grenze entfällt das Feld, statt bezahlt zu werden. Breite
// Anfragen („der") laufen hinein, Wortstudien nie.
const OCCURRENCE_SCAN_LIMIT = 1000;

// Treffermarker dürfen im Verstext selbst nicht vorkommen. Das naheliegende «…»
// stößt mit den eigenen Anführungszeichen der Übersetzungen zusammen: Menge
// führt sie in 8339 Versen, Schlachter in 887, und sie verschachteln andersherum
// (»Zitat«), sodass ein schließendes « sowohl für eine Zählung als auch für
// einen Menschen wie ein Marker aussieht. ⟦⟧ kommt in keiner der vier
// Übersetzungen vor (geprüft 25.07.2026).
// Muss mit den Trennzeichen der beiden `highlight()`-Aufrufe oben übereinstimmen.
const HIT_OPEN = "⟦";

// --- Querverweise (OpenBible.info / TSK, optionale Tabelle) ----------------
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

// --- Editionen: Metadaten, Aliase, Auflösung des Texttyps ------------------
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

// Welche Editionen für welches Testament gelten (book_id 1 bis 39 = AT, 40 bis 66 = NT).
const OT_EDITIONS = new Set(["wlc"]);
const NT_EDITIONS = new Set(["byzantine", "sblgnt", "tr"]);

// Die NT-Editionen in der Reihenfolge des Vergleichs, und die einzige Stelle,
// die sie aufzählt: `bible_compare` gibt sie in dieser Folge aus, und der Prompt
// `variant-check` nennt die davon geladenen. NT_EDITIONS oben ist die
// Zugehörigkeitsprüfung, dies hier die Reihenfolge; eine zweite wörtliche Liste
// liefe davon weg.
const NT_EDITION_ORDER = ["byzantine", "tr", "sblgnt"] as const;

/** Fehlende oder leere Eingabe löst auf byzantine auf, ein unbekannter Alias auf null. */
function resolveEdition(input: unknown): string | null {
  if (input === undefined || input === null || input === "") return EDITION_ALIASES["byzantine"]!;
  if (typeof input !== "string") return null;
  return EDITION_ALIASES[input.trim().toLowerCase()] ?? null;
}

// --- Griechische Morphologie: MorphGNT-Codes (sblgnt) ----------------------
// Ein Parse-Code hat acht Zeichen in fester Feldreihenfolge: Person, Tempus,
// Genus verbi, Modus, Kasus, Numerus, Genus, Steigerung; "-" heißt, das Feld
// trifft nicht zu.
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

// --- Griechische Morphologie: Robinson-Codes (byzantine, tr) ---------------
// Durch Bindestriche getrennt, etwa "N-APN", "V-PAM-2P", "T-GSM".
// Form: POS[-Tempus/Genus verbi/Modus]-[Person][Kasus][Numerus][Genus].
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
// Die Modusbuchstaben bei Robinson weichen von MorphGNT ab: Der Imperativ ist
// "M" (iMperativ), nicht "D".
const ROB_MOOD: Record<string, string> = {
  I: "Indikativ", M: "Imperativ", S: "Konjunktiv",
  O: "Optativ", N: "Infinitiv", P: "Partizip",
};

/** Löst einen Robinson-Morphologiecode (byzantinische Edition) in lesbares Deutsch auf. */
function decodeRobinson(code: string): string {
  const raw = code.trim();
  if (!raw) return "—";
  const parts = raw.split("-");
  const head = parts[0]!;
  const out: string[] = [];

  // Verb: V-<Tempus+Genus+Modus>-<Person+Numerus> oder V-<tgm>-<Kasus+Numerus+Genus>
  // beim Partizip
  if (head === "V") {
    out.push("Verb");
    const tvm = parts[1] ?? "";
    // Das Tempus hat ein oder zwei Zeichen ("2A"), dann folgt das Genus verbi (1),
    // dann der Modus (1)
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
      // Partizip: Kasus, Numerus, Genus
      if (GCASE[tail[0] ?? ""]) out.push(GCASE[tail[0]!]!);
      if (GNUMBER[tail[1] ?? ""]) out.push(GNUMBER[tail[1]!]!);
      if (GENDER[tail[2] ?? ""]) out.push(GENDER[tail[2]!]!);
    } else if (tail) {
      // finite Form: Person und Numerus
      if (PERSON[tail[0] ?? ""]) out.push(PERSON[tail[0]!]!);
      if (GNUMBER[tail[1] ?? ""]) out.push(GNUMBER[tail[1]!]!);
    }
    return out.join(" ");
  }

  // Nicht-Verb: POS, dann ein optionaler Block aus Kasus, Numerus und Genus (etwa
  // N-APN, T-GSM, A-NPM). Nur deklinierbare Wortarten tragen ein solches Suffix;
  // bei Partikeln, Konjunktionen und dergleichen ist ein angehängtes "-N"/"-I" ein
  // Funktionsmarker (Negation, Interrogativ) und keine Deklination, darf also
  // nicht als Kasus gelesen werden.
  out.push(ROB_POS[head] ?? head);
  const DECLINABLE = new Set(["N", "A", "T", "P", "R", "C", "D", "K", "I", "X", "Q", "F", "S"]);
  const decl = parts[1] ?? "";
  if (DECLINABLE.has(head) && decl && decl !== "PRI" && decl !== "NUI") {
    // Personalpronomen mit vorangestellter Personenziffer, etwa P-1DS, P-2AP
    let d = decl;
    if (/^[123]/.test(d)) { if (PERSON[d[0]!]) out.push(PERSON[d[0]!]!); d = d.slice(1); }
    if (GCASE[d[0] ?? ""]) out.push(GCASE[d[0]!]!);
    if (GNUMBER[d[1] ?? ""]) out.push(GNUMBER[d[1]!]!);
    if (GENDER[d[2] ?? ""]) out.push(GENDER[d[2]!]!);
  }
  return out.join(" ") || "—";
}

// --- Hebräische und aramäische Morphologie (OSHB-Codes) --------------------
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

/** Löst eine Folge von Merkmalszeichen in fester Feldreihenfolge auf (überspringt Platzhalter 'x'). */
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

/** Löst ein Morphem eines OSHB-Codes auf (die Sprachkennung ist bereits entfernt). */
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
      if (type === "p") return head; // Eigennamen tragen keine weitere Bestimmung
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
        tail = hebFeatures(feats, [HEB_GENDER, HEB_NUMBER, HEB_STATE]); // Partizip
      } else if (conjCh === "a" || conjCh === "c") {
        tail = []; // Infinitiv
      } else {
        tail = hebFeatures(feats, [HEB_PERSON, HEB_GENDER, HEB_NUMBER]); // finite Form
      }
      return ["Verb", stem, conj, ...tail].filter(Boolean).join(" ");
    }
    default: return pos;
  }
}

/** Löst eine vollständige OSHB-Morphologiezeichenkette auf ("HR/Ncfsa" → "Präposition + Substantiv feminin Singular absolut"). */
function decodeHebrew(morph: string): string {
  if (!morph) return "—";
  const aramaic = morph[0] === "A";
  const body = morph.replace(/^[HA]/, "");
  const pieces = body.split("/").map((m) => decodeHebMorpheme(m, aramaic)).filter(Boolean);
  return pieces.join(" + ") || "—";
}

// --- Generische Helfer: Werkzeugergebnisse, Text, Argumentwandlung ---------
function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

/**
 * Erfolgsergebnis: dieselbe Nutzlast zweimal, als Textblock, den jeder Client
 * seit je bekommt, und als `structuredContent` (Protokollrevision 2025-06-18).
 *
 * Aus einem Wert gebaut, und das mit Absicht. Ein Client des 1.x-SDK wirft
 * `InvalidRequest`, wenn ein Werkzeug mit deklariertem `outputSchema` ein
 * erfolgreiches Ergebnis ohne `structuredContent` liefert
 * (client/index.js:500); ein Rückgabepfad, der es vergisst, ist damit kein
 * fehlendes Feld mehr, sondern ein harter Client-Fehler. Es gibt genau einen Weg,
 * ein solches Ergebnis zu bauen, und das ist dieser: Das Paar niemals von Hand
 * zusammensetzen.
 *
 * Fehlerergebnisse bleiben über `errorResult` reiner Text: Dieselbe Prüfung im
 * Client nimmt `isError` aus, und die Meldungen sind Prosa, kein JSON.
 */
function jsonResult(response: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
    structuredContent: response,
  };
}

/**
 * Der dritte Kanal: ein JSON-RPC-Fehler, für Prompts und Ressourcen, die kein
 * `isError` haben, in das eine Abweisung passte. `protocol.js:397` reicht das
 * `code`-Feld eines geworfenen Fehlers durch, sofern es eine sichere Ganzzahl
 * ist, und fällt sonst auf `InternalError` zurück; ein nacktes `new Error`
 * meldet also einen internen Fehler für etwas, das in Wahrheit ein Fehler des
 * Aufrufers ist. Alles, was aus einem Handler geworfen wird, geht hier durch.
 *
 * Bewusst NICHT `McpError`: Dessen Konstruktor stellt dem Text etwas voran
 * (`super("MCP error <code>: " + message)`, types.js:2031), dieses Präfix reist
 * über die Leitung mit, und der empfangende 1.x-Client stellt es beim
 * Wiederaufbau des Fehlers ein zweites Mal voran (protocol.js:459). Gemessen am
 * 02.08.2026 gegen einen Probe-Server auf diesem SDK: `McpError` legt
 * `"MCP error -32602: <text>"` in `error.message`, dieser Helfer lässt `<text>`
 * unangetastet. Die Meldungen hier sind zeichengleich mit denen der Werkzeuge,
 * das Präfix kommt also nicht in Frage.
 *
 * `code` ist als `ErrorCode` typisiert und nicht als `number`, damit sich an
 * einer späteren Aufrufstelle keine nackte -32602 einschleicht.
 */
function rpcError(code: ErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Entfernt übrig gebliebene HTML-Auszeichnungen. Vorsorge, kein laufendes
 * Geschäft: `download.ts` entfernt sie bereits beim Einfügen, und `verses`
 * enthält in keiner der vier Übersetzungen überhaupt ein "<" (gemessen
 * 26.07.2026). Ebenso bei unsichtbaren Zeichen: kein weiches Trennzeichen
 * (U+00AD), kein NBSP, kein ZWSP in irgendeiner Zeile. Deshalb wird hier sonst
 * nichts entfernt; was künftig entfernt würde, muss mit `rebuildVersesFts`
 * Schritt halten, sonst laufen Suchausgabe und Zitat auseinander.
 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

// Wörter in eckigen Klammern gehören zum Wortlaut der Ausgabe und sind nichts,
// was dieser Server ergänzt hätte: Menge setzt erklärende Einschübe so (137
// Verse; die anderen drei Übersetzungen verwenden keine, und keine der vier
// trägt Fußnotenziffern, es gibt hier also kein numerisches Gegenstück zu
// unterscheiden). Gemessen im Ursprungs-Repo am 25.07.2026: Nach einem Vers mit
// solchen Klammern gefragt, entfernte ein Client, der das Werkzeug aufgerufen
// hatte, sie beim Wiedergeben, und aus dem Einschub der Ausgabe wurde
// gewöhnlicher Text. Bewusst kein Beispielwort im Hinweis: Ein konkretes
// Beispiel wurde schon einmal als Etikett aufgegriffen und auf einen
// unpassenden Fall gesetzt (siehe den Hinweis von bible_compare).
const BRACKET_WORD_RE = /\[(?!\d+\])[^\]]+\]/;
const BRACKET_WORD_HINT =
  "Wörter in eckigen Klammern gehören zum Wortlaut der Übersetzung und sind " +
  "keine Einfügung dieses Servers. Beim Zitieren entfallen sie nicht: ohne die " +
  "Klammern steht der Einschub da wie der übrige Text, und die Ausgabe setzt " +
  "ihn gerade ab.";

/** Hinweis, wenn einer der `texts` Wörter in Klammern trägt; sonst leer. */
function bracketHints(texts: readonly string[]): string[] {
  return texts.some((t) => BRACKET_WORD_RE.test(t)) ? [BRACKET_WORD_HINT] : [];
}

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

/**
 * Nimmt eine Ganzzahl an, ob als Zahl oder als Ziffernfolge. MCP-Clients (also
 * Sprachmodelle) schicken regelmäßig "3", wo das Schema eine Zahl vorsieht;
 * nachsichtig sein statt scheitern.
 */
function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return null;
}

// --- Buchauflösung und „nicht gefunden"-Meldungen (alle Werkzeuge) ---------
function resolveBook(book: string): number | null {
  const normalized = book.trim().toLowerCase();

  // Zuerst den genauen Alias versuchen
  const aliasResult = stmtAlias.get(normalized);
  if (aliasResult) return aliasResult.book_id;

  // Dann unscharf über die vollen Buchnamen (LIKE '%suche%')
  const nameResult = stmtBookByName.get(`%${escapeLike(normalized)}%`);
  if (nameResult) return nameResult.book_id;

  return null;
}

function getBookDisplayName(bookId: number): string {
  const result = stmtBookName.get(bookId);
  return result?.name ?? `Buch ${bookId}`;
}

let aliasCache: Array<{ alias: string; book_id: number }> | null = null;

// Deuterokanonische und apokryphe Bücher, damit ein Fehlgriff darauf genau
// beantwortet und nicht geraten wird. Ohne diese Liste kam „Sirach" auf eine
// Editierdistanz von 2 gegen den Alias „sach" und zurück als „Meinten Sie
// Sacharja?", eine falsche Antwort im Gewand einer Hilfe (25.07.2026).
// „zusatz" allein ist zu weit gefasst: Es verschluckte „Hesekiel-Zusatz", das gar
// kein apokryphes Buch ist (für Hesekiel gibt es keines) und dem der Vorschlag
// des nächstliegenden Buches besser dient. Es zählen nur die tatsächlichen Titel.
const APOKRYPHEN =
  /\b(tobit|tobias|judit|sirach|ecclesiasticus|weisheit salomos|baruch|makkab|manasse|esra\s*[34]|susanna|bel und|asarja|zus(a|ä)tze?\s+zu\s+(daniel|est(h)?er))/i;

/** Levenshtein-Distanz, gedeckelt: Nur kleine Distanzen sind hier von Belang. */
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
 * Das nächstliegende bekannte Buch zu einem nicht aufgelösten Namen, oder null.
 *
 * Zwei Fälle kommen in der Praxis vor: ein bekanntes Buch mit einem Zusatz
 * daran („Hesekiel-Zusatz" → Hesekiel) und ein schlichter Tippfehler
 * („Hesekil"). Der erste ist eine Enthaltensein-Prüfung, der zweite eine
 * Editierdistanz von höchstens 2. Nur vorschlagen, niemals dorthin auflösen,
 * sonst beantwortet die Antwort still ein anderes Buch als das erfragte.
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
      score = 100 - row.alias.length; // der längste enthaltene Alias gewinnt
    } else {
      // Eine Distanz von 2 sagt nur bei längeren Namen etwas: Bei einem Alias aus
      // vier Buchstaben setzt sie fast alles mit fast allem in Beziehung.
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
 * Der einheitliche Wortlaut für „Buch nicht gefunden": nennt das nächstliegende
 * bekannte Buch, sofern es eines gibt, und benennt den Umfang des Kanons. Ohne
 * den Hinweis auf den Umfang sieht ein Fehlgriff auf „Sirach" nach einem
 * Tippfehler aus statt nach einem Buch, das diese Datenbank nicht führt (66
 * Bücher, protestantischer Kanon); aus „nicht gefunden" allein kann der Aufrufer
 * die beiden nicht unterscheiden.
 *
 * Meldung und Verpackung sind getrennt, weil derselbe Fehlgriff den Aufrufer
 * über zwei Kanäle erreicht: Werkzeuge liefern ihn als Ergebnis mit `isError`,
 * Ressourcen haben keinen solchen Kanal und müssen werfen. Ein Wortlaut, zwei
 * Umschläge; eine zweite Formulierung liefe weg, wie es die Grenzmeldungen schon
 * getan haben (25.07.2026).
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
  // Mit der Aussage beginnen, nicht mit "Error:". Der Apokryphen-Zweig oben
  // eröffnet mit einer Tatsache und wird wiedergegeben; dieser Zweig eröffnete
  // mit "Error: Book … not found" und wurde als gescheiterter Aufruf verworfen,
  // samt Vorschlag (25.07.2026, „Hesekiel-Zusatz"). Dieselbe Lehre wie bei
  // `quellenkonflikte`.
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

// Grenzen der Stellenangabe. Gemeinsam gehalten, damit die Grenze und die
// Meldung, die sie nennt, nicht auseinanderlaufen können: Drei Handler wiesen
// `verse=999` mit "must be a positive integer" zurück, einer Bedingung, die die
// Eingabe erfüllt (25.07.2026).
const MAX_CHAPTER = 150; // Die Psalmen haben die meisten Kapitel (150)
const MAX_VERSE = 200; // Das längste Kapitel (Psalm 119) hat 176 Verse
const MAX_VERSE_PARTS = 30; // kommagetrennte Segmente in `verses`
const MAX_BOOK_LENGTH = 50; // der längste deutsche Buchname hat rund 20 Zeichen
const MAX_LEMMA_LENGTH = 50; // eigenes Feld, eigene Grenze, nicht die des Buchnamens

// Abgeleitet, nicht gewählt: Die längste gültige `verses`-Zeichenkette besteht
// aus MAX_VERSE_PARTS Segmenten der Form "176-176" samt den Kommata dazwischen.
// Hier stand einmal eine freihändig gesetzte 200, die zufällig mit MAX_VERSE
// zusammenfiel und in gültige Eingabe schnitt: 30 Segmente "100-176" (239
// Zeichen, jede Zahl gültig) wurden abgewiesen (26.07.2026). Zu beachten ist,
// dass diese Grenze nie allein verletzt sein kann; jede längere Zeichenkette
// bricht zwangsläufig auch die Segment- oder die Wertgrenze. Sie steht da, damit
// eine übergroße Eingabe schon vor dem ersten split abgewiesen wird, und nicht
// als eigene Regel. Einen Testfall für sie allein gibt es nicht und kann es
// nicht geben.
const MAX_VERSE_PART_LENGTH = 2 * String(MAX_VERSE).length + 1; // Form "176-176"
const MAX_VERSES_LENGTH =
  MAX_VERSE_PARTS * MAX_VERSE_PART_LENGTH + (MAX_VERSE_PARTS - 1);

const chapterOutOfRange = `Error: 'chapter' must be an integer between 1 and ${MAX_CHAPTER}`;
const verseOutOfRange = `Error: 'verse' must be an integer between 1 and ${MAX_VERSE}`;
const bookTooLong = `Error: 'book' must be at most ${MAX_BOOK_LENGTH} characters (e.g. 'Jesaja', '1. Mose', 'Römer')`;
// Eine Meldung je Bedingung. Eine einzige Sammelmeldung nannte die Form von
// `verses`, und die Form war genau in dem Fall in Ordnung, der an die Grenze
// stieß.
const versesNotAString = `Error: 'verses' must be a string like "4", "16-17" or "1-3,7"`;
const versesTooLong = `Error: 'verses' must be at most ${MAX_VERSES_LENGTH} characters`;
const versesTooManyParts = `Error: 'verses' must list at most ${MAX_VERSE_PARTS} comma-separated segments`;
const versesOutOfBounds = `Error: every verse number in 'verses' must be between 1 and ${MAX_VERSE}`;

// --- Helfer für bible_lookup -----------------------------------------------
/**
 * Liest eine Versangabe wie "4", "16-17", "1,3,5", "1-3,7" und liefert die
 * einzelnen Versnummern als Feld.
 */
function parseVerses(versesStr: string): number[] {
  const verses: number[] = [];
  // Nur zweite Linie: Der Handler weist eine zu lange Liste mit einer Meldung
  // zurück, bevor sie hier ankommt. Dieses slice war einmal die meldende Schicht
  // und sagte nichts: „1,2,…,35" auf Ps 119 kam als Verse 1-30 zurück, isError
  // false, ohne Hinweis, und die Antwort sah vollständig aus (gemessen
  // 26.07.2026).
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

  // Doppelte entfernen und aufsteigend sortieren, damit der gelieferte Text zur
  // kanonischen Reihenfolge der formatierten Stellenangabe passt ("5,3,3" →
  // Verse 3 und 5, je einmal).
  return [...new Set(verses)].sort((a, b) => a - b);
}

function lookupVerses(
  translation: TranslationCode,
  bookId: number,
  chapter: number,
  versesStr: string
): ReadonlyArray<{ verse: number; text: string }> {
  // Ohne bestimmte Verse das ganze Kapitel liefern
  if (!versesStr || versesStr.trim() === "") {
    return stmtVerses.all(translation, bookId, chapter);
  }

  // Bei einer schlichten Spanne (etwa "3-7") die Bereichsabfrage nehmen, sie ist
  // günstiger
  const rangeMatch = versesStr.trim().match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]!, 10);
    const end = parseInt(rangeMatch[2]!, 10);
    return stmtVerseRange.all(translation, bookId, chapter, start, end);
  }

  // Zusammengesetzte Versangaben zerlegen und einzeln abfragen
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
 * Formt Versnummern zu einer knappen Stellenangabe.
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
 * Löst ein `translation`-Argument zu einem geladenen Übersetzungskürzel auf,
 * oder zu einer Meldung, die der Aufrufer zurückgibt.
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
 * Die Versnutzlast, die sich `bible_lookup` und die beiden Textressourcen
 * teilen. Liefert null, wenn die Stellenangabe auf gar keinen Vers führt; den
 * Fehlgriff formuliert der Aufrufer, denn nur er weiß, wie die Angabe
 * geschrieben war.
 *
 * `form` entscheidet, wie die Verse getragen werden, und das ist der eine
 * Unterschied zwischen den beiden Aufrufern. Das Werkzeug liefert seit je ein
 * einziges `text` mit eingeflochtenen Versnummern; eine Ressource trägt
 * stattdessen `verse_einzeln`, denn sie hängt an einem Gespräch und wird
 * zitiert, und eine zusammengesetzte Zeichenkette ist genau das, was in
 * `bible_crossrefs` an beiden Enden abgeschnitten wurde (25.07.2026,
 * Joh 11,25-26). Beides zu tragen kostete das 2,57-Fache (Psalm 119, Luther:
 * 13 562 → 34 876 Zeichen), `verse_einzeln` allein kostet das 1,58-Fache;
 * deshalb ersetzt es `text`, statt danebenzutreten. Im Werkzeug zählte der
 * Aufschlag doppelt, weil die Nutzlast auch als `structuredContent` reist, und
 * genau deshalb behält das Werkzeug die zusammengesetzte Zeichenkette.
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

// --- Helfer für bible_original ---------------------------------------------
/**
 * Editionsrouting, Nachschlagen und Wortnutzlast eines Verses, geteilt vom
 * Werkzeug `bible_original` und der Ressource `bible://grundtext/…`.
 *
 * Setzt hinter der Argumentprüfung an, denn die beiden Aufrufer lesen ihre
 * Argumente von verschiedenen Stellen (einem Argumentobjekt, einem
 * URI-Segment), müssen von dort an aber gleich weiterleiten und gleich
 * antworten. `bookLabel` erscheint allein in der Meldung „keine Daten" und ist
 * die Schreibweise des Aufrufers; diese Meldung bleibt damit, was sie war.
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

  // Weiterleitung nach Testament: AT (1 bis 39) → hebräisches WLC; NT (40 bis 66)
  // → griechischer Texttyp.
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
    // Das SBLGNT legt die Wortart getrennt ab (r.pos); die anderen Dekoder falten
    // sie in die Morphologiezeichenkette. Deshalb hier voranstellen, damit die
    // Ausgabe überall dieselbe Form hat.
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

// --- Helfer für bible_concordance ------------------------------------------
// Lemmata mit kombinierenden Zeichen (hebräische Nikkud, griechische Akzente)
// können sich zwischen den abgelegten Daten und der Eingabe eines Aufrufers in
// der Reihenfolge der Codepunkte unterscheiden und dabei kanonisch gleichwertig
// sein. Solche Fehlgriffe löst eine bei Bedarf gebaute Abbildung je Edition auf,
// von NFC-normalisiert auf abgelegtes Lemma (einmal je Edition gebaut, rund
// 10 000 Einträge).
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

// --- Helfer für bible_search -----------------------------------------------
/**
 * Formt freie Eingabe in einen unbedenklichen FTS5-MATCH-Ausdruck um.
 * Zitierte Abschnitte werden zu Phrasen, nackte Wörter mit UND verknüpft, und
 * ein angehängtes `*` macht aus einem Wort eine Präfixsuche. Liefert null, wenn
 * kein durchsuchbares Token übrig bleibt.
 */
function buildFtsQuery(input: string): string | null {
  const terms: string[] = [];
  const parts = input.split('"');
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if (i % 2 === 1) {
      // innerhalb von Anführungszeichen: eine Phrase
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

// --- Helfer für bible_compare ----------------------------------------------
/**
 * Normalisiert eine griechische Wortform für den Editionsvergleich: diakritische
 * Zeichen entfernen, kleinschreiben, das Schlusssigma falten. byzantine und tr
 * liegen unakzentuiert vor, sblgnt akzentuiert; ohne das wiche jedes Wortpaar
 * voneinander ab.
 */
function normForCompare(w: string): string {
  return w
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ");
}

/**
 * Wortvergleich zweier Editionen eines Verses über die längste gemeinsame
 * Teilfolge. Verglichen werden normalisierte Formen, gemeldet die
 * ursprünglichen Wortformen. Jedes Segment hält die abweichende Wortfolge
 * beider Seiten ("" heißt: auf dieser Seite nicht vorhanden).
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

/** Das TAGNT-Zeugenkürzel je hier geladener Edition; für die übrigen sechs liegt kein Text vor. */
const TAGNT_LABEL: Record<string, string> = {
  byzantine: "Byz",
  tr: "TR",
  sblgnt: "SBL",
};

const TAGNT_WITNESS_RE = /\b(?:NA28|NA27|Tyn|SBL|WH|Treg|TR|Byz)\b/g;
const GREEK_RUN_RE = /\p{Script=Greek}+/gu;

/**
 * Nur griechische Buchstaben. Der Bereich Script=Greek führt auch Zeichen, die
 * keine Buchstaben sind: Die Koronis ᾽ (U+1FBD) markiert die Elision („ἀλλ᾽")
 * und reiste sonst in die verglichene Form mit, sodass „ἀλλ᾽" nie zum
 * abgelegten „αλλ" passte.
 */
function greekLettersOnly(s: string): string {
  return (s.match(GREEK_RUN_RE) ?? []).join("").replace(/[^\p{L}]/gu, "");
}

/**
 * Wahr, wenn sich zwei normalisierte Formen allein durch einen elidierten
 * Schlussvokal unterscheiden („αλλ" ↔ „αλλα"; „αφ" ↔ „απο" ist NICHT dieser
 * Fall). Die Editionen elidieren nach verschiedenen Konventionen, ein solches
 * Paar ist also eine Schreibvariante und keine Textvariante: in `in_dieser_db`
 * zu zeigen, aber keine Warnung wert.
 */
function istElision(a: string, b: string): boolean {
  const [kurz, lang] = a.length <= b.length ? [a, b] : [b, a];
  return lang.length === kurz.length + 1 && lang.startsWith(kurz) && /[αεηιουω]$/.test(lang);
}

/**
 * Gleicht eine TAGNT-Variantennotiz gegen die Editionstexte dieser Datenbank ab.
 *
 * TAGNT-Notizen nennen allein die Zeugen, die der eigene Apparat für eine
 * Variante führt. Bei 1Tim 3,16 ist das „TR: ἀνελήφθη ;", was sich liest, als
 * trüge jede andere Edition, Byz eingeschlossen, das Stichwort ἀνελήμφθη. Der
 * hier abgelegte Robinson-Pierpont-Text liest ebenfalls ἀνελήφθη; die Notiz
 * allein führt also zum falschen Schluss über den Mehrheitstext (gemessen am
 * 24.07.2026: über 362 zufällige NT-Verse gehen Notiz und Editionstext in
 * 11 Prozent auseinander). Gemeldet wird deshalb, welche geladene Edition
 * welche Form tatsächlich bezeugt, unmittelbar aus `original_words`, und die
 * Widersprüche werden gekennzeichnet.
 */
function crossCheckVariant(
  note: string,
  headword: string,
  texts: Array<{ ed: string; words: string[] }>
): { belege: Record<string, string[]>; abgleich: string[] } | undefined {
  const head = greekLettersOnly(headword);
  if (head === "") return undefined;

  // Ein mit ";" getrenntes Segment je Variante: ihre Zeugen und ihre griechische Form.
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
      // Zuerst nennen, was die Edition liest, dann die Notiz, der sie
      // widerspricht. Umgekehrt formuliert („TAGNT nennt … der Text liest
      // anders") liest es sich wie eine Randbemerkung zur Datenqualität und
      // entfällt beim Wiedergeben des Befundes; Mk 14,46 wurde zweimal ohne den
      // Vorbehalt gemeldet (25.07.2026).
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


// --- Ausgabeschemata: eines je Lesewerkzeug --------------------------------
// Deklariert, damit ein konsumierendes Programm ein Feld finden kann, statt
// Prosa zu zerlegen, und damit `structuredContent` etwas hat, woran es geprüft
// wird.
//
// Für alle gelten zwei Regeln, und beide tragen:
//
// 1. `required` nennt NUR Felder, die in jedem Erfolgspfad dastehen. Für einen
//    Client des 1.x-SDK ist ein deklariertes Schema strenger als gar keines:
//    Eine erfolgreiche Antwort, die nicht passt, wird rundweg abgewiesen
//    (client/index.js:500), wo sie vorher bloß eine Antwort mit einem fehlenden
//    Feld war. Jeder Eintrag unten benennt deshalb die Bedingung, unter der das
//    Feld fehlt, und tests/test-golden.ts trägt je Bedingung einen Fall.
//    `required` ohne einen passenden Fall zu erweitern ist der Weg, aus dieser
//    Stelle einen Ausfall zu machen.
// 2. Nirgends `additionalProperties: false`. Ein Ausgabefeld zu ergänzen muss
//    eine nicht brechende Änderung bleiben, das ist die Hausregel dieser
//    Schnittstelle.
//
// Feldbeschreibungen stehen sparsam und nur dort, wo ein Konsument gemessen
// danebengegriffen hat (Zahlen, Vorbehalte, Quellentreue). Ob eine Beschreibung
// innerhalb eines Ausgabeschemas ein Modell überhaupt erreicht, ist NICHT
// belegt, anders als die am Werkzeug selbst, für die es belegt ist (siehe
// bible_lookup).

/** In jeder Antwort gleich, deshalb einmal deklariert. `nennung: null` heißt,
 *  die Lizenz verlangt keine Nennung; das ist eine Aussage, kein fehlender Wert. */
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

/** Bedingt: `hinweis`, nur wenn der Text Wörter in Klammern trägt (Menge hat
 *  137 solche Verse, die anderen drei Übersetzungen keine). */
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

/** Bedingt: `woerter[].strong`, fehlt bei allen 137 554 SBLGNT-Wörtern und bei
 *  5951 WLC-Wörtern; byzantine und tr führen es durchgängig. */
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

/** Bedingt: `verweise[].verse_einzeln`, nur bei einem mehrversigen Ziel innerhalb
 *  eines Kapitels; `lesehinweis`, nur wenn ein Verweis ihn trägt; `hinweis` bei
 *  Wörtern in Klammern. */
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

/** Bedingt: die sechs Lexikonfelder (`strong`, `umschrift`, `kurzbedeutung`,
 *  `bedeutung`, `kjv_woerter`, `lexikon`; das letzte gibt es nur im
 *  Griechischen, und alle setzen voraus, dass strong_defs geladen ist und einen
 *  Eintrag führt), sowie `hinweis`, nur wenn `limit` die Vorkommensliste
 *  gekürzt hat. */
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

/** Bedingt: `vorkommen_gesamt`, nur wenn gezählt wurde UND die Zahl von
 *  `treffer` abweicht; `verteilung`, nur wenn gezählt wurde und es mehr als eine
 *  Gruppe gibt. Beide entfallen oberhalb von OCCURRENCE_SCAN_LIMIT, und
 *  `hinweis` sagt das dann. */
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

/** Bedingt: `warnung` und `quellenkonflikte`, nur wenn die TAGNT-Bezeugung dem
 *  Editionstext widerspricht; `bezeugung`, nur wenn TAGNT den Vers kennt (neun
 *  NT-Verse haben überhaupt keine Zeile), und darin `lesehinweis`,
 *  `bedeutungsvariante`, `schreibvariante`, `in_dieser_db`, `abgleich`.
 *  `vergleiche[]` hat zwei Gestalten, deshalb ist allein `paar` erforderlich. */
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
                // Dynamische Schlüssel: einer je bezeugter Wortform.
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

/** Bedingt: `daten_stand`, erst wenn ein Download eine Herkunft vermerkt hat;
 *  `hinweis`, nur solange die Datenbank fehlt. */
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

// Die sieben Lesewerkzeuge lesen nur: eine lokale SQLite-Datei, nur lesend
// geöffnet, keine Schreibvorgänge, keine Nebenwirkungen, kein Netz. Beide
// Vorgabewerte der Spezifikation sind hier falsch (readOnlyHint steht auf false,
// openWorldHint auf true), deshalb stehen beide ausdrücklich da. destructiveHint
// und idempotentHint bleiben bewusst draußen: Das Schema erklärt sie nur dann
// für bedeutsam, wenn readOnlyHint false ist.
const READ_ONLY_LOCAL = { readOnlyHint: true, openWorldHint: false } as const;

// bible_setup ist das eine Werkzeug, das schreibt: Es lädt die Bibeldaten und
// ersetzt die Datenbankdatei. readOnlyHint und openWorldHint sind für es deshalb
// beide falsch, und destructiveHint wird bedeutsam. Es ergänzt ausschließlich
// Daten, und ein erneuter Lauf baut dieselben Tabellen wieder auf; es ist also
// weder zerstörend noch schädlich zu wiederholen.
const SETUP_ANNOTATIONS = {
  readOnlyHint: false,
  openWorldHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

const handleListTools = async () => ({
  tools: [
    // Nur angeboten, solange die Daten fehlen, und niemals über HTTP: Steht die
    // Datenbank erst, hat dieses Werkzeug nichts anzubieten, und eine sichtbare
    // Aktion „Datenbank aufbauen" lädt ein Modell dazu ein, bereits geglückte
    // Downloads erneut anzustoßen. An einem HTTP-Endpunkt darf es gar nicht
    // erscheinen, siehe HTTP_MODE.
    //
    // Das eine Werkzeug ohne outputSchema, und das ist entschieden, nicht
    // vergessen: Es antwortet in zwei verschiedenen Gestalten (dem Plan und dem
    // Ergebnis eines Laufs), es ist das einzige schreibende Werkzeug, und kein
    // Konsument braucht seine Ausgabe als Daten. Ein Schema zu deklarieren
    // brächte nichts ein und schüfe eine zweite Gestalt, die mitzupflegen wäre.
    // Deshalb liefert es sein Ergebnis auch weiterhin unmittelbar statt über
    // jsonResult().
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
      // Die Rahmung über „Zitate" allein wurde so gelesen, als deckte sie nur
      // Fragen nach dem Wortlaut: „Schlag mir Hesekiel-Zusatz 1,1 nach" wurde aus
      // dem Gedächtnis beantwortet, weil das Buch nicht zu existieren schien und
      // deshalb kein Zitat erwartet wurde (25.07.2026). Fragen nach Existenz und
      // Kanon sind genau die, die der Server klären kann; das gehört gesagt.
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
    // Bewusst über den Server, nicht über die Schrift: Die Version erreicht die
    // Clients im initialize-Handschlag, aber kein Client zeigt sie dem Nutzer, und
    // das Modell erreicht sie ebenso wenig (gemessen 26.07.2026: instructions ist
    // gesetzt und blieb im Chat trotzdem unsichtbar). Ein Werkzeugergebnis ist der
    // eine Kanal, den das Modell sicher sieht, und „auf welcher Version laufen
    // Sie?" ist die erste Frage, die ein Fehlerbericht beantworten muss.
    //
    // Meldet allein, was sich zwischen Installationen unterscheidet: die Version
    // und den Datenbestand dieser Instanz. data/ entsteht lokal und wird nicht
    // ausgeliefert, zwei Server derselben Version können also verschiedene Texte
    // führen. Keine Host-Details (Laufzeit, Pfade, Prozess, Maschine): Dieser
    // Endpunkt ist öffentlich und authlos, und einen Fremden gehen sie nichts an.
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

// --- MCP-Server: geführte Prompts ------------------------------------------
// Ablauf-Prompts, die die Lesewerkzeuge zusammenspielen lassen. Bezeichner und
// Beschreibungen sind englisch (wie die Werkzeugnamen); die Prompt-Texte selbst
// sind deutsche Inhalte für den Nutzer, passend zu den deutschen Ausgabefeldern.

// `title` ist der Anzeigename, den ein Client in seinem Prompt-Menü zeigt, und
// dieses Menü liest der Nutzer, nicht das Modell; aus demselben Grund tragen die
// Ressourcen deutsche Namen. `name` bleibt englisch und unverändert: Es ist der
// Bezeichner, den ein Aufrufer schickt, und ihn umzubenennen wäre eine brechende
// Änderung. Prompt-Argumente haben im SDK-Schema kein `title` (nur name,
// description, required), ihr Wortlaut bleibt deshalb in `description`.
const PROMPTS = [
  {
    name: "word-study",
    title: "Wortstudie",
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
    title: "Textvarianten prüfen",
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
    title: "Übersetzungen vergleichen",
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

// Ein Prompt-Argument wird in eine nummerierte Anweisung eingesetzt und
// bekommt deshalb dieselbe Behandlung wie ein Werkzeugargument: Fehlt ein
// erforderliches, muss das dastehen, statt eine Anweisung mit einem Loch darin
// zu erzeugen (`Wortstudie zu „"`), und Zeilenumbrüche oder Steuerzeichen
// zerrissen die Liste, in der der Wert landet. 100 Zeichen fassen jeden gültigen
// Wert mit reichlich Luft: Die längste Stellenangabe hat rund 20 („1.
// Thessalonicher 5,23"), eine Strong-Nummer fünf.
const MAX_PROMPT_ARG_LENGTH = 100;

/**
 * Liest ein Prompt-Argument: faltet Leerraum und Steuerzeichen, setzt die
 * Längengrenze durch und weist einen fehlenden Pflichtwert ab. Wirft, denn ein
 * Prompt-Ergebnis hat keinen `isError`-Kanal: Der Fehler gehört in die
 * JSON-RPC-Antwort.
 *
 * `InvalidParams` ist hier ausdrücklich das, was die Spezifikation verlangt:
 * "Missing required arguments: -32602", "Invalid prompt name: -32602"
 * (server/prompts, ein SHOULD in jeder Revision, die dieser Server spricht).
 */
function promptArg(args: Record<string, string>, name: string, required: boolean): string {
  const raw = args[name];
  const value =
    typeof raw === "string" ? raw.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim() : "";
  if (value === "") {
    if (required) throw rpcError(ErrorCode.InvalidParams, `Missing required argument '${name}'`);
    return "";
  }
  if (value.length > MAX_PROMPT_ARG_LENGTH) {
    throw rpcError(
      ErrorCode.InvalidParams,
      `Argument '${name}' must be at most ${MAX_PROMPT_ARG_LENGTH} characters`
    );
  }
  return value;
}

/** "\"LUT\" (Luther 1912), \"SCH\" (…)": Die Kürzel allein bezeichnen nichts. */
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
    // Jeder Schritt nennt die Felder, die die Antwort tatsächlich trägt, und
    // nicht die Begriffe dahinter: Hier stand einmal „Gloss, Definition,
    // Abbott-Smith", während die Antwort von `kurzbedeutung`, `bedeutung` und
    // `lexikon` spricht. Aus demselben Grund bekamen die nackten
    // Editionsschlüssel in `bible_server_info` ihre Namen: Einen Begriff, den die
    // Nutzlast nie verwendet, kann ein Konsument nicht auflösen.
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
    // Aus dem Geladenen abgeleitet, nicht aus einem festen Dreiergespann: Einer
    // Instanz mit nur zwei NT-Editionen würde sonst aufgetragen, eine dritte
    // aufzurufen.
    const geladen = NT_EDITION_ORDER.filter((e) => availableEditions.has(e));
    const editionen =
      geladen.map((e) => `texttyp "${e}" (${EDITION_META[e]!.label})`).join(", ") ||
      "keine NT-Edition (in dieser Datenbank ist keine geladen, der Vergleich ist hier nicht möglich)";
    // Der Bezeugungsblock ist optional: Ihn ohne Vorbehalt zu nennen
    // schickte das Modell auf die Suche nach einem Feld, das eine Instanz ohne
    // TAGNT nie liefert. Seine Vorbehaltsfelder werden ausdrücklich benannt, denn
    // sie sind gemessen die, die übergangen werden, wenn sie tief in der Antwort
    // liegen.
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
    // Menge setzt erklärende Einschübe in eckige Klammern (137 Verse, und nur
    // dort). Vorab benannt statt auf den Hinweis in der Antwort verlassen: Der
    // ganze Sinn dieses Prompts ist der Vergleich Wort für Wort, und genau dort
    // liest sich ein aus den Klammern genommener Einschub wie der Wortlaut der
    // Ausgabe selbst.
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
    throw rpcError(ErrorCode.InvalidParams, `Unknown prompt: ${name}`);
  }

  const meta = PROMPTS.find((p) => p.name === name)!;
  return {
    description: meta.description,
    messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
  };
};

// --- MCP-Server: Ressourcen ------------------------------------------------
// Das dritte Primitiv, und das einzige, nach dem der *Nutzer* greift: Werkzeug
// und Prompt wählt das Modell, eine Ressource hängt man von Hand an. Deshalb sind
// die Namen, Beschreibungen und URI-Wörter hier deutsch, während die Bezeichner
// von Werkzeugen und Prompts englisch sind: Das Publikum ist ein anderes.
//
// Der Katalog bleibt mit Absicht klein. `resources/list` geht bei jedem
// Sitzungsbeginn über die Leitung, und diese Datenbank führt 31 102 Verse in
// 1190 Kapiteln: Irgendeinen Teil davon aufzuzählen ließe `tools/list` winzig
// aussehen (14 969 Zeichen, gemessen 02.08.2026). Der parametrisierte Raum liegt
// in URI-Vorlagen, die Liste trägt vier feste Einträge, die den Bestand selbst
// beschreiben.

const URI_SCHEME = "bible://";

// Abgeleitet aus den Grenzen, die die Segmente ohnehin tragen, nicht gewählt:
// das Schema, vier namensartige Segmente (jedes durch MAX_BOOK_LENGTH begrenzt,
// die weiteste solche Grenze im Gebrauch), eine Versliste von
// MAX_VERSES_LENGTH, die Trennzeichen, und ein Faktor drei, weil die
// Prozentkodierung aus einem Nicht-ASCII-Zeichen bis zu neun macht (drei
// UTF-8-Bytes zu je drei Zeichen). Wie MAX_VERSES_LENGTH kann auch diese Grenze
// nie die einzige verletzte sein; sie steht da, um eine übergroße URI vor dem
// ersten split abzuweisen, und nicht als eigene Regel.
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
 * Warum die Listen ohne Daten leer sind, und warum das Lesen wirft.
 *
 * Ein Ressourcenergebnis hat keinen `isError`-Kanal, eine Abweisung gehört also
 * in die JSON-RPC-Antwort, genau wie bei den Prompts. Und der Wortlaut trennt
 * sich nach Transport, aus demselben Grund wie bei der Werkzeugsperre: Über
 * stdio hat der Aufrufer diesen Prozess gestartet und kann bible_setup
 * ausführen, über HTTP ist er ein Fremder, dem dieses Werkzeug zu nennen etwas
 * beschriebe, das es dort nicht gibt.
 *
 * Der eine Wurf in dieser Datei, der `InternalError` behält, und das nicht aus
 * Versehen: Eine Instanz ohne Datenbank ist ein Zustand des Servers und kein
 * Fehler der Anfrage. Jede andere Abweisung weiter unten ist die des Aufrufers
 * und sagt `InvalidParams`. Diese hier nicht mit ihnen umstellen.
 */
function requireData(): void {
  if (dataMissing === null) return;
  throw rpcError(
    ErrorCode.InternalError,
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

// --- Ressourcen: URI-Segmente ----------------------------------------------
// Jede Segmentprüfung greift auf die Grenze und die Meldung zurück, die die
// Werkzeuge ohnehin verwenden. Sechs jener Meldungen nannten einmal eine
// Bedingung, die die Eingabe erfüllte, weil die Grenze neben einem getrennt
// formulierten Text stand (25.07.2026); ein Ressourcenpfad mit eigenem Wortlaut
// wiederholte das, deshalb gibt es hier keinen.
//
// Jede Abweisung in diesem Abschnitt wirft `InvalidParams`, und das braucht ein
// Wort, denn die Protokollrevision, die dieser Server spricht, sagt etwas
// anderes. Für Ressourcen führt sie "Resource not found: -32002, Internal
// errors: -32603" (server/resources, ein SHOULD). Gewählt ist trotzdem -32602:
// -32002 passt auf die zwei Nicht-gefunden-Fälle und auf keinen der dreizehn
// Fälle einer fehlerhaften URI; die Entwurfsrevision schafft den Code ganz ab
// ("-32002 … replaced by -32602", und Umsetzungen jener Fassung dürfen ihn nicht
// senden, MUST NOT); und das SDK, auf dem dieser Server läuft, beantwortet eine fehlende
// Ressource bereits mit -32602 (server/mcp.js:393). Unter jeder dieser Lesarten
// ist -32603 falsch, und das ist es, was diese Umstellung geändert hat. Keiner
// der beiden Codes rührt an den reservierten Bereich -32020 bis -32099; die
// Entscheidung vom 28.07.2026, als Server vor der Revision 2026-07-28 erkennbar
// zu bleiben, ist also unberührt.
//
// Der gemessene Preis, und er fällt hier an und sonst nirgends: Claude Code
// liest -32602 bei `resources/read` als „nicht gefunden" und ersetzt die Meldung
// unten durch eine eigene ("Resource not found: … Re-run ListMcpResourcesTool to
// refresh"). Unter -32603 reichte der Client den Wortlaut des Servers wörtlich
// durch. Gemessen am 02.08.2026 gegen den ausgerollten Endpunkt davor und
// danach, an zwei Arten fehlerhafter URI, bei durchgängig zeichengleichen
// Texten; Prompts und Werkzeuge sind nicht betroffen. Jede Meldung dieses
// Abschnitts ist also weiterhin genau, und in diesem einen Client liest sie
// niemand. Ob -32002 besser abschnitte, ist ungeprüft und kostet zum Herausfinden
// einen Rollout. Siehe docs/ENTSCHEIDUNGEN.md und docs/FEHLERBEHEBUNG.md.

/**
 * Prüft die Anzahl der Segmente, weist leere zurück und gibt eine Kopie heraus.
 *
 * Die Leerprüfung ist nicht kosmetisch: `resolveTranslation("")` antwortet mit
 * der Voreinstellung, "bible://kapitel/…//23" lieferte also stillschweigend
 * Luther für eine Übersetzung, die der Aufrufer nie genannt hat. Aufrufer greifen
 * mit `!` auf das Ergebnis zu, und diese Längenprüfung ist es, die das
 * rechtfertigt.
 *
 * Kein "Error:"-Präfix an den hier formulierten Meldungen: Die Hausregel lautet,
 * dass eine Meldung mit der Aussage beginnt, und ein Client des 1.x-SDK stellt
 * einem JSON-RPC-Fehler ohnehin "MCP error <code>: " voran (types.js:2031), das
 * Wort erschiene also zweimal. Die von den Werkzeugen geerbten Meldungen behalten
 * ihr Präfix: Dort wiegt die Zeichengleichheit mit dem Werkzeug schwerer als der
 * Hausstil.
 */
function requireSegments(rest: readonly string[], count: number, form: string): string[] {
  if (rest.length !== count || rest.some((s) => s === "")) {
    throw rpcError(ErrorCode.InvalidParams, `Falsche Form der URI. Erwartet: "${form}".`);
  }
  return [...rest];
}

/**
 * Länge und Auflösung sind getrennt, weil die Werkzeuge sie an verschiedenen
 * Stellen prüfen: `bible_lookup` begrenzt den Buchnamen zuerst, löst ihn aber
 * erst nach Kapitel und Versen auf. Eine URI, die zwei Bedingungen verletzt, muss
 * deshalb dieselbe melden wie das Werkzeug. Zusammengelegt nannte die Ressource
 * das Buch, während das Werkzeug das Kapitel nannte.
 */
function requireBookLength(segment: string): void {
  if (segment.length > MAX_BOOK_LENGTH) throw rpcError(ErrorCode.InvalidParams, bookTooLong);
}

function segmentBookId(segment: string): number {
  const bookId = resolveBook(segment);
  if (bookId === null) throw rpcError(ErrorCode.InvalidParams, bookNotFoundMessage(segment));
  return bookId;
}

function segmentChapter(segment: string): number {
  const chapter = toInt(segment);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    throw rpcError(ErrorCode.InvalidParams, chapterOutOfRange);
  }
  return chapter;
}

function segmentVerse(segment: string): number {
  const verse = toInt(segment);
  if (verse === null || verse < 1 || verse > MAX_VERSE) {
    throw rpcError(ErrorCode.InvalidParams, verseOutOfRange);
  }
  return verse;
}

/** Dieselben vier Prüfungen, dieselbe Reihenfolge, dieselben Meldungen wie in `bible_lookup`. */
function segmentVerses(segment: string): string {
  if (segment.length > MAX_VERSES_LENGTH) {
    throw rpcError(ErrorCode.InvalidParams, versesTooLong);
  }
  if (segment.split(",").length > MAX_VERSE_PARTS) {
    throw rpcError(ErrorCode.InvalidParams, versesTooManyParts);
  }
  const ausserhalb = [...segment.matchAll(/\d+/g)].some(([n]) => {
    const value = parseInt(n, 10);
    return value < 1 || value > MAX_VERSE;
  });
  if (ausserhalb) throw rpcError(ErrorCode.InvalidParams, versesOutOfBounds);
  return segment;
}

function segmentTranslation(segment: string): TranslationCode {
  const resolved = requireTranslation(segment);
  if ("error" in resolved) throw rpcError(ErrorCode.InvalidParams, resolved.error);
  return resolved.code;
}

// --- Ressourcen: Nutzlasten ------------------------------------------------
// Jede der vier festen Ressourcen meldet, was diese Instanz tatsächlich führt,
// nie eine feste Liste: Eine Installation ohne den hebräischen Download böte
// sonst eine Edition an, die sie nicht liefern kann. Dieselbe Regel befolgen die
// Prompts seit 0.5.7.

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

/** Die geladenen Übersetzungen in der Reihenfolge der Registry, damit die Ausgabe
 *  stets dieselbe Reihenfolge hat. */
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
 * Zuerst die AT-Edition, dann die NT-Editionen in der Reihenfolge des
 * Vergleichs. Jeder Eintrag ist ein wörtlicher Schlüssel von EDITION_META, und
 * genau das rechtfertigt das `!` an den Zugriffen unten; eine neue Edition gehört
 * in beide, sonst verliert die Zusicherung ihre Grundlage.
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
  // Dieselbe Reihenfolge wie bei bible_lookup: erst den Namen begrenzen, dann das
  // Kapitel, dann die Versliste, dann auflösen. Siehe requireBookLength.
  requireBookLength(buch);
  const chapter = segmentChapter(kapitel);
  const versesStr = segmentVerses(verse);
  const bookId = segmentBookId(buch);
  const code = segmentTranslation(uebersetzung);

  const payload = lookupPayload(code, bookId, chapter, versesStr, "verse_einzeln");
  if (payload === null) {
    throw rpcError(
      ErrorCode.InvalidParams,
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
  // Dieselbe Reihenfolge wie bei bible_original, aus demselben Grund wie oben.
  requireBookLength(buch);
  const chapter = segmentChapter(kapitel);
  const verse = segmentVerse(vers);
  const bookId = segmentBookId(buch);

  const result = originalPayload(buch, bookId, chapter, verse, edition);
  if ("error" in result) throw rpcError(ErrorCode.InvalidParams, result.error);
  return result.payload;
}

// --- Ressourcen: lesen -----------------------------------------------------
const handleReadResource = async (request: ReadResourceRequest) => {
  const uri = request.params.uri;
  requireData();

  if (uri.length > MAX_URI_LENGTH) {
    throw rpcError(
      ErrorCode.InvalidParams,
      `Die URI darf höchstens ${MAX_URI_LENGTH} Zeichen lang sein.`
    );
  }
  if (!uri.startsWith(URI_SCHEME)) {
    throw rpcError(
      ErrorCode.InvalidParams,
      `Unbekannte URI "${uri}". Die Ressourcen dieses Servers beginnen mit "${URI_SCHEME}".`
    );
  }

  // Von Hand zerlegt, nicht über `new URL()`: Das läse das erste Segment als
  // Autorität und schriebe es klein, "bible://kapitel/SCH/…" käme also mit einem
  // Übersetzungskürzel an, das dieser Server nicht kennt.
  let segments: string[];
  try {
    segments = uri.slice(URI_SCHEME.length).split("/").map(decodeURIComponent);
  } catch {
    throw rpcError(
      ErrorCode.InvalidParams,
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
    throw rpcError(
      ErrorCode.InvalidParams,
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

// --- bible_setup: die Datenbank aus dem Server heraus aufbauen -------------
/**
 * Durch ein ausdrückliches Bestätigungsflag gesichert, statt beim ersten
 * Gebrauch loszulaufen.
 *
 * Der Download dauert rund eine Minute und greift auf acht fremde Quellen zu;
 * das startet man nicht hinter dem Rücken des Nutzers, nur weil ein Modell
 * gerade nach einem Vers gefragt hat. Ohne `bestaetigung` antwortet das Werkzeug
 * mit dem Plan, damit das Modell etwas Handfestes vorlegen kann, bevor es
 * fragt.
 */
async function handleSetup(args: { bestaetigung?: unknown }) {
  // Das Werkzeug aus tools/list herauszuhalten genügt nicht: Ein Aufrufer darf
  // jede Werkzeugbezeichnung schicken, die ihm einfällt, und dieses hier
  // schreibt. Die Abweisung muss im Handler sitzen.
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

  // Import hier und nicht auf Modulebene: Er zieht alle acht Download-Module
  // herein, und ein Server, der seine Daten schon hat, soll sie nie laden.
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
  // Die Download-Skripte melden ihren Fortschritt mit console.log, was auf einer
  // Konsole richtig und hier verhängnisvoll ist: Auf stdout liegt der
  // JSON-RPC-Strom, und eine einzige verirrte Zeile lässt den Client den Server
  // für kaputt halten. Gemessen: Der erste End-to-End-Lauf dieses Werkzeugs
  // lieferte einen unparsbaren Strom. Für die Dauer umgebogen, statt jede
  // Logzeile in acht Skripten umzuschreiben, die auch eigenständig laufen.
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

  // Ein Neustart ist nötig, weil die Verbindung und ihre vorbereiteten Statements
  // an die leere Datenbank im Speicher gebunden sind, mit der dieser Prozess
  // gestartet ist.
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
 * Fassung und Datenbestand dieser Instanz. Die Feldnamen sind deutsch wie in den
 * übrigen Werkzeugnutzlasten. Jeder Wert stammt aus einer Prüfung, die beim
 * Start ohnehin schon lief; der Aufruf kostet also nichts außer dem
 * Serialisieren.
 *
 * Bestand statt Statistik: Eine Gesamtzahl der Verse sagt einem Aufrufer nichts,
 * womit er etwas anfangen könnte, während „hat dieser Server den Grundtext, die
 * Strong-Nummern, die Querverweise" entscheidet, welche Fragen er überhaupt
 * beantworten kann. Die Download-Schritte sind getrennt und je für sich
 * optional, eine Instanz ohne einen davon ist also ein gewöhnlicher Zustand, und
 * die übliche Ursache, wenn ein Werkzeug leer zurückkommt.
 */
function handleServerInfo() {
  const result = {
    server: "bibelstudium-mcp",
    version: PACKAGE_VERSION,
    uebersetzungen: [...availableTranslations].sort().map((code) => ({
      code,
      name: TRANSLATIONS[code as TranslationCode]?.name ?? code,
    })),
    // Dieselbe Gestalt wie `uebersetzungen`, und aus demselben Grund: Die nackten
    // Schlüssel („byzantine", „tr") bezeichnen keine Edition, und ein Aufrufer
    // kann sie in dieser Nutzlast nirgends nachschlagen. Welche Textform geladen
    // ist, entscheidet, welche Fragen diese Instanz überhaupt beantworten kann;
    // der Name gehört also hierher. Die Namen kommen aus EDITION_META, wo Text,
    // Lizenz und hinweis ohnehin beieinander liegen, statt aus einer zweiten
    // Liste, die davon wegliefe. Leer, wenn download-morph.ts nie lief; `?? code`
    // hält eine Edition sichtbar, die die Datenbank führt und die Tabelle nicht
    // kennt, statt sie fallen zu lassen.
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

// --- MCP-Server: Verteilung der Anfragen (bible_lookup inline bedient) -----
const handleCallTool = async (request: CallToolRequest) => {
  const toolName = request.params.name;
  // `arguments` ist im MCP-Schema optional, und Clients lassen es tatsächlich
  // weg, wenn das Modell ein Werkzeug ohne Parameter aufruft. Ohne diesen
  // Rückfall würfe jeder Handler einen nackten TypeError in die JSON-RPC-Schicht,
  // statt den Werkzeugfehler „Feld erforderlich" zu liefern, mit dem der Aufrufer
  // etwas anfangen kann.
  const rawArgs = request.params.arguments ?? {};

  if (toolName === "bible_setup") {
    return handleSetup(rawArgs as { bestaetigung?: unknown });
  }

  // Vor der dataMissing-Sperre unten beantwortet, und das mit Absicht: Eine
  // Instanz ohne Daten ist genau die Lage, in der jemand fragt, was dieser Server
  // ist und was er hat. „Keine Bibeldatenbank" statt der Fassung zu schicken
  // hielte gerade die erfragte Auskunft zurück.
  if (toolName === "bible_server_info") {
    return handleServerInfo();
  }

  // Eine Sperre für alle datenlesenden Werkzeuge statt einer Prüfung je Handler:
  // Ohne Datenbank antwortete sonst jedes von ihnen „Buch nicht gefunden", was
  // sich liest, als sei die Stellenangabe falsch, und nicht, als sei noch nichts
  // geladen.
  if (dataMissing !== null) {
    // Zwei Adressaten, zwei Meldungen. Über stdio kann der Aufrufer das beheben,
    // also das Werkzeug nennen, das es tut. Über HTTP ist er ein Fremder ohne
    // Zugriff auf die Maschine: Auf bible_setup zu zeigen würde ein Werkzeug
    // benennen,
    // das dort nicht angeboten wird und sich nicht verwenden lässt. Die eine
    // Anweisung, die in beiden Fällen trägt, ist der letzte Satz.
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
    // InvalidParams, nicht InternalError: Das eigene Beispiel der Spezifikation
    // für diesen Fall lautet `{"code": -32602, "message": "Unknown tool: …"}`
    // (server/tools), und der hochsprachige McpServer des SDK wirft genau das
    // (server/mcp.js:104). Die Werkzeuge oben beantworten Eingabefehler
    // stattdessen mit `isError`; dieser Kanal braucht ein Werkzeug, das es gibt,
    // und dies ist der eine Fall, in dem es keines gibt.
    throw rpcError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
  }

  const args = rawArgs as {
    book?: unknown;
    chapter?: unknown;
    verses?: unknown;
    translation?: unknown;
  };

  const { book, translation } = args;

  // Pflichteingaben prüfen. Anwesenheit und Länge sind getrennte Prüfungen, damit
  // jede Meldung die tatsächlich verletzte Bedingung nennt.
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

  // `verses` als Zeichenkette oder als einzelne Zahl annehmen (nachsichtig
  // gegenüber MCP-Clients).
  const verses =
    args.verses === undefined || args.verses === null
      ? ""
      : typeof args.verses === "string"
        ? args.verses
        : typeof args.verses === "number" && Number.isInteger(args.verses)
          ? String(args.verses)
          : null;
  // Die billigste Prüfung zuerst: Typ, Länge, Anzahl der Segmente, Werte.
  if (verses === null) {
    return errorResult(versesNotAString);
  }
  if (verses.length > MAX_VERSES_LENGTH) {
    return errorResult(versesTooLong);
  }
  if (verses.split(",").length > MAX_VERSE_PARTS) {
    return errorResult(versesTooManyParts);
  }
  // Vor beiden Nachschlagepfaden, denn sie waren einmal uneins: Der Schnellpfad
  // für eine schlichte Spanne prüfte MAX_VERSE gar nicht („1-500" wurde wie
  // gültige Eingabe beantwortet), während der Weg über parseVerses das
  // beanstandete Segment stillschweigend fallen ließ („1-500,2" wurde mit Vers 2
  // allein beantwortet). Gleiche Bedeutung, zwei Ergebnisse, entschieden durch
  // ein Komma (gemessen 26.07.2026).
  if ([...verses.matchAll(/\d+/g)].some(([n]) => {
    const value = parseInt(n, 10);
    return value < 1 || value > MAX_VERSE;
  })) {
    return errorResult(versesOutOfBounds);
  }

  // Buchnamen zur Nummer auflösen
  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }

  // Übersetzung auflösen (streng: unbekannte oder nicht geladene Kürzel sind Fehler)
  const resolved = requireTranslation(translation);
  if ("error" in resolved) {
    return errorResult(resolved.error);
  }

  // Verse nachschlagen. Die Nutzlast teilt sich dieses Werkzeug mit den
  // Textressourcen; `text` ist die Gestalt, die es seit je liefert (siehe
  // lookupPayload).
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

// --- Werkzeug-Handler ------------------------------------------------------
/**
 * Bedient das Werkzeug `bible_original`: liefert einen NT-Vers Wort für Wort mit
 * Lemma und aufgelöster Morphologie aus den SBLGNT/MorphGNT-Daten.
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
 * Bedient das Werkzeug `bible_crossrefs`: liefert die Querverweise zu einem
 * Vers, nach den Bewertungen von OpenBible.info geordnet, jeden mit seinem
 * deutschen Zieltext.
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

    // Text: die volle Spanne innerhalb eines Kapitels (gedeckelt bei vier
    // Versen), sonst allein der erste Vers, denn Ziele über Kapitelgrenzen hinweg
    // sind selten und meist lang. Mehrversige Spannen gehen zusätzlich als
    // `verse_einzeln` hinaus: Die zusammengefügte Form flicht die Versnummern in
    // die Zeichenkette, überlässt das Zerlegen also den Konsumenten, und die
    // schneiden dabei die äußeren Ränder weg (beobachtet am 25.07.2026,
    // Joh 11,25-26 zitiert ohne „Jesus spricht zu ihr:" und ohne die
    // abschließende Frage).
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
 * Bedient das Werkzeug `bible_concordance`: alle Vorkommen eines Wortes des
 * Grundtextes (über die Strong-Nummer oder das genaue Lemma) in einer Edition,
 * samt Auswertung.
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

  // Suchart und Testament bestimmen.
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

  // Edition auflösen: Hebräisch → wlc; Griechisch → NT-Edition gemäß texttyp.
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
    // Der genaue Treffer blieb aus: über das Unicode-normalisierte Lemma erneut
    // nachschlagen.
    const stored = findStoredLemma(edition, suche);
    if (stored !== null) rows = stmtConcordLemma.all(edition, stored);
  }
  if (rows.length === 0) {
    return errorResult(
      `Keine Vorkommen für "${suche}" in Edition "${edition}" gefunden. ` +
        "Hinweis: Lemma muss exakt (mit Akzenten/Punktierung) übereinstimmen; im Zweifel Strong-Nummer verwenden."
    );
  }

  // Zusammenfassen: Anzahl je Buch und verschiedene Verse (die Zeilen stehen in
  // kanonischer Reihenfolge).
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
  // Um den Eintrag des Strong-Wörterbuchs anreichern (Umschrift und Bedeutung),
  // sofern die Lexikontabelle geladen und eine Strong-Nummer bekannt ist.
  const strongKey =
    strongDigits !== null
      ? (isHebrew ? "H" : "G") + strongDigits
      : rows[0]!.strong
        ? (isHebrew ? "H" : "G") + rows[0]!.strong
        : null;
  // Welches Lexikon tatsächlich beigetragen hat, entscheidet über die Nennung
  // weiter unten: translit, definition und kjv kommen aus den
  // Strong-Wörterbüchern (CC BY-SA), gloss und der Abbott-Smith-Eintrag von
  // STEPBible (CC BY 4.0). Eine Quelle zu nennen, die nichts beigetragen hat, ist
  // derselbe Fehler wie eine wegzulassen, die es tat.
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
      // Der vollständige Abbott-Smith-Eintrag (STEPBible TBESG, nur Griechisch):
      // die wissenschaftliche Bedeutung, meist einige hundert Zeichen, die Tokens
      // wert.
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
 * Bedient das Werkzeug `bible_search`: Volltextsuche über die Verse einer
 * Übersetzung.
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

  // `treffer` zählt Verse, nicht Wortvorkommen: Ein Vers kann mehrfach passen
  // (1Joh 2,15 trägt drei Formen von „lieb*"). Konsumenten lesen „Treffer" als
  // Fundstellen und versuchen, die Zahl je Vers aufzuschlüsseln, wobei sie die
  // Zahlen je Vers raten (beobachtet 25.07.2026). Deshalb werden die
  // Hervorhebungsmarker über alle passenden Verse gezählt, damit die zweite Zahl
  // dasteht, statt abgeleitet zu werden.
  const scanSkipped = total > OCCURRENCE_SCAN_LIMIT;
  const scan =
    !scanSkipped && stmtSearchAll && stmtSearchAllBook
      ? bookId === null
        ? stmtSearchAll.all(match, translation, OCCURRENCE_SCAN_LIMIT)
        : stmtSearchAllBook.all(match, translation, bookId, OCCURRENCE_SCAN_LIMIT)
      : null;
  const hits = (text: string) => text.split(HIT_OPEN).length - 1;
  const vorkommen = scan === null ? null : scan.reduce((sum, r) => sum + hits(r.text), 0);

  // Jede Aufschlüsselung, die ein Konsument brauchen könnte, wird hier gezählt
  // und nicht dem Modell überlassen: Über sechs gemessene Läufe kamen die vom
  // Werkzeug genannten Zahlen in 10 von 10 Fällen richtig an, während selbst
  // abgeleitete Kapitelsummen in drei von fünf Fällen falsch waren, und zwar so
  // falsch, dass es gezählt aussieht, weil die Gesamtsumme aufgeht (25.07.2026).
  // Gruppiert wird nach Buch, wenn die ganze Bibel durchsucht wird, und nach
  // Kapitel, wenn die Suche auf ein Buch eingeschränkt ist: Auf dieser Ebene wird
  // die Frage jeweils gestellt. Ausgegeben nur bei mehr als einer Gruppe, denn
  // eine Aufschlüsselung mit einem Eintrag wiederholt `treffer` und lehrt nichts.
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
  // Oberhalb der Scan-Grenze entfallen beide gezählten Felder, und lange sagte
  // das nichts: Die Antwort nannte `treffer` und forderte weiter dazu auf, die
  // Marker je Vers abzuzählen, während die beiden Zahlen, die sonst dastehen,
  // schlicht fehlten (gemessen 26.07.2026, „der" mit 13 033 Treffern). Nach
  // eben der Messung, auf der `verteilung` beruht, wird geschätzt, was fehlt,
  // und liest sich trotzdem wie gezählt. Alle drei Zahlen gelten je Übersetzung
  // (`total` und die Scan-Abfragen tragen dieselbe `translation`), und deshalb
  // benennt der Ausweg sie neben der engeren Anfrage.
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
 * Bedient das Werkzeug `bible_compare`: vergleicht einen NT-Vers Wort für Wort
 * über die griechischen Editionen (paarweise, normalisiert verglichen, gemeldet
 * werden die ursprünglichen Wortformen).
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
        // Die Wortzahl einer abweichenden Folge steht da, statt abgezählt zu
        // werden: Das Comma Johanneum wurde als „16 zusätzliche Wörter"
        // gemeldet, wo Editionsvergleich und TAGNT-Bezeugung beide 17 sagen
        // (25.07.2026). Nur ab zwei Wörtern, denn „(1 Wort)" an jeder
        // Einzelwortabweichung ist Rauschen, das die wichtigen Fälle begräbt.
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

  // Die Bezeugung je Wort über acht Editionen (STEPBible TAGNT). Wörter, die alle
  // acht Editionen bezeugen, werden nur gezählt; aufgelistet sind die, deren
  // Zeugenmenge abweicht, denn dort sitzt das textkritische Signal.
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

  // Quellenkonflikte liegen vier Ebenen tief in bezeugung.abweichend[].abgleich,
  // und Konsumenten, die den Bezeugungsblock als optionales Detail behandeln,
  // erreichen sie nie: Mk 14,46 wurde ohne den Vorbehalt gemeldet (25.07.2026).
  // Deshalb oben in der Antwort wiederholt, vor den Daten, die sie einschränken.
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
    // Hier kein Beispiel für eine Variantenart: Das frühere „(z. B. bewegliches
    // Ny)" wurde als Etikett aufgegriffen und auf einen Fall gesetzt, der nichts
    // damit zu tun hat. ἐπέβαλον / ἐπέβαλαν in Mk 14,46 hieß dann bewegliches Ny,
    // obwohl es um thematische gegen Alpha-Aoristendung geht (25.07.2026). Auf
    // die klassifizierenden Felder zeigen, statt einen Fachbegriff einzustreuen.
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

// --- MCP-Server: Aufbau und Werkzeug-Registrierung -------------------------
// Eine Fabrik, kein Singleton: Ein `Server` bindet genau einen Transport, der
// HTTP-Modus unten braucht deshalb je Anfrage eine frische Instanz. Alles
// Teure (Datenbank, vorbereitete Statements, die Werkzeugliste) liegt auf
// Modulebene und wird geteilt; eine Instanz ist nur die Verdrahtung der Handler.
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
 * HTTP-Modus, zuzuschalten über MCP_HTTP_PORT. Ohne die Variable spricht der
 * Server stdio wie bisher; lokale Clients und `bun run test` sind also nicht
 * betroffen.
 *
 * Gebunden wird an 127.0.0.1, sofern MCP_HTTP_HOST nichts anderes sagt. Diese
 * Vorgabe ist der sicherheitsrelevante Teil: Diesen Server von außen zu
 * erreichen soll einen bewussten Schritt verlangen (einen Tunnel oder einen
 * Reverse Proxy, der TLS abschließt) und nie eine vergessene Voreinstellung.
 * Den Port unmittelbar zu veröffentlichen gäbe zudem die Adresse der Maschine
 * preis, und weder TLS noch Zugriffsschutz bringt der Server mit.
 *
 * Zustandslos: `Server` bindet einen einzigen Transport, jede Anfrage bekommt
 * deshalb aus createServer() ihre eigene Instanz. Datenbank und alle
 * vorbereiteten Statements bleiben auf Modulebene geteilt, eine Anfrage kostet
 * also kaum mehr als das Verdrahten der Handler.
 */
// CORS, damit auch browserbasierte Clients den Endpunkt nutzen können. Für
// MCP-Clients ohne Browser ist es folgenlos: die schicken keinen Origin. Kein
// Widerspruch zur Origin-Prüfung unten: Die entscheidet, WER antworten
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
 * Warum /health die Datenbank abfragt, statt `dataMissing` zu melden.
 *
 * `dataMissing` wird einmal beim Start entschieden. Eine Datei, die im
 * laufenden Betrieb getauscht oder beschädigt wird, ließe den Wert auf `null`
 * stehen, und /health meldete weiter „ok" für einen Server, der keine einzige
 * Stelle mehr nachschlagen kann. Die billigste Abfrage, die den ganzen Weg als
 * funktionierend nachweist, ist eine Zeile aus der Tabelle, die jedes Werkzeug
 * braucht; sie kommt aus dem Seiten-Cache von SQLite und kostet Mikrosekunden,
 * eine Überwachung darf sie also regelmäßig aufrufen.
 *
 * Liefert null im gesunden Fall, sonst den Grund, damit der Aufrufer etwas hat,
 * das er in den Antwortrumpf legen kann.
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
 * Warum der Endpunkt festhält, welche Protokollrevision seine Aufrufer sprechen.
 *
 * Die Revision 2026-07-28 hat `initialize` und die Sitzung abgeschafft: Ein
 * moderner Client trägt Version, Identität und Fähigkeiten im `_meta` jeder
 * Anfrage und spiegelt die Version in die Kopfzeile `MCP-Protocol-Version`.
 * Dieser Server läuft auf dem 1.x-SDK und spricht allein die Revisionen mit
 * Handschlag; nach der Verträglichkeitsmatrix der Spezifikation scheitert ein
 * moderner Client also entweder rundweg oder, schlimmer, bekommt eine in der
 * Ära mehrdeutige Methode unter der alten Bedeutung bedient: Der zustandslose
 * POST-Pfad nimmt Anfragen ohne Handschlag an, hier fiele es also niemandem
 * auf. Der Umstieg auf das v2-SDK ist eine Paketteilung samt Neufassung jeder
 * Handler-Registrierung; der Auslöser sollte deshalb ein gemessener Client sein
 * und kein Datum. Dies ist diese Messung.
 *
 * Eine Zeile je Protokollversion, nicht je Anfrage und nicht je Client. Der
 * Endpunkt ist öffentlich und authlos: Eine Zeile je Anfrage wäre ein
 * Zugriffsprotokoll, nach dem niemand gefragt hat, und ein müheloser Weg, das
 * Journal zu füllen. Die Menge ist gedeckelt, aus demselben Grund, aus dem die
 * Sitzungsregistratur verschwunden ist: Sie wächst mit Eingaben des Aufrufers,
 * und eine ungedeckelte ist genau das Leck, das dieser Server schon einmal
 * hatte.
 *
 * Nichts vom Aufrufer wird wörtlich geschrieben. Die Version wird gegen das
 * Format einer Revision geprüft, nicht bloß gesäubert, und der selbstgemeldete
 * Name des Clients wird gar nicht festgehalten. Beides folgt aus der
 * Datenschutzerklärung, die dieser Endpunkt veröffentlicht und die
 * Betriebsereignisse „ohne Personenbezug" zusagt: Ein Versprechen über freien
 * Text von Fremden hält immer nur das Wohlwollen ihrer Software, während ein
 * Wert, der vor dem Journal gegen `YYYY-MM-DD` geprüft wird, konstruktiv
 * gehalten ist. Sowohl die Kopfzeile `Mcp-Protocol-Version` als auch
 * `params.protocolVersion` bestimmt der Aufrufer, und in beide passt eine
 * Adresse oder ein Name.
 */
const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
/**
 * Die erste Revision, die Version und Identität je Anfrage trägt. Revisionen
 * heißen nach ISO-Daten, ein Zeichenkettenvergleich ordnet sie also, und `>=`
 * ist die Prüfung auf die Ära.
 */
const FIRST_MODERN_REVISION = "2026-07-28";
const MAX_PROTOCOL_SIGHTINGS = 20;
const protocolSightings = new Set<string>();
let modernLogged = false;

/** Steht für eine Angabe, die kein Revisionsname ist, damit kein solcher Wert ins Protokoll gerät. */
const UNKNOWN_REVISION = "unbekannte Angabe";

/**
 * Eine Protokollrevision heißt nach ihrem Erscheinungsdatum. Alles andere wird
 * abgewiesen statt gesäubert: Dies ist der einzige Wert aus der Anfrage, der ins
 * Journal gelangt, und deshalb lohnt es sich, ihn auf eine Form festzulegen, die
 * weder eine Botschaft noch eine Kennung noch ein Steuerzeichen tragen kann.
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
  // Der billige Weg, den jede Anfrage nimmt, sobald eine Version einmal gesehen
  // ist: ein Blick in die Kopfzeilen und einer in die Menge, ohne den Rumpf zu
  // lesen.
  const headerRevision = asRevision(request.headers.get("mcp-protocol-version"));

  // Sichtungen aus der modernen Ära fallen in eine einzige Zeile zusammen, die
  // älteren werden nach Version geführt. Das Brauchbare an einem modernen
  // Aufrufer ist, dass es ihn gibt, und nicht, welches Datum er nennt; sie nach
  // Version zu führen gäbe einem authlosen Aufrufer beides: eine Zeile je
  // erfundenem Zukunftsdatum und einen Weg, die echte Sichtung aus der
  // gedeckelten Menge zu verdrängen. Gemessen am 28.07.2026: Zwanzig
  // vorgetäuschte Daten erzeugten zwanzig Warnungen und verschluckten dann den
  // echten Client vom 2026-07-28.
  const headerModern = headerRevision !== null && headerRevision >= FIRST_MODERN_REVISION;
  if (headerModern && modernLogged) return;
  if (!headerModern) {
    if (headerRevision !== null && protocolSightings.has(headerRevision)) return;
    if (protocolSightings.size >= MAX_PROTOCOL_SIGHTINGS) return;
  }

  let bodyRevision: string | null = null;
  let modernMeta = false;
  let discover = false;

  // Den Rumpf nur für eine noch nicht vermerkte Version lesen, also höchstens
  // einmal je Version. Die Kopfzeile fehlt genau bei einem alten `initialize`
  // und bei Clients vor 2025-06-18, die sie nie definiert haben.
  try {
    const body = asRecord(await request.clone().json());
    if (body !== null) {
      discover = body["method"] === "server/discover";
      const params = asRecord(body["params"]);
      if (params !== null) {
        // Alte Ära: `initialize` nennt die Version in params.
        bodyRevision = asRevision(params["protocolVersion"]);
        // Moderne Ära: Jede Anfrage nennt sie stattdessen in _meta.
        const meta = asRecord(params["_meta"]);
        if (meta !== null && typeof meta[META_PROTOCOL_VERSION] === "string") {
          modernMeta = true;
          bodyRevision = asRevision(meta[META_PROTOCOL_VERSION]);
        }
      }
    }
  } catch {
    // Kein JSON, oder ein Rumpf, den dieser Server ohnehin abweist. Die
    // Kopfzeile allein bezeichnet die Ära weiterhin, und ein Fehlschlag hier darf
    // die Anfrage nicht scheitern lassen.
  }

  const revision = bodyRevision ?? headerRevision;
  // `server/discover` gibt es nur in der modernen Ära, die Methode bezeichnet sie
  // also auch dann, wenn ein Aufrufer die Version weglässt.
  const modern = modernMeta || discover || (revision !== null && revision >= FIRST_MODERN_REVISION);
  // Ein Aufrufer, der keine gültige Revision nennt, wird trotzdem gezählt, aber
  // unter einer festen Bezeichnung: Seine eigene Zeichenkette darf nicht ins
  // Journal.
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
  // Browser-Herkünfte, die mit diesem Server sprechen dürfen. Voreingestellt
  // leer: MCP-Clients sind keine Browser und schicken überhaupt keinen Origin,
  // die strenge Vorgabe kostet also nichts und schließt das Loch für
  // DNS-Rebinding, das die Spezifikation zu schließen verlangt. Ein Web-Client
  // lässt sich über MCP_HTTP_ALLOWED_ORIGINS ausdrücklich zulassen.
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
        // Meldet, ob der Dienst funktioniert, und nicht bloß, dass der Prozess
        // läuft. An einem HTTP-Endpunkt sieht kein Terminal auf stderr, und ohne
        // bible_setup gibt es keinen Weg mehr innerhalb des Protokolls, eine
        // kaputte Datenbank zu bemerken: Jedes Werkzeug wiese einfach ab, eines
        // nach dem anderen. 503 statt 200, damit eine Überwachung es sieht, ohne
        // den Rumpf zu zerlegen.
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

      // Spezifikation: Server MÜSSEN den Origin prüfen. Die eigene Option des SDK
      // dafür gilt als überholt, zugunsten genau dieser Art äußerer Prüfung.
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

      // Hält die Protokollrevision des Aufrufers fest, höchstens eine Zeile je
      // gesehener Version. Lässt die Anfrage nie scheitern: Ein Aufrufer darf ein
      // Nachschlagen nicht dadurch zerbrechen können, dass er einen Rumpf
      // schickt, den dies hier nicht lesen kann.
      await noteProtocolVersion(request);

      // Zustandslos: ein Server samt Transport je Anfrage, keine
      // Sitzungsregistratur. Dieser Server ist reines Anfrage-Antwort-Spiel, er
      // schiebt keine Benachrichtigungen und hat nichts fortzusetzen; Sitzungen
      // brächten ihm also nichts und kosteten eine Registratur, die zu räumen, zu
      // deckeln und verfallen zu lassen wäre. Eine frühere sitzungsbehaftete
      // Fassung lief genau dort aus (21 Anfragen, 21 Sitzungen, die nie
      // verschwanden, gemessen 25.07.2026). Beide Objekte fallen aus dem
      // Geltungsbereich, sobald der Antwortstrom endet.
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
   * Baut die Datenbank auf und endet: das Gegenstück zu bible_setup für die
   * Betreiberseite.
   *
   * Nötig, weil es bible_setup nur über stdio gibt (siehe HTTP_MODE): Ohne dieses
   * Flag verlangte das Einrichten eines HTTP-Endpunkts Bun und einen Checkout auf
   * dem Zielrechner, und der ganze Sinn des kompilierten Binaries ist, dass
   * beides dort nicht liegt.
   *
   * Das Flag wird auf Modulebene gelesen (SETUP_CLI), weil das Startprotokoll
   * dort ebenfalls davon wissen muss; argv ist bei `bun run server.ts` anders
   * indiziert als bei einem kompilierten Binary, deshalb wird es mit `includes`
   * gesucht statt an fester Stelle, und so trägt es in beiden Fällen.
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
