import type { Database } from "bun:sqlite";

/**
 * Ensure `verses` exists with the multi-translation schema (filled by
 * download.ts).
 *
 * One row per translation and verse; `translation` is a code from
 * translations.ts (LUT/SCH/ELB/MB).
 *
 * One-time migration: an older single-translation table (without the
 * `translation` column, e.g. a database copied from a pre-1.0 layout) is
 * dropped together with its FTS index so download.ts can repopulate cleanly.
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
 * Ensure `strong_defs` exists (filled by download-lexicon.ts).
 *
 * One row per Strong's number ("G26" / "H7225" — prefixed, unique across both
 * testaments) with the pointed lemma, transliteration and the English
 * definitions from the Open Scriptures Strong's dictionaries (1890), plus the
 * modern STEPBible fields (CC BY 4.0):
 *   gloss   — Tyndale one-word gloss (Greek and Hebrew)
 *   meaning — full Abbott-Smith lexicon entry (Greek only; the Hebrew TBESH
 *             meaning field is © Online Bible and is deliberately not stored)
 *
 * One-time migration: older tables without the STEPBible columns get them
 * added in place (existing rows keep '' until download-lexicon.ts reruns).
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
 * Ensure `tagnt_words` exists (filled by download-tagnt.ts).
 *
 * STEPBible TAGNT (Translators Amalgamated Greek NT, CC BY 4.0): one row per
 * amalgamated NT word with the attestation across eight editions.
 *
 *   word_index — TAGNT word number within the verse (#NN, unique, file order)
 *   word_type  — N/K/O class, e.g. 'NKO', 'K', 'N(k)O'; N = Nestle-Aland,
 *                K = KJV/TR tradition, O = other editions; lower case = the
 *                difference does not affect translation
 *   editions   — '+'-joined attestation (NA28, NA27, Tyn, SBL, WH, Treg, TR,
 *                Byz), may carry word-order displacement markers like 'TR»1'
 *   meaning_variant / spelling_variant — significant variant notes (English)
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
 * Ensure `provenance` exists (written by every download-*.ts via provenance.ts).
 *
 * One row per script and logical source: number of requests, a rolling
 * SHA-256 over all payloads (in fetch order) and the fetch timestamp. Makes
 * the DB self-documenting: which upstream state produced the current data.
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
 * Rebuild the FTS5 full-text index over `verses` (drop + refill).
 *
 * `translation` is UNINDEXED: it must not pollute the token index (search
 * filters per translation with `AND translation = ?` instead). Stored text is
 * HTML-stripped (the DB may contain <i> emphasis tags; inside FTS they would
 * split phrases with stray "i" tokens). remove_diacritics folds umlauts, so
 * "fuhrt" also finds "führt".
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
 * Ensure `cross_references` exists (filled by download-crossrefs.ts).
 *
 * One row per directed reference from a single verse to a target verse or
 * range (end = start when the target is a single verse). `votes` is the
 * OpenBible.info community score — can be negative; consumers sort by it.
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
