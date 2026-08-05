#!/usr/bin/env bun
/**
 * Lädt die deutschen Bibelübersetzungen von der bolls.life-API in die lokale
 * SQLite-Datenbank (Tabelle `verses`, ein Satz Zeilen je Übersetzung).
 *
 * Aufruf:
 *   bun run download.ts          # alle bei bolls.life geführten (Sekunden)
 *   bun run download.ts LUT      # eine einzelne (LUT/SCH/ELB/MB)
 *
 * Jede Übersetzung kommt als ein statischer JSON-Export. Die API-Dokumentation
 * bittet ausdrücklich darum, `get-text` nicht kapitelweise abzugehen („Please
 * do not do that! It is not what these endpoints are for, and it may cause
 * performance issues") und nennt stattdessen diese Exporte; die ganze Bibel
 * kommt so in einer einzigen Anfrage von rund 7 MB statt in 1190 Anfragen.
 *
 * Alle geführten Übersetzungen sind frei lizenziert (siehe translations.ts und
 * THIRD_PARTY_LICENSES.md). Schlachter 1951 steht unter CC BY 4.0, © Genfer
 * Bibelgesellschaft, Lizenzangabe: https://ebible.org/deu1951/copyright.htm
 *
 * Jede Übersetzung wird in einer eigenen atomaren Datenbanksitzung geladen
 * (kopieren und umbenennen); ein abgebrochener Lauf über mehrere Übersetzungen
 * behält damit alles bereits Fertige. HTML-Fußnoten (<f>...</f>) werden aus dem
 * Verstext entfernt.
 */

import { dirname, resolve } from "path";
import { BOOK_ALIASES } from "./aliases.ts";
import { DB_PATH } from "../src/db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";
import { ensureVersesSchema, rebuildVersesFts } from "./schema.ts";
import { DEFAULT_TRANSLATION, TRANSLATIONS, type TranslationCode } from "../src/translations.ts";

const API_BASE = "https://bolls.life";
const STATIC_BASE = `${API_BASE}/static/translations`;

interface BollsBook {
  readonly bookid: number;
  readonly name: string;
  readonly chapters: number;
}

/** Eine Zeile eines statischen Übersetzungsexports: die ganze Bibel als flache Liste. */
interface BollsVerse {
  readonly book: number;
  readonly chapter: number;
  readonly verse: number;
  readonly text: string;
}

/**
 * Entfernt HTML-Auszeichnungen aus dem Verstext.
 * bolls.life setzt <f>&#2009;[123]</f> für Fußnoten und <i>...</i> für
 * Psalmüberschriften.
 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

/**
 * Bessert Buchnamen der API aus, denen das Leerzeichen vor der Klammer fehlt:
 * "2. Mose(Exodus)" → "2. Mose (Exodus)". Luther 1912, die vorgesehene Quelle
 * der Anzeigenamen, ist nicht betroffen; ein mit einer anderen Übersetzung
 * gestarteter Lauf schreibt aber die Namen, und die tragen den Fehler.
 * Buchnamen erscheinen in jeder Antwort von Konkordanz, Suche und
 * Querverweisen.
 */
