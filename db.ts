/**
 * Die Datenschicht: die Datenbankverbindung, ihre Unversehrtheitsprüfung, alle
 * vorbereiteten Statements und die Merkmale des vorhandenen Bestands.
 *
 * Anders als die übrigen Module dieser Seite ist das hier nicht zustandsfrei,
 * im Gegenteil: Es ist der geteilte Zustand des Servers. Dass es trotzdem eine
 * eigene Datei sein kann, hat zwei Gründe, und beide sind gemessen. Der Block
 * ist zirkelfrei, er benutzt von der Logik des Servers nichts. Und er wird
 * einmal beim Start ausgewertet und danach nie wieder geschrieben: Ein
 * erfolgreicher Datenaufbau ersetzt die Datei auf der Platte, nicht diese
 * Verbindung, und wird erst mit einem Neustart wirksam. Deshalb genügt jedem
 * Aufrufer ein Import, und keiner braucht ein durchgereichtes Kontextobjekt.
 *
 * Die Reihenfolge in dieser Datei ist bindend: Alles unterhalb des try-catch
 * liest `db` auf Modulebene. Eine Deklaration, die darüber wandert, findet dort
 * kein `undefined` vor, das ein Typfehler wäre, sondern scheitert zur Laufzeit.
 *
 * `HTTP_MODE` und `SETUP_CLI` stehen hier, obwohl sie aus der Umgebung kommen
 * und nicht aus der Datenbank: Sie werden neben `dataMissing` gelesen, weil die
 * drei zusammen entscheiden, welche Werkzeuge es überhaupt gibt.
 *
 * Die acht Bannerabschnitte gliedern nach Tabelle, nicht nach Belieben: Wer
 * eine Abfrage sucht, sucht sie über die Tabelle, aus der sie liest.
 */
import { Database } from "bun:sqlite";
import { DB_PATH } from "./db-path.ts";

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
 * andere Werkzeug weist mit einem Verweis darauf ab (siehe `handleCallTool` in
 * server.ts).
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

export let db: Database;
export let dataMissing: string | null = null;
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
 * stattdessen mit `--setup` oder `bun run setup` auf (siehe `main()` in server.ts).
 *
 * Aus der Umgebung abgeleitet statt aus `main()` in server.ts durchgereicht,
 * damit der Wert dem dort tatsächlich gewählten Transport nicht widersprechen
 * kann.
 */
export const HTTP_MODE = (process.env["MCP_HTTP_PORT"] ?? "") !== "";

/**
 * Wahr, wenn der Start dem Datenbankaufbau gilt statt dem Bedienen (siehe
 * `main()` in server.ts).
 */
export const SETUP_CLI = process.argv.includes("--setup");

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
export const stmtAlias = db.prepare<{ book_id: number }, [string]>(
  "SELECT book_id FROM aliases WHERE alias = ? COLLATE NOCASE"
);

export const stmtVerses = db.prepare<{ verse: number; text: string }, [string, number, number]>(
  "SELECT verse, text FROM verses WHERE translation = ? AND book_id = ? AND chapter = ? ORDER BY verse"
);

export const stmtVerse = db.prepare<{ verse: number; text: string }, [string, number, number, number]>(
  "SELECT verse, text FROM verses WHERE translation = ? AND book_id = ? AND chapter = ? AND verse = ?"
);

export const stmtVerseRange = db.prepare<
  { verse: number; text: string },
  [string, number, number, number, number]
>(
  "SELECT verse, text FROM verses WHERE translation = ? AND book_id = ? AND chapter = ? AND verse >= ? AND verse <= ? ORDER BY verse"
);

// Welche Übersetzungen tatsächlich gefüllt sind (für Prüfung und Meldungen).
export const availableTranslations: Set<string> = new Set(
  (db.query("SELECT DISTINCT translation FROM verses").all() as Array<{
    translation: string;
  }>).map((r) => r.translation)
);

export const stmtBookName = db.prepare<{ name: string }, [number]>(
  "SELECT name FROM books WHERE book_id = ?"
);

export const stmtBookByName = db.prepare<{ book_id: number }, [string]>(
  "SELECT book_id FROM books WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY book_id LIMIT 1"
);

