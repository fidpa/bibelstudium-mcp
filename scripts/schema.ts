import type { Database } from "bun:sqlite";

/**
 * Stellt sicher, dass `verses` mit dem Schema für mehrere Übersetzungen
 * existiert (gefüllt von download.ts).
 *
 * Eine Zeile je Übersetzung und Vers; `translation` ist ein Kürzel aus
 * translations.ts.
 *
 * Einmalige Migration: Eine ältere Tabelle für eine einzige Übersetzung (ohne
 * die Spalte `translation`, etwa eine aus einem Layout vor 1.0 kopierte
 * Datenbank) wird samt ihrem FTS-Index verworfen, damit download.ts sauber neu
 * füllen kann.
 */
export function ensureVersesSchema(db: Database): void {
  const cols = db
    .query("PRAGMA table_info(verses)")
    .all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === "translation")) {
    db.exec("DROP TABLE verses");
    db.exec("DROP TABLE IF EXISTS verses_fts");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS verses (
      translation TEXT    NOT NULL,
      book_id     INTEGER NOT NULL REFERENCES books(book_id),
      chapter     INTEGER NOT NULL,
      verse       INTEGER NOT NULL,
      text        TEXT    NOT NULL,
      PRIMARY KEY (translation, book_id, chapter, verse)
    )
  `);
}

/**
 * Stellt sicher, dass `verse_notes` existiert: der Anmerkungsapparat einer
 * Ausgabe, eine Zeile je Fußnote.
 *
 *   translation – Kürzel aus translations.ts, also eine **Spalte** und nicht
 *                 Teil des Tabellennamens: Eine zweite Ausgabe mit eigenem
 *                 Apparat soll dieselbe Tabelle benutzen können.
 *   seq         – laufende Nummer innerhalb des Verses, in Quellreihenfolge. Ein
 *                 Vers trägt bis zu drei Noten, und ihre Reihenfolge gehört zur
 *                 Aussage; ohne sie wäre der Primärschlüssel nicht eindeutig.
 *   ref         – Stellenangabe der Ausgabe selbst ("3,16"), nicht die des
 *                 Servers. Sie steht dabei, weil sie im Druck bei der Note steht.
 *   text        – der Notentext ohne Auszeichnung.
 *
 * Kein Zusatzindex: Der Primärschlüssel erzeugt einen Autoindex, dessen Präfix
 * genau die Abfrage von `bible_lookup` bedient (translation, book_id, chapter),
 * und `ORDER BY verse, seq` fällt dabei mit ab. `verses` hat aus demselben Grund
 * keinen; `cross_references` hat einen, weil es dort keinen Primärschlüssel gibt.
 */
export function ensureVerseNotesSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS verse_notes (
      translation TEXT    NOT NULL,
      book_id     INTEGER NOT NULL,
      chapter     INTEGER NOT NULL,
      verse       INTEGER NOT NULL,
      seq         INTEGER NOT NULL,
      ref         TEXT    NOT NULL,
      text        TEXT    NOT NULL,
      PRIMARY KEY (translation, book_id, chapter, verse, seq)
    )
  `);
}

/**
 * Stellt sicher, dass `strong_defs` existiert (gefüllt von
 * download-lexicon.ts).
 *
 * Eine Zeile je Strong-Nummer ("G26" / "H7225": mit Präfix, über beide
 * Testamente eindeutig) mit punktiertem Lemma, Transliteration und den
 * englischen Definitionen aus den Strong-Wörterbüchern von Open Scriptures
 * (1890), dazu die neueren STEPBible-Felder (CC BY 4.0):
 *   gloss   – Tyndale-Ein-Wort-Glosse (Griechisch und Hebräisch)
 *   meaning – vollständiger Abbott-Smith-Eintrag (nur Griechisch; das
 *             hebräische TBESH-Bedeutungsfeld ist © Online Bible und wird
 *             bewusst nicht gespeichert)
 *
 * Einmalige Migration: Ältere Tabellen ohne die STEPBible-Spalten bekommen sie
 * an Ort und Stelle ergänzt (vorhandene Zeilen behalten '', bis
 * download-lexicon.ts erneut läuft).
 */
export function ensureStrongDefsSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strong_defs (
      strong     TEXT PRIMARY KEY,
      lemma      TEXT NOT NULL,
      translit   TEXT NOT NULL DEFAULT '',
      definition TEXT NOT NULL DEFAULT '',
      kjv        TEXT NOT NULL DEFAULT '',
      gloss      TEXT NOT NULL DEFAULT '',
      meaning    TEXT NOT NULL DEFAULT ''
    )
  `);
  const cols = db
    .query("PRAGMA table_info(strong_defs)")
    .all() as Array<{ name: string }>;
  for (const col of ["gloss", "meaning"]) {
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE strong_defs ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    }
  }
}

/**
 * Stellt sicher, dass `tagnt_words` existiert (gefüllt von download-tagnt.ts).
 *
 * STEPBible TAGNT (Translators Amalgamated Greek NT, CC BY 4.0): eine Zeile je
 * zusammengeführtem NT-Wort mit der Bezeugung über acht Editionen.
 *
 *   word_index – TAGNT-Wortnummer innerhalb des Verses (#NN, eindeutig, in
 *                Dateireihenfolge)
 *   word_type  – Klasse N/K/O, etwa 'NKO', 'K', 'N(k)O'; N = Nestle-Aland,
 *                K = KJV/TR-Tradition, O = weitere Editionen; Kleinschreibung
 *                heißt, der Unterschied wirkt sich nicht auf die Übersetzung
 *                aus
 *   editions   – mit '+' verbundene Bezeugung (NA28, NA27, Tyn, SBL, WH, Treg,
 *                TR, Byz), kann Marker für Wortstellung tragen wie 'TR»1'
 *   meaning_variant / spelling_variant – Notizen zu erheblichen Varianten
 *                (englisch)
 */
export function ensureTagntSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tagnt_words (
      book_id          INTEGER NOT NULL,
      chapter          INTEGER NOT NULL,
      verse            INTEGER NOT NULL,
      word_index       INTEGER NOT NULL,
      surface          TEXT NOT NULL,
      translit         TEXT NOT NULL DEFAULT '',
      word_type        TEXT NOT NULL,
      strong           TEXT NOT NULL DEFAULT '',
      grammar          TEXT NOT NULL DEFAULT '',
      editions         TEXT NOT NULL,
      meaning_variant  TEXT NOT NULL DEFAULT '',
      spelling_variant TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (book_id, chapter, verse, word_index)
    )
  `);
}

