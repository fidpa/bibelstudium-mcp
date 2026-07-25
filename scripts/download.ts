#!/usr/bin/env bun
/**
 * Download the German Bible translations from the bolls.life API into the
 * local SQLite database (table `verses`, one row set per translation).
 *
 * Run:
 *   bun run download.ts          # all four translations (seconds)
 *   bun run download.ts LUT      # a single translation (LUT/SCH/ELB/MB)
 *
 * Each translation is fetched as one static JSON export. The API documentation
 * asks explicitly not to walk `get-text` chapter by chapter ("Please do not do
 * that! It is not what these endpoints are for, and it may cause performance
 * issues") and points to these exports instead; the whole Bible arrives in a
 * single ~7 MB request rather than 1190 of them.
 *
 * All supported translations are freely licensed (see translations.ts and
 * THIRD_PARTY_LICENSES.md). Schlachter 1951 is CC BY 4.0 — © Genfer
 * Bibelgesellschaft, license statement: https://ebible.org/deu1951/copyright.htm
 *
 * Each translation is downloaded in its own atomic DB session (copy + rename),
 * so an aborted multi-translation run keeps everything already completed.
 * Strips HTML footnotes (<f>...</f> tags) from verse text.
 */

import { dirname, resolve } from "path";
import { BOOK_ALIASES } from "./aliases.ts";
import { DB_PATH } from "../db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";
import { ensureVersesSchema, rebuildVersesFts } from "./schema.ts";
import { DEFAULT_TRANSLATION, TRANSLATIONS, type TranslationCode } from "../translations.ts";

const API_BASE = "https://bolls.life";
const STATIC_BASE = `${API_BASE}/static/translations`;

interface BollsBook {
  readonly bookid: number;
  readonly name: string;
  readonly chapters: number;
}

/** One row of a static translation export: the whole Bible in a flat list. */
interface BollsVerse {
  readonly book: number;
  readonly chapter: number;
  readonly verse: number;
  readonly text: string;
}

/**
 * Strip HTML tags from verse text.
 * bolls.life uses <f>&#2009;[123]</f> for footnotes and <i>...</i> for psalm superscriptions.
 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

/**
 * Fix book names from the API that miss the space before their parenthesis:
 * "2. Mose(Exodus)" → "2. Mose (Exodus)". Luther 1912 (the default source for
 * display names) is unaffected, but a run started with another translation
 * writes the names instead, and those carry the flaw. Book names render in
 * every concordance, search and cross-reference response.
 */