// Die ganze Tabelle, für die Ressource `bible://buecher`. `chapters` führt das
// Schema seit je mit, gelesen wurde es bislang nie.
export const stmtBooks = db.prepare<{ book_id: number; name: string; chapters: number }, []>(
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
export const dataFetchedAt: string | null = (() => {
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
export const originalEditions: readonly string[] = hasOriginal
  ? (
      db.query("SELECT DISTINCT edition FROM original_words ORDER BY edition").all() as Array<{
        edition: string;
      }>
    ).map((r) => r.edition)
  : [];

export const stmtOriginal = hasOriginal
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
export const availableEditions: Set<string> = new Set(
  hasOriginal
    ? (db.query("SELECT DISTINCT edition FROM original_words").all() as Array<{
        edition: string;
      }>).map((r) => r.edition)
    : []
);

// Konkordanzabfragen laufen über die Zeilen einer Edition (ohne eigenen Index;
// die Datenbank wird nur lesend geöffnet, und ein voller Editionsdurchlauf
// kostet im lokalen SQLite wenige Millisekunden).
export const stmtConcordStrong = hasOriginal
  ? db.prepare<
      { book_id: number; chapter: number; verse: number; surface: string; lemma: string; strong: string },
      [string, string]
    >(
      "SELECT book_id, chapter, verse, surface, lemma, strong FROM original_words " +
        "WHERE edition = ? AND strong = ? ORDER BY book_id, chapter, verse, word_index"
    )
  : null;

export const stmtConcordLemma = hasOriginal
  ? db.prepare<
      { book_id: number; chapter: number; verse: number; surface: string; lemma: string; strong: string },
      [string, string]
    >(
      "SELECT book_id, chapter, verse, surface, lemma, strong FROM original_words " +
        "WHERE edition = ? AND lemma = ? ORDER BY book_id, chapter, verse, word_index"
    )
  : null;

// --- Strong-Definitionen (optionale Tabelle, download-lexicon.ts) ----------
export const hasStrongDefs =
  db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='strong_defs'")
    .get() !== null;

// gloss und meaning sind die neueren STEPBible-Spalten (meaning gibt es nur im
// Griechischen, siehe schema.ts). Einer vor dieser Migration gebauten Datenbank
// fehlen sie, und geöffnet wird hier nur lesend; deshalb werden stattdessen
// Platzhalter '' ausgewählt, bis download-lexicon.ts erneut läuft.
export const hasStepCols = hasStrongDefs
  ? (db.query("PRAGMA table_info(strong_defs)").all() as Array<{ name: string }>).some(
      (c) => c.name === "gloss"
    )
  : false;
export const stmtStrongDef = hasStrongDefs
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
export const hasTagnt =
  db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='tagnt_words'")
    .get() !== null;

export const stmtTagnt = hasTagnt
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
export const hasFts =
  db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='verses_fts'")
    .get() !== null;

export const stmtSearchCount = hasFts
  ? db.prepare<{ n: number }, [string, string]>(
      "SELECT COUNT(*) as n FROM verses_fts WHERE verses_fts MATCH ? AND translation = ?"
    )
  : null;
export const stmtSearchCountBook = hasFts
  ? db.prepare<{ n: number }, [string, string, number]>(
      "SELECT COUNT(*) as n FROM verses_fts WHERE verses_fts MATCH ? AND translation = ? AND book_id = ?"
    )
  : null;
export const stmtSearch = hasFts
  ? db.prepare<
      { book_id: number; chapter: number; verse: number; text: string },
      [string, string, number]
    >(
      "SELECT book_id, chapter, verse, highlight(verses_fts, 0, '⟦', '⟧') as text " +
        "FROM verses_fts WHERE verses_fts MATCH ? AND translation = ? ORDER BY book_id, chapter, verse LIMIT ?"
    )
  : null;
export const stmtSearchBook = hasFts
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
// `verteilung`-Block in `handleSearch` (handlers/search.ts).
export const stmtSearchAll = hasFts
  ? db.prepare<{ book_id: number; chapter: number; text: string }, [string, string, number]>(
      "SELECT book_id, chapter, highlight(verses_fts, 0, '⟦', '⟧') as text " +
        "FROM verses_fts WHERE verses_fts MATCH ? AND translation = ? LIMIT ?"
    )
  : null;
export const stmtSearchAllBook = hasFts
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
export const OCCURRENCE_SCAN_LIMIT = 1000;

// Treffermarker dürfen im Verstext selbst nicht vorkommen. Das naheliegende «…»
// stößt mit den eigenen Anführungszeichen der Übersetzungen zusammen: Menge
// führt sie in 8339 Versen, Schlachter in 887, und sie verschachteln andersherum
// (»Zitat«), sodass ein schließendes « sowohl für eine Zählung als auch für
// einen Menschen wie ein Marker aussieht. ⟦⟧ kommt in keiner der geführten
// Übersetzungen vor (geprüft 25.07.2026 an vieren, 05.08.2026 an Schlachter 2000).
// Muss mit den Trennzeichen der beiden `highlight()`-Aufrufe oben übereinstimmen.
export const HIT_OPEN = "⟦";

// --- Querverweise (OpenBible.info / TSK, optionale Tabelle) ----------------
export const hasXrefs =
  db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='cross_references'"
    )
    .get() !== null;

export const stmtXrefs = hasXrefs
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

// --- Fußnoten der Ausgaben (optionale Tabelle, import-schlachter2000.ts) ---
// Der Anmerkungsapparat einer gedruckten Ausgabe: wo sie selbst sagt, dass ihre
// Wiedergabe eine Wahl unter mehreren ist. Optional wie die übrigen
// Zusatztabellen, denn er kommt nicht aus dem freien Erstaufbau.
//
// Kapitelweise abgefragt, weil `bible_lookup` seine Verse ohnehin kapitelweise
// holt: Eine Abfrage je Vers wäre bei einem ganzen Kapitel bis zu 176 Abfragen
// für im Schnitt vier Treffer.
export const hasVerseNotes =
  db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='verse_notes'")
    .get() !== null;

export const stmtVerseNotes = hasVerseNotes
  ? db.prepare<
      { verse: number; ref: string; text: string },
      [string, number, number]
    >(
      "SELECT verse, ref, text FROM verse_notes " +
        "WHERE translation = ? AND book_id = ? AND chapter = ? ORDER BY verse, seq"
    )
  : null;
