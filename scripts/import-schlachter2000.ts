#!/usr/bin/env bun
/**
 * Liest die USX-3.0-Lieferung der Schlachter 2000 in die lokale SQLite-Datenbank:
 * die Verse nach `verses` (translation 'SLT'), den Anmerkungsapparat nach
 * `verse_notes`.
 *
 * Aufruf (nachdem download.ts die bible.db gebaut hat):
 *   bun run import:slt [verzeichnis]
 *
 * Quelle: Digital Bible Library, geliefert von der Genfer Bibelgesellschaft
 *   (Société Biblique de Genève). Die Dateien sind **nicht** frei lizenziert und
 *   liegen deshalb nur beim Betreiber; das Verzeichnis ist gitignored. Aus
 *   demselben Grund steht dieses Skript **nicht** in setup.ts und wird nicht von
 *   bible_setup gerufen: Ein Nutzer kann die Quelle nicht laden, und ein
 *   Schritt, der bei jedem außer einem scheitert, gehört nicht in den Erstaufbau.
 *
 * Voreingestellt wird `docs/intern/Schlachter2000USX` relativ zur Repo-Wurzel
 * gelesen; ein Argument überschreibt das.
 *
 * Rückweg (Abkommen kommt nicht zustande, oder die drei Jahre laufen aus):
 *   bun run import:slt --entfernen
 * löscht beide Datensätze und baut den Volltextindex neu. Das ist der einzige
 * Weg, der die Datei atomar tauscht; ein DELETE von Hand auf der laufenden
 * Datenbank erzeugt „disk I/O error" in offenen Lesern.
 *
 * ERGÄNZEND: fasst `verses` (nur translation 'SLT'), `verse_notes` und den
 * Volltextindex an.
 */

import { dirname, resolve } from "path";
import { readFileSync, readdirSync, statSync } from "fs";
import { ensureVersesSchema, ensureVerseNotesSchema, rebuildVersesFts } from "./schema.ts";
import { DB_PATH } from "../src/db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";
import { createSourceDigest, writeProvenance } from "./provenance.ts";

const TRANSLATION = "SLT";

const DEFAULT_DIR = resolve(dirname(import.meta.path), "..", "docs/intern/Schlachter2000USX");

/** Erwartungswerte der Lieferung, gemessen am 05.08.2026 über alle 66 Dateien. */
const EXPECTED_FILES = 66;
const EXPECTED_VERSES = 31171;
const EXPECTED_NOTES = 1220;

// USFM-Buchcode → bolls.life-book_id (1 bis 66). Dieselbe Kanonreihenfolge wie
// die OSIS-Tabelle in download-crossrefs.ts, nur mit den Codes der USX-Dateien.
const BOOKS: Record<string, number> = {
  GEN: 1, EXO: 2, LEV: 3, NUM: 4, DEU: 5, JOS: 6, JDG: 7, RUT: 8,
  "1SA": 9, "2SA": 10, "1KI": 11, "2KI": 12, "1CH": 13, "2CH": 14,
  EZR: 15, NEH: 16, EST: 17, JOB: 18, PSA: 19, PRO: 20, ECC: 21, SNG: 22,
  ISA: 23, JER: 24, LAM: 25, EZK: 26, DAN: 27, HOS: 28, JOL: 29, AMO: 30,
  OBA: 31, JON: 32, MIC: 33, NAM: 34, HAB: 35, ZEP: 36, HAG: 37, ZEC: 38,
  MAL: 39,
  MAT: 40, MRK: 41, LUK: 42, JHN: 43, ACT: 44, ROM: 45, "1CO": 46,
  "2CO": 47, GAL: 48, EPH: 49, PHP: 50, COL: 51, "1TH": 52, "2TH": 53,
  "1TI": 54, "2TI": 55, TIT: 56, PHM: 57, HEB: 58, JAS: 59, "1PE": 60,
  "2PE": 61, "1JN": 62, "2JN": 63, "3JN": 64, JUD: 65, REV: 66,
};

// Absatzstile, deren Inhalt **nicht** zum Vers gehört, obwohl er zwischen
// dessen Meilensteinen steht. Verse sind in USX Meilensteine, keine Elemente:
// gemessen überspannen 3885 der 31 171 Verse (12,5 %) mindestens eine
// <para>-Grenze, und in fünf Fällen liegt dazwischen eine Überschrift oder eine
// Sprecherangabe (05.08.2026): Abschnittsüberschriften in Apg 9,19 und Jes
// 59,15, Sprecherangaben in Hld 7,1, 7,10 und 8,5. Wer nur „alle Textknoten
// zwischen sid und eid" einsammelt, liefert „…und kam zu Kräften. Saulus in
// Damaskus und Jerusalem Und Saulus war…" als Verstext aus, also Verlagstext an
// einer Stelle, an der er nicht steht.
//
// Die Liste greift bewusst weiter als das Gemessene: Sie nennt die ganze
// Überschriften-Familie, damit eine spätere Lieferung mit `s2` oder `mr` nicht
// still durchrutscht.
//
// **Nicht** darin: `d` (Psalmüberschrift, 11 Fälle, etwa Ps 8,1). Die deutsche
// Zählung dieser Ausgabe führt sie als Vers 1, sie gehört also in den Vers.
const SKIP_PARA_STYLES = new Set([
  "s", "s1", "s2", "s3", "s4", "sp", "sr", "r", "ms", "ms1", "ms2", "mr", "qa",
]);