function normalizeBookName(name: string): string {
  return name.replace(/(\S)\(/g, "$1 (");
}

/**
 * Fetch and parse JSON, returning the raw body alongside the parsed value.
 *
 * The raw text feeds the provenance digest, so the checksum covers the bytes
 * actually received rather than a re-serialization of them.
 */
async function fetchJsonWithSource<T>(
  url: string,
  retries = 3
): Promise<{ readonly data: T; readonly raw: string }> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API error ${response.status}: ${url}`);
      }
      // Read and parse inside the try so JSON parse errors (truncated body,
      // HTML error page) are retried like network errors instead of escaping
      // unhandled.
      const raw = await response.text();
      return { data: JSON.parse(raw) as T, raw };
    } catch (error) {
      if (attempt === retries - 1) throw error;
      const backoff = Math.pow(2, attempt) * 1000;
      console.warn(`  Retry ${attempt + 1}/${retries} after ${backoff}ms: ${error}`);
      await sleep(backoff);
    }
  }

  throw new Error(`Failed after ${retries} attempts: ${url}`);
}

async function fetchJson<T>(path: string, retries = 3): Promise<T> {
  return (await fetchJsonWithSource<T>(`${API_BASE}${path}`, retries)).data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fetch and validate the book list of one translation (Protestant canon only). */
async function fetchBooks(code: TranslationCode): Promise<BollsBook[]> {
  const raw = await fetchJson<BollsBook[]>(`/get-books/${code}/`);
  if (!Array.isArray(raw)) {
    throw new Error(`Book list for ${code} is not an array — API changed?`);
  }
  // Some translations may list deuterocanonical books with IDs > 66; the
  // server's book_id convention covers the 66-book Protestant canon only.
  const books = raw.filter(
    (b) => typeof b.bookid === "number" && b.bookid >= 1 && b.bookid <= 66
  );
  if (books.length !== 66) {
    throw new Error(
      `Expected 66 canonical books for ${code}, got ${books.length}. The API may have changed.`
    );
  }
  for (const book of books) {
    if (typeof book.name !== "string" || book.name.length === 0 || book.name.length > 100) {
      throw new Error(`Invalid book name for ID ${book.bookid}: "${book.name}"`);
    }
    if (typeof book.chapters !== "number" || book.chapters < 1 || book.chapters > 150) {
      throw new Error(`Invalid chapter count ${book.chapters} for "${book.name}"`);
    }
  }
  return books;
}

/**
 * Validate a static translation export and keep the canonical books.
 *
 * The export is one flat list for the whole Bible, so a malformed entry has no
 * surrounding request to name it: the index and the offending value go into the
 * message instead. Books beyond 66 are deuterocanonical and dropped, matching
 * the filter in fetchBooks().
 */
function validateVerses(data: unknown, code: TranslationCode): BollsVerse[] {
  if (!Array.isArray(data)) {
    throw new Error(`Static export for ${code} is not an array — source changed?`);
  }

  const out: BollsVerse[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i] as Record<string, unknown>;
    if (row === null || typeof row !== "object") {
      throw new Error(`Entry ${i} of the ${code} export is not an object`);
    }
    const { book, chapter, verse, text } = row;
    if (typeof book !== "number" || typeof chapter !== "number" || typeof verse !== "number") {
      throw new Error(
        `Entry ${i} of the ${code} export has non-numeric book/chapter/verse: ` +
          `${JSON.stringify({ book, chapter, verse })}`
      );
    }
    if (typeof text !== "string") {
      throw new Error(`Entry ${i} of the ${code} export has a non-string text field`);
    }
    if (book < 1 || book > 66) continue;
    out.push({ book, chapter, verse, text });
  }

  if (out.length === 0) {
    throw new Error(`Static export for ${code} contained no canonical verses`);
  }
  return out;
}

/** Download one translation in its own atomic DB session. */
async function downloadTranslation(code: TranslationCode): Promise<void> {
  const meta = TRANSLATIONS[code];
  console.log(`\n=== ${meta.name} (${code}) ===`);

  console.log("Fetching book list...");
  const digest = createSourceDigest(`${STATIC_BASE}/${code}.json (+ ${API_BASE}/get-books/${code}/)`);
  const books = await fetchBooks(code);
  digest.add(JSON.stringify(books));
  console.log(`Found ${books.length} books (validated)`);

  console.log("Fetching full translation...");
  const { data, raw } = await fetchJsonWithSource<unknown>(`${STATIC_BASE}/${code}.json`);
  digest.add(raw);
  const verses = validateVerses(data, code);
  console.log(`Received ${verses.length} verses (${(raw.length / 1048576).toFixed(1)} MB)`);

  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        book_id    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        chapters   INTEGER NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS aliases (
        alias      TEXT PRIMARY KEY COLLATE NOCASE,
        book_id    INTEGER NOT NULL REFERENCES books(book_id)
      )
    `);
    ensureVersesSchema(db);

    // Display names come deterministically from the default translation
    // (Luther 1912) regardless of download order; other runs only fill in
    // when the table is still empty.
    const booksEmpty =
      (db.query("SELECT COUNT(*) as n FROM books").get() as { n: number }).n === 0;
    if (code === DEFAULT_TRANSLATION || booksEmpty) {
      db.exec("DELETE FROM aliases");
      db.exec("DELETE FROM books");
      const insertBook = db.prepare(
        "INSERT INTO books (book_id, name, chapters) VALUES (?, ?, ?)"
      );
      for (const book of books) {
        insertBook.run(book.bookid, normalizeBookName(book.name), book.chapters);
      }
      const insertAlias = db.prepare(
        "INSERT OR IGNORE INTO aliases (alias, book_id) VALUES (?, ?)"
      );
      for (const [alias, bookId] of BOOK_ALIASES) {
        insertAlias.run(alias, bookId);
      }
      console.log(`Book names and aliases written (source: ${meta.name})`);
    }

    // Refill only this translation's rows.
    db.prepare("DELETE FROM verses WHERE translation = ?").run(code);
    const insertVerse = db.prepare(
      "INSERT INTO verses (translation, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)"
    );

    // One transaction for the whole translation: the data is already in memory,
    // so there is nothing to stream and no partial state worth keeping.
    db.transaction(() => {
      for (const v of verses) {
        insertVerse.run(code, v.book, v.chapter, v.verse, stripHtml(v.text));
      }
    })();

    const perBook = new Map<number, number>();
    for (const v of verses) {
      perBook.set(v.book, (perBook.get(v.book) ?? 0) + 1);
    }
    for (const book of books) {
      const n = perBook.get(book.bookid) ?? 0;
      if (n === 0) {
        throw new Error(
          `No verses for "${book.name}" (book ${book.bookid}) in the ${code} export`
        );
      }
      console.log(`  ${book.name}: ${n} verses (${book.chapters} chapters)`);
    }

    const count = db
      .query("SELECT COUNT(*) as n FROM verses WHERE translation = ?")
      .get(code) as { n: number };
    if (count.n === 0) throw new Error(`No verses stored for ${code} — API changed?`);
    console.log(`Done! ${count.n} ${meta.name} verses in database.`);

    // Rebuild the full-text index over all translations (also: build-fts.ts).
    // Doing it per session keeps the index consistent even if a multi-
    // translation run is aborted between sessions.
    rebuildVersesFts(db);
    console.log("Full-text index (verses_fts) rebuilt.");

    writeProvenance(db, `download.ts#${code}`, [digest]);
    commit();
  } catch (err) {
    abort(); // leave any existing live database untouched
    throw err;
  }
}

export async function main(selection?: string): Promise<void> {
  // The parameter exists for setup.ts, which calls this from inside the server
  // where process.argv carries the client's arguments, not ours.
  const arg = (selection ?? process.argv[2] ?? "all").trim();
  let codes: readonly TranslationCode[];
  if (arg.toLowerCase() === "all") {
    codes = Object.keys(TRANSLATIONS) as TranslationCode[];
  } else if (arg.toUpperCase() in TRANSLATIONS) {
    codes = [arg.toUpperCase() as TranslationCode];
  } else {
    throw new Error(
      `Unknown translation "${arg}". Allowed: ${Object.keys(TRANSLATIONS).join(", ")}, all`
    );
  }

  console.log("=== German Bible translations download (bolls.life) ===");
  console.log(`Database: ${DB_PATH}`);
  console.log(`Translations: ${codes.join(", ")}`);

  for (const code of codes) {
    await downloadTranslation(code);
  }

  const { statSync } = await import("fs");
  const sizeMB = (statSync(DB_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`\nDatabase size: ${sizeMB} MB`);
}

// Run only when invoked directly. setup.ts imports main() so the server can
// build the database itself; an import must not start a download.
if (import.meta.main) {
  main().catch((error) => {
    console.error("Download failed:", error);
    process.exit(1);
  });
}
