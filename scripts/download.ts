#!/usr/bin/env bun
/**
 * Download the German Bible translations from the bolls.life API into the
 * local SQLite database (table `verses`, one row set per translation).
 *
 * Run:
 *   bun run download.ts          # all four translations (~16 min)
 *   bun run download.ts LUT      # a single translation (LUT/SCH/ELB/MB)
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
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";
import { ensureVersesSchema, rebuildVersesFts } from "./schema.ts";
import { DEFAULT_TRANSLATION, TRANSLATIONS, type TranslationCode } from "../translations.ts";

const API_BASE = "https://bolls.life";
const DB_PATH = resolve(dirname(import.meta.path), "..", "data/bible.db");
const DELAY_MS = 200; // Polite rate limiting between requests

interface BollsBook {
  readonly bookid: number;
  readonly name: string;
  readonly chapters: number;
}

interface BollsVerse {
  readonly pk: number;
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

async function fetchJson<T>(path: string, retries = 3): Promise<T> {
  const url = `${API_BASE}${path}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API error ${response.status}: ${url}`);
      }
      // Await inside the try so JSON parse errors (truncated body, HTML error
      // page) are retried like network errors instead of escaping unhandled.
      return (await response.json()) as T;
    } catch (error) {
      if (attempt === retries - 1) throw error;
      const backoff = Math.pow(2, attempt) * 1000;
      console.warn(`  Retry ${attempt + 1}/${retries} after ${backoff}ms: ${error}`);
      await sleep(backoff);
    }
  }

  throw new Error(`Failed after ${retries} attempts: ${url}`);
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

/** Download one translation in its own atomic DB session. */
async function downloadTranslation(code: TranslationCode): Promise<void> {
  const meta = TRANSLATIONS[code];
  console.log(`\n=== ${meta.name} (${code}) ===`);

  console.log("Fetching book list...");
  const digest = createSourceDigest(`${API_BASE} (translation ${code}, JSON re-serialized)`);
  const books = await fetchBooks(code);
  digest.add(JSON.stringify(books));
  console.log(`Found ${books.length} books (validated)`);

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

    let totalVerses = 0;
    const totalChapters = books.reduce((sum, b) => sum + b.chapters, 0);
    let completedChapters = 0;

    for (const book of books) {
      const bookStart = totalVerses;

      for (let chapter = 1; chapter <= book.chapters; chapter++) {
        const verses = await fetchJson<BollsVerse[]>(
          `/get-text/${code}/${book.bookid}/${chapter}/`
        );
        if (!Array.isArray(verses)) {
          throw new Error(
            `Unexpected non-array response for ${book.name} chapter ${chapter}`
          );
        }
        digest.add(JSON.stringify(verses));

        db.transaction(() => {
          for (const v of verses) {
            insertVerse.run(code, book.bookid, chapter, v.verse, stripHtml(v.text));
            totalVerses++;
          }
        })();

        completedChapters++;
        await sleep(DELAY_MS);
      }

      const bookVerses = totalVerses - bookStart;
      const pct = ((completedChapters / totalChapters) * 100).toFixed(1);
      console.log(
        `  [${pct}%] ${book.name}: ${bookVerses} verses (${book.chapters} chapters)`
      );
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

async function main(): Promise<void> {
  const arg = (process.argv[2] ?? "all").trim();
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

main().catch((error) => {
  console.error("Download failed:", error);
  process.exit(1);
});