function normalizeBookName(name: string): string {
  return name.replace(/(\S)\(/g, "$1 (");
}

/**
 * Holt JSON und parst es; liefert den Rohtext neben dem geparsten Wert.
 *
 * Der Rohtext geht in die Herkunftsprüfsumme, damit sie über die tatsächlich
 * empfangenen Bytes läuft und nicht über eine erneute Serialisierung davon.
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
      // Lesen und Parsen innerhalb des try: So werden Parse-Fehler (abgeschnittene
      // Antwort, HTML-Fehlerseite) wie Netzwerkfehler wiederholt, statt
      // unbehandelt zu entkommen.
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

/** Holt und prüft die Bücherliste einer Übersetzung (nur der protestantische Kanon). */
async function fetchBooks(code: TranslationCode): Promise<BollsBook[]> {
  const raw = await fetchJson<BollsBook[]>(`/get-books/${code}/`);
  if (!Array.isArray(raw)) {
    throw new Error(`Book list for ${code} is not an array — API changed?`);
  }
  // Manche Übersetzungen führen deuterokanonische Bücher mit Nummern über 66;
  // die book_id-Konvention des Servers deckt allein die 66 Bücher des
  // protestantischen Kanons ab.
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
 * Prüft einen statischen Übersetzungsexport und behält die kanonischen Bücher.
 *
 * Der Export ist eine flache Liste für die ganze Bibel; einen fehlerhaften
 * Eintrag benennt also keine umgebende Anfrage, und deshalb stehen sein Index
 * und der beanstandete Wert in der Meldung. Bücher jenseits von 66 sind
 * deuterokanonisch und fallen weg, wie schon beim Filter in fetchBooks().
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

/** Lädt eine Übersetzung in einer eigenen atomaren Datenbanksitzung. */
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

    // Die Anzeigenamen stammen unabhängig von der Downloadreihenfolge immer aus
    // der voreingestellten Übersetzung (Luther 1912); andere Läufe springen nur
    // ein, solange die Tabelle noch leer ist.
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

    // Nur die Zeilen dieser Übersetzung neu füllen.
    db.prepare("DELETE FROM verses WHERE translation = ?").run(code);
    const insertVerse = db.prepare(
      "INSERT INTO verses (translation, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)"
    );

    // Eine Transaktion für die ganze Übersetzung: Die Daten liegen bereits im
    // Speicher, es gibt nichts zu streamen und keinen Zwischenstand, der sich zu
    // behalten lohnte.
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

    // Volltextindex über alle Übersetzungen neu bauen (auch build-fts.ts tut
    // das). Je Sitzung ausgeführt, bleibt der Index selbst dann stimmig, wenn
    // ein Lauf über mehrere Übersetzungen zwischen zwei Sitzungen abbricht.
    rebuildVersesFts(db);
    console.log("Full-text index (verses_fts) rebuilt.");

    writeProvenance(db, `download.ts#${code}`, [digest]);
    commit();
  } catch (err) {
    abort(); // eine vorhandene laufende Datenbank bleibt unberührt
    throw err;
  }
}

export async function main(selection?: string): Promise<void> {
  // Den Parameter gibt es für setup.ts: Es ruft diese Funktion aus dem Server
  // heraus auf, wo in process.argv die Argumente des Clients stehen, nicht unsere.
  const arg = (selection ?? process.argv[2] ?? "all").trim();
  // Nur die Übersetzungen, die es bei bolls.life überhaupt gibt. Die Registry
  // führt auch solche mit `quelle: "lokal"`, deren Dateien nur beim Betreiber
  // liegen; sie hier mitzunehmen hieße, `setup.ts` an einem 404 scheitern zu
  // lassen, und weil der Schritt `required` ist, fielen die sieben folgenden
  // Datensätze mit aus.
  const fromBolls = (Object.keys(TRANSLATIONS) as TranslationCode[]).filter(
    (c) => TRANSLATIONS[c].quelle === "bolls"
  );
  let codes: readonly TranslationCode[];
  if (arg.toLowerCase() === "all") {
    codes = fromBolls;
  } else if (arg.toUpperCase() in TRANSLATIONS) {
    const code = arg.toUpperCase() as TranslationCode;
    if (TRANSLATIONS[code].quelle !== "bolls") {
      throw new Error(
        `Translation "${code}" (${TRANSLATIONS[code].name}) does not come from bolls.life ` +
          `and cannot be downloaded with this script.`
      );
    }
    codes = [code];
  } else {
    throw new Error(
      `Unknown translation "${arg}". Allowed: ${fromBolls.join(", ")}, all`
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

// Nur bei direktem Aufruf ausführen. setup.ts importiert main(), damit der
// Server die Datenbank selbst aufbauen kann; ein Import darf keinen Download
// starten.
if (import.meta.main) {
  main().catch((error) => {
    console.error("Download failed:", error);
    process.exit(1);
  });
}