interface VerseRow {
  book: number;
  chapter: number;
  verse: number;
  text: string;
}

interface NoteRow {
  book: number;
  chapter: number;
  verse: number;
  seq: number;
  ref: string;
  text: string;
}

/**
 * Entfernt die XML-Auszeichnung aus einem Bruchstück und normalisiert Leerraum.
 *
 * Tags fallen zur **leeren** Zeichenkette, nicht zu einem Leerzeichen: Innerhalb
 * einer Versspanne stehen 138 489 `<char>`-Elemente mitten im Wort und mitten im
 * Satz, und ein Leerzeichen je Tag setzte in 3536 Versen eine Lücke vor das
 * Satzzeichen („des Herrn , und Salomo"). Der Worttrenner an den `<para>`-Grenzen
 * geht dabei nicht verloren: Zwischen `</para>` und `<para>` steht in der
 * Lieferung ausnahmslos Einrückungsleerraum, und der ist ein Textknoten
 * (gemessen 05.08.2026, 0 Ausnahmen).
 */
function stripMarkup(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Löst die fünf vordefinierten XML-Entities auf. Die Lieferung führt keine
 * (gemessen 05.08.2026), das ist Vorsorge für eine spätere: Ein `&amp;`, das
 * ungelöst in `verses` landet, steht dort für immer falsch, und der Volltextindex
 * zerlegt es zusätzlich in eigene Token.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Zerlegt eine USX-Datei in Verse und Fußnoten.
 *
 * Zwei Anker, und der zweite ist der wichtigere:
 *
 * Der **Vers** hängt an den Meilensteinen `<verse … sid="JHN 3:16"/>` und
 * `<verse eid="JHN 3:16"/>`; dazwischen läuft der Text durch beliebig viele
 * Absätze.
 *
 * Die **Note** hängt an ihrer eigenen Stellenangabe `<char style="fr">`, nicht
 * am umgebenden Vers. Beides fällt in 1219 von 1220 Fällen zusammen; die
 * Ausnahme ist die Note zu Ps 119,1, die an der Akrostichon-Überschrift vor dem
 * ersten Vers des Kapitels hängt und beim Ankern nach dem Vers verlorenginge.
 * Die Stellenangabe trägt: Alle 1220 haben die Form „K,V ", und alle 1220 Ziele
 * existieren als Vers (gemessen 05.08.2026).
 */
function parseUsx(xml: string, bookId: number): { verses: VerseRow[]; notes: NoteRow[] } {
  const verses: VerseRow[] = [];
  const notes: NoteRow[] = [];
  const notesPerVerse = new Map<string, number>();

  // Noten zuerst, denn sie werden gleich darauf aus dem Verstext geschnitten.
  // Der Regex läuft über Zeilengrenzen: Eine Note (Ps 118,1) ist mehrzeilig
  // gesetzt, und ein zeilenorientierter Ausdruck fände nur 1219 der 1220.
  for (const m of xml.matchAll(/<note\b[^>]*\bstyle="f"[^>]*>([\s\S]*?)<\/note>/g)) {
    const body = m[1] ?? "";
    const fr = /<char\b[^>]*\bstyle="fr"[^>]*>([\s\S]*?)<\/char>/.exec(body);
    const stelle = stripMarkup(fr?.[1] ?? "");
    const treffer = /^(\d+),(\d+)$/.exec(stelle);
    if (!treffer) {
      throw new Error(`Fußnote ohne brauchbare Stellenangabe: "${stelle}" in book_id ${bookId}`);
    }
    const chapter = Number(treffer[1]);
    const verse = Number(treffer[2]);
    // Die Stellenangabe selbst gehört nicht in den Notentext, sie steht als
    // eigenes Feld daneben.
    const text = stripMarkup(body.replace(/<char\b[^>]*\bstyle="fr"[^>]*>[\s\S]*?<\/char>/, ""));
    if (text === "") {
      throw new Error(`Leerer Fußnotentext bei ${bookId} ${chapter},${verse}`);
    }
    const key = `${chapter}:${verse}`;
    const seq = (notesPerVerse.get(key) ?? 0) + 1;
    notesPerVerse.set(key, seq);
    notes.push({ book: bookId, chapter, verse, seq, ref: stelle, text });
  }

  // Beide Notenarten aus dem Strom nehmen, bevor Verstext gesammelt wird: Sie
  // stehen mitten im Vers, und ihr Inhalt ist Apparat, nicht Wortlaut. Die
  // Querverweisnoten (43 971 Stück) werden gar nicht übernommen, der Server
  // führt seine Verweise aus OpenBible.info.
  const ohneNoten = xml.replace(/<note\b[^>]*>[\s\S]*?<\/note>/g, "");

  // Abschnittsüberschriften und Sprecherangaben entfernen, samt ihrem
  // öffnenden Tag; der Leerraum davor und dahinter bleibt als Worttrenner stehen.
  const bereinigt = ohneNoten.replace(
    /<para\b[^>]*\bstyle="([a-z0-9]+)"[^>]*>([\s\S]*?)<\/para>/g,
    (ganzes, stil: string) => (SKIP_PARA_STYLES.has(stil) ? " " : ganzes)
  );

  let offen: { chapter: number; verse: number; from: number } | null = null;
  for (const m of bereinigt.matchAll(/<verse\b[^>]*\/>/g)) {
    const tag = m[0];
    const sid = /\bsid="[A-Z0-9]+ (\d+):(\d+)"/.exec(tag);
    const eid = /\beid="[A-Z0-9]+ (\d+):(\d+)"/.exec(tag);
    if (sid) {
      offen = {
        chapter: Number(sid[1]),
        verse: Number(sid[2]),
        from: m.index + tag.length,
      };
    } else if (eid && offen) {
      verses.push({
        book: bookId,
        chapter: offen.chapter,
        verse: offen.verse,
        text: stripMarkup(bereinigt.slice(offen.from, m.index)),
      });
      offen = null;
    }
  }

  return { verses, notes };
}

/**
 * Liest `versification.vrs` der Lieferung: je Buch die Sollverszahl jedes
 * Kapitels. Die Gegenprobe kostet nichts und findet genau den Fehler, den die
 * Gesamtsumme nicht findet, nämlich einen Vers, der im falschen Kapitel landet.
 */
function readVersification(dir: string): Map<string, number> | null {
  let raw: string;
  try {
    raw = readFileSync(resolve(dir, "versification.vrs"), "utf8");
  } catch {
    return null;
  }
  const soll = new Map<string, number>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    // Zeilen der Form "GEN 1:31 2:25 3:24 …"; alles andere (Zuordnungen mit '='
    // und Steuerzeilen) übergehen.
    const m = /^([A-Z0-9]{3})((?:\s+\d+:\d+)+)$/.exec(trimmed);
    if (!m) continue;
    const bookId = BOOKS[m[1]!];
    if (!bookId) continue;
    for (const paar of m[2]!.trim().split(/\s+/)) {
      const [ch, count] = paar.split(":");
      soll.set(`${bookId}:${Number(ch)}`, Number(count));
    }
  }
  return soll.size > 0 ? soll : null;
}