/**
 * Stellt sicher, dass `provenance` existiert (geschrieben von jedem
 * download-*.ts über provenance.ts).
 *
 * Eine Zeile je Skript und logischer Quelle: Anzahl der Anfragen, eine
 * fortlaufende SHA-256 über alle Nutzlasten (in Abrufreihenfolge) und der
 * Zeitpunkt des Abrufs. Damit dokumentiert sich die Datenbank selbst: Welcher
 * Stand der Gegenstelle hat die vorliegenden Daten erzeugt?
 */
export function ensureProvenanceSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provenance (
      script     TEXT NOT NULL,
      source     TEXT NOT NULL,
      files      INTEGER NOT NULL,
      sha256     TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (script, source)
    )
  `);
}

/**
 * Baut den FTS5-Volltextindex über `verses` neu (verwerfen und neu füllen).
 *
 * `translation` ist UNINDEXED: Das Kürzel darf den Token-Index nicht
 * verschmutzen, die Suche filtert stattdessen je Übersetzung mit
 * `AND translation = ?`. Der abgelegte Text ist HTML-bereinigt, denn die
 * Datenbank kann <i>-Hervorhebungen enthalten, und im FTS-Index zerrissen sie
 * Phrasen mit verirrten „i"-Tokens. remove_diacritics faltet die Umlaute, so
 * findet „fuhrt" auch „führt".
 */
export function rebuildVersesFts(db: Database): void {
  db.exec("DROP TABLE IF EXISTS verses_fts");
  db.exec(`
    CREATE VIRTUAL TABLE verses_fts USING fts5(
      text,
      translation UNINDEXED, book_id UNINDEXED, chapter UNINDEXED, verse UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `);
  const rows = db
    .query(
      "SELECT translation, book_id, chapter, verse, text FROM verses " +
        "ORDER BY translation, book_id, chapter, verse"
    )
    .all() as Array<{
    translation: string;
    book_id: number;
    chapter: number;
    verse: number;
    text: string;
  }>;
  const insert = db.prepare(
    "INSERT INTO verses_fts (text, translation, book_id, chapter, verse) VALUES (?, ?, ?, ?, ?)"
  );
  db.transaction(() => {
    for (const r of rows) {
      insert.run(r.text.replace(/<[^>]+>/g, ""), r.translation, r.book_id, r.chapter, r.verse);
    }
  })();
}

/**
 * Stellt sicher, dass `cross_references` existiert (gefüllt von
 * download-crossrefs.ts).
 *
 * Eine Zeile je gerichtetem Verweis von einem einzelnen Vers auf einen Zielvers
 * oder einen Bereich (Ende = Anfang, wenn das Ziel ein einzelner Vers ist).
 * `votes` ist die Gemeinschaftsbewertung von OpenBible.info; sie kann negativ
 * sein, Konsumenten sortieren danach.
 */
export function ensureCrossRefsSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_references (
      from_book      INTEGER NOT NULL,
      from_chapter   INTEGER NOT NULL,
      from_verse     INTEGER NOT NULL,
      to_book        INTEGER NOT NULL,
      to_chapter     INTEGER NOT NULL,
      to_verse       INTEGER NOT NULL,
      to_chapter_end INTEGER NOT NULL,
      to_verse_end   INTEGER NOT NULL,
      votes          INTEGER NOT NULL
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_xref_from ON cross_references (from_book, from_chapter, from_verse)"
  );
}

export function ensureOriginalWordsSchema(db: Database): void {
  const cols = db
    .query("PRAGMA table_info(original_words)")
    .all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === "edition")) {
    db.exec("DROP TABLE original_words");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS original_words (
      edition    TEXT NOT NULL,
      book_id    INTEGER NOT NULL,
      chapter    INTEGER NOT NULL,
      verse      INTEGER NOT NULL,
      word_index INTEGER NOT NULL,
      surface    TEXT NOT NULL,
      lemma      TEXT NOT NULL,
      strong     TEXT NOT NULL DEFAULT '',
      pos        TEXT NOT NULL DEFAULT '',
      parse      TEXT NOT NULL,
      lang       TEXT NOT NULL,
      PRIMARY KEY (edition, book_id, chapter, verse, word_index)
    )
  `);
}