export async function main(): Promise<void> {
  const arg = process.argv[2]?.trim();
  if (arg === "--entfernen") {
    entfernen();
    return;
  }
  const dir = arg && arg !== "" ? resolve(arg) : DEFAULT_DIR;

  console.log("=== Schlachter 2000 (USX 3.0) import ===");
  console.log(`Database: ${DB_PATH}`);
  console.log(`Source:   ${dir}`);

  let dateien: string[];
  try {
    dateien = readdirSync(dir).filter((f) => f.endsWith(".usx")).sort();
  } catch {
    throw new Error(
      `Verzeichnis nicht lesbar: ${dir}\n` +
        `Die Quelldateien sind nicht frei lizenziert und im Repository nicht enthalten.`
    );
  }
  if (dateien.length !== EXPECTED_FILES) {
    throw new Error(`${dateien.length} USX-Dateien gefunden, erwartet: ${EXPECTED_FILES}`);
  }

  const digest = createSourceDigest(
    "Digital Bible Library, USX 3.0 (SCHL2000), Lieferung der Genfer Bibelgesellschaft"
  );
  const alleVerse: VerseRow[] = [];
  const alleNoten: NoteRow[] = [];

  for (const datei of dateien) {
    const code = datei.replace(/\.usx$/, "");
    const bookId = BOOKS[code];
    if (!bookId) {
      throw new Error(`Unbekannter USFM-Buchcode "${code}" in ${datei}`);
    }
    const xml = readFileSync(resolve(dir, datei), "utf8");
    digest.add(xml);
    const { verses, notes } = parseUsx(xml, bookId);
    alleVerse.push(...verses);
    alleNoten.push(...notes);
  }

  console.log(`  ${alleVerse.length} verses, ${alleNoten.length} footnotes parsed`);

  // Plausibilität vor dem Schreiben: lieber gar nicht importieren als halb.
  if (alleVerse.length !== EXPECTED_VERSES) {
    throw new Error(`${alleVerse.length} Verse gelesen, erwartet: ${EXPECTED_VERSES}`);
  }
  if (alleNoten.length !== EXPECTED_NOTES) {
    throw new Error(`${alleNoten.length} Fußnoten gelesen, erwartet: ${EXPECTED_NOTES}`);
  }
  const leer = alleVerse.filter((v) => v.text === "");
  if (leer.length > 0) {
    throw new Error(
      `${leer.length} leere Verse, zuerst ${leer[0]!.book} ${leer[0]!.chapter},${leer[0]!.verse}`
    );
  }

  const soll = readVersification(dir);
  if (soll === null) {
    console.log("  versification.vrs nicht lesbar, Gegenprobe übersprungen");
  } else {
    const ist = new Map<string, number>();
    for (const v of alleVerse) {
      const key = `${v.book}:${v.chapter}`;
      ist.set(key, Math.max(ist.get(key) ?? 0, v.verse));
    }
    const abweichungen: string[] = [];
    for (const [key, count] of ist) {
      const erwartet = soll.get(key);
      if (erwartet !== undefined && erwartet !== count) {
        abweichungen.push(`${key} hat ${count}, versification.vrs sagt ${erwartet}`);
      }
    }
    if (abweichungen.length > 0) {
      throw new Error(
        `Versifikation weicht in ${abweichungen.length} Kapiteln ab: ${abweichungen.slice(0, 5).join("; ")}`
      );
    }
    console.log(`  versification.vrs: ${soll.size} Kapitel geprüft, keine Abweichung`);
  }

  // Die Verse müssen auf bekannte Bücher zeigen, sonst hängt `verses` an einem
  // Fremdschlüssel ins Leere.
  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
    ensureVersesSchema(db);
    ensureVerseNotesSchema(db);

    db.run("DELETE FROM verses WHERE translation = ?", [TRANSLATION]);
    db.run("DELETE FROM verse_notes WHERE translation = ?", [TRANSLATION]);

    const insertVerse = db.prepare(
      "INSERT INTO verses (translation, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)"
    );
    const insertNote = db.prepare(
      "INSERT INTO verse_notes (translation, book_id, chapter, verse, seq, ref, text) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    db.transaction(() => {
      for (const v of alleVerse) {
        insertVerse.run(TRANSLATION, v.book, v.chapter, v.verse, v.text);
      }
      for (const n of alleNoten) {
        insertNote.run(TRANSLATION, n.book, n.chapter, n.verse, n.seq, n.ref, n.text);
      }
    })();

    const verseCount = (
      db.query("SELECT COUNT(*) AS n FROM verses WHERE translation = ?").get(TRANSLATION) as {
        n: number;
      }
    ).n;
    const noteCount = (
      db.query("SELECT COUNT(*) AS n FROM verse_notes WHERE translation = ?").get(TRANSLATION) as {
        n: number;
      }
    ).n;
    if (verseCount !== EXPECTED_VERSES || noteCount !== EXPECTED_NOTES) {
      throw new Error(`Nach dem Schreiben: ${verseCount} Verse, ${noteCount} Noten`);
    }

    console.log("Rebuilding full-text index…");
    rebuildVersesFts(db);

    writeProvenance(db, "import-schlachter2000.ts", [digest]);
    commit();
  } catch (err) {
    abort();
    throw err;
  }

  const sizeMB = (statSync(DB_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`\nDone! ${EXPECTED_VERSES} verses and ${EXPECTED_NOTES} footnotes stored.`);
  console.log(`Database size now: ${sizeMB} MB`);
}

/** Entfernt beide Datensätze wieder und baut den Volltextindex neu. */
function entfernen(): void {
  console.log("=== Schlachter 2000: Datensätze entfernen ===");
  console.log(`Database: ${DB_PATH}`);
  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
    const verses = db.run("DELETE FROM verses WHERE translation = ?", [TRANSLATION]).changes;
    // Die Tabelle kann fehlen, wenn nie importiert wurde.
    const hatNotes =
      db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='verse_notes'")
        .get() !== null;
    const notes = hatNotes
      ? db.run("DELETE FROM verse_notes WHERE translation = ?", [TRANSLATION]).changes
      : 0;
    db.run("DELETE FROM provenance WHERE script = ?", ["import-schlachter2000.ts"]);
    rebuildVersesFts(db);
    commit();
    console.log(`Done! ${verses} verses and ${notes} footnotes removed.`);
  } catch (err) {
    abort();
    throw err;
  }
}

// Nur bei direktem Aufruf ausführen; setup.ts importiert dieses Skript
// absichtlich nicht.
if (import.meta.main) {
  main().catch((error) => {
    console.error("Import failed:", error);
    process.exit(1);
  });
}
