/**
 * Was mehr als ein Werkzeug braucht, bevor es antworten kann.
 *
 * Vier Dinge, in dieser Reihenfolge: die drei Formen, in denen dieser Server
 * ein Ergebnis abgibt (Erfolg, Werkzeugfehler, JSON-RPC-Fehler), die
 * nachsichtige Argumentwandlung; die Auflösung eines deutschen Buchnamens samt
 * allen Grenzen der Stellenangabe und den Meldungen, die sie nennen; das Holen
 * der Verse und die Versnutzlast; das Editionsrouting des Grundtextes und die
 * Wortnutzlast.
 *
 * Der Zuschnitt folgt den Aufrufern, nicht dem Thema: Jeder der sechs
 * Werkzeug-Handler braucht aus beiden Hälften etwas, und die Hälften hängen
 * selbst aneinander (die Meldung „Buch nicht gefunden" wird über die
 * Fehlerform gebaut, die Versnutzlast über die Textbereinigung). Zwei Dateien
 * ergäben deshalb zwei Importe je Handler und ersparten keinem einen. Gegliedert
 * wird stattdessen über die vier Banner unten.
 *
 * Bedient werden nicht nur die Werkzeuge: Die Fehlerform `rpcError` gehört den
 * Prompts und den Ressourcen, die kein `isError` haben und deshalb werfen
 * müssen, und die beiden Nutzlasten liefern Werkzeug und Ressource wortgleich.
 * Genau das ist ihr Zweck; eine zweite Formulierung liefe weg.
 *
 * Die Importe gehen in eine Richtung: Diese Datei kennt die Datenschicht, die
 * Editionen und die Übersetzungen, aber nichts aus server.ts. Ein Rückimport
 * von dort wäre der Beweis, dass der Schnitt falsch liegt.
 */

import type { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  availableEditions,
  availableTranslations,
  db,
  stmtAlias,
  stmtBookByName,
  stmtBookName,
  stmtOriginal,
  stmtVerse,
  stmtVerseNotes,
  stmtVerseRange,
  stmtVerses,
} from "./db.ts";
import {
  EDITION_META,
  NT_EDITIONS,
  quellen,
  resolveEdition,
  translationQuelle,
} from "./editions.ts";
import { TRANSLATIONS, resolveTranslation, type TranslationCode } from "./translations.ts";
import { decodeHebrew, decodeParse, decodeRobinson, posLabel } from "./morphology.ts";
import {
  gekuerztFeld,
  noteMaxHinweis,
  verseBudget,
  verseMaxHinweis,
} from "./verse-budget.ts";

// --- Generische Helfer: Werkzeugergebnisse, Text, Argumentwandlung ---------
export function errorResult(msg: string) {
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
export function jsonResult(response: Record<string, unknown>) {
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
export function rpcError(code: ErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Entfernt übrig gebliebene HTML-Auszeichnungen. Vorsorge, kein laufendes
 * Geschäft: `download.ts` entfernt sie bereits beim Einfügen, und `verses`
 * enthält in keiner der geführten Übersetzungen überhaupt ein "<" (gemessen
 * 26.07.2026 an vieren, 05.08.2026 an Schlachter 2000, dort auch keine
 * XML-Entities). Ebenso bei unsichtbaren Zeichen: kein weiches Trennzeichen
 * (U+00AD), kein NBSP, kein ZWSP in irgendeiner Zeile. Deshalb wird hier sonst
 * nichts entfernt; was künftig entfernt würde, muss mit `rebuildVersesFts`
 * Schritt halten, sonst laufen Suchausgabe und Zitat auseinander.
 */
export function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

// Wörter in eckigen Klammern gehören zum Wortlaut der Ausgabe und sind nichts,
// was dieser Server ergänzt hätte: Menge setzt erklärende Einschübe so (137
// Verse), Schlachter 2000 ebenfalls (1925 Verse, gemessen 05.08.2026); Luther,
// Schlachter 1951 und Elberfelder verwenden keine, und keine der geführten
// Ausgaben trägt Fußnotenziffern im Verstext, es gibt hier also kein
// numerisches Gegenstück zu unterscheiden. Der Apparat der Schlachter 2000 ist
// ein eigenes Feld (`fussnoten`) und steht nicht im Text.
// Gemessen im Ursprungs-Repo am 25.07.2026: Nach einem Vers mit
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
export function bracketHints(texts: readonly string[]): string[] {
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
export function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return null;
}

// --- Buchauflösung und „nicht gefunden"-Meldungen (alle Werkzeuge) ---------
export function resolveBook(book: string): number | null {
  const normalized = book.trim().toLowerCase();

  // Zuerst den genauen Alias versuchen
  const aliasResult = stmtAlias.get(normalized);
  if (aliasResult) return aliasResult.book_id;

  // Dann unscharf über die vollen Buchnamen (LIKE '%suche%')
  const nameResult = stmtBookByName.get(`%${escapeLike(normalized)}%`);
  if (nameResult) return nameResult.book_id;

  return null;
}

export function getBookDisplayName(bookId: number): string {
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
export function bookNotFoundMessage(book: string): string {
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

export function bookNotFound(book: string): ReturnType<typeof errorResult> {
  return errorResult(bookNotFoundMessage(book));
}

// Grenzen der Stellenangabe. Gemeinsam gehalten, damit die Grenze und die
// Meldung, die sie nennt, nicht auseinanderlaufen können: Drei Handler wiesen
// `verse=999` mit "must be a positive integer" zurück, einer Bedingung, die die
// Eingabe erfüllt (25.07.2026).
export const MAX_CHAPTER = 150; // Die Psalmen haben die meisten Kapitel (150)
export const MAX_VERSE = 200; // Das längste Kapitel (Psalm 119) hat 176 Verse
export const MAX_VERSE_PARTS = 30; // kommagetrennte Segmente in `verses`
export const MAX_BOOK_LENGTH = 50; // der längste deutsche Buchname hat rund 20 Zeichen
export const MAX_LEMMA_LENGTH = 50; // eigenes Feld, eigene Grenze, nicht die des Buchnamens

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
export const MAX_VERSES_LENGTH =
  MAX_VERSE_PARTS * MAX_VERSE_PART_LENGTH + (MAX_VERSE_PARTS - 1);

export const chapterOutOfRange = `Error: 'chapter' must be an integer between 1 and ${MAX_CHAPTER}`;
export const verseOutOfRange = `Error: 'verse' must be an integer between 1 and ${MAX_VERSE}`;
export const bookTooLong = `Error: 'book' must be at most ${MAX_BOOK_LENGTH} characters (e.g. 'Jesaja', '1. Mose', 'Römer')`;
// Eine Meldung je Bedingung. Eine einzige Sammelmeldung nannte die Form von
// `verses`, und die Form war genau in dem Fall in Ordnung, der an die Grenze
// stieß.
export const versesNotAString = `Error: 'verses' must be a string like "4", "16-17" or "1-3,7"`;
export const versesTooLong = `Error: 'verses' must be at most ${MAX_VERSES_LENGTH} characters`;
export const versesTooManyParts = `Error: 'verses' must list at most ${MAX_VERSE_PARTS} comma-separated segments`;
export const versesOutOfBounds = `Error: every verse number in 'verses' must be between 1 and ${MAX_VERSE}`;

// --- Verse holen, Stellenangaben formen, Versnutzlast bauen ----------------
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
 *
 * Beide Meldungen nennen ausschließlich **geladene** Ausgaben. Die Registry
 * kennt auch solche, deren Quelldateien nur beim Betreiber liegen
 * (`quelle: "lokal"`); wer sie hier aufzählte, böte an einem authlosen Endpunkt
 * einen Wert an, den dieser Server nicht liefern kann, und nennte die Ausgabe
 * obendrein dort, wo sie nichts zu suchen hat.
 *
 * Der Reparaturhinweis hängt aus demselben Grund an `quelle`: „bun run download"
 * ist ein Weg für eine Ausgabe von bolls.life und für keine andere. Eine
 * Aufforderung, die der Aufrufer nicht befolgen kann, ist keine Hilfe, sondern
 * eine Einladung zur Wiederholung (Hausregel „Fehlermeldungen brauchen einen
 * Ausweg", und im HTTP-Modus sitzt am anderen Ende nicht der Betreiber).
 */
export function requireTranslation(input: unknown): { code: TranslationCode } | { error: string } {
  const geladen = (Object.keys(TRANSLATIONS) as TranslationCode[]).filter((c) =>
    availableTranslations.has(c)
  );
  const code = resolveTranslation(input);
  if (code === null) {
    return {
      error:
        `Error: Unknown translation "${String(input)}". Allowed: ` +
        (geladen.map((c) => `"${c}" (${TRANSLATIONS[c].name})`).join(", ") || "none loaded") +
        ".",
    };
  }
  if (!availableTranslations.has(code)) {
    const ausweg =
      TRANSLATIONS[code].quelle === "bolls"
        ? `Bitte 'bun run download ${code}' ausführen. `
        : `Ihre Quelldateien werden nicht mitgeliefert, das lässt sich hier nicht nachholen. `;
    return {
      error:
        `Übersetzung "${code}" ist auf diesem Server nicht geladen. ` +
        ausweg +
        `Geladen: ${geladen.join(", ") || "keine"}.`,
    };
  }
  return { code };
}

/**
 * Die Fußnoten der Ausgabe zu den gelieferten Versen, in Quellreihenfolge.
 *
 * Das Feld heißt `fussnoten` und nicht `hinweis`, weil die beiden verschiedene
 * Sprecher haben: `hinweis` sagt der Server, eine Fußnote sagt die Ausgabe. Sie
 * trägt deshalb die Stellenangabe mit, die im Druck bei ihr steht (`stelle`,
 * etwa „3,16"), statt dass der Server sie neu formulierte.
 *
 * Nur eine der geführten Ausgaben hat einen Apparat, und sie hat ihn an 1134
 * ihrer 31 171 Verse (rund 3,6 %). Das Feld fehlt also im Regelfall, und genau
 * deshalb steht es nicht in `required`.
 */
function verseNotes(
  code: TranslationCode,
  bookId: number,
  chapter: number,
  verses: ReadonlySet<number>
): Array<{ vers: number; stelle: string; text: string }> {
  if (stmtVerseNotes === null) return [];
  return stmtVerseNotes
    .all(code, bookId, chapter)
    .filter((r) => verses.has(r.verse))
    .map((r) => ({ vers: r.verse, stelle: r.ref, text: r.text }));
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
export function lookupPayload(
  code: TranslationCode,
  bookId: number,
  chapter: number,
  versesStr: string,
  form: "text" | "verse_einzeln"
): Record<string, unknown> | null {
  const results = lookupVerses(code, bookId, chapter, versesStr);
  if (results.length === 0) return null;

  // Gekürzt wird hier, vor allem, was aus dem Versbestand abgeleitet wird: So
  // ziehen `reference`, der Klammerhinweis und die Fußnoten von selbst nach,
  // statt dass drei Stellen die Grenze noch einmal kennen müssten. Die Verse
  // liegen aufsteigend (alle drei Statements sortieren so), „die ersten" sind
  // also die niedrigsten Versnummern.
  const budget = verseBudget(code);
  const gefunden = results.map((r) => ({ verse: r.verse, text: stripHtml(r.text) }));
  const verse_einzeln = gefunden.slice(0, budget.nimm(gefunden.length));
  const reference =
    `${getBookDisplayName(bookId)} ${chapter},` +
    formatVerseReference(verse_einzeln.map((r) => r.verse));
  // Die Noten folgen dem gelieferten Versbestand, weil sie aus ihm abgeleitet
  // werden: Zu einem Vers, den die Antwort nicht enthält, kann keine Note
  // erscheinen. Darüber hinaus bekommen sie ein **eigenes** Budget derselben
  // Größe. Ob Notentext als Wortlaut im Sinn der Zusage zählt, ist nicht
  // entschieden; dieses zweite Budget beantwortet die Frage nicht, sondern
  // stellt sicher, dass der Apparat die Grenze auch dann nicht überschreiten
  // kann, wenn sie später bejaht wird.
  //
  // Es greift beim heutigen Bestand nie: Ein Kapitel führt höchstens 15 Noten,
  // innerhalb der ersten 20 Verse höchstens 12, je Vers höchstens 3 (gemessen
  // 05.08.2026 über 1220 Noten). Wie `MAX_VERSES_LENGTH` ist das Vorsorge und
  // keine laufende Regel, und wie dort gibt es aus demselben Grund keinen
  // Testfall dafür: Er ließe sich mit diesen Daten nicht herstellen. Käme eine
  // Ausgabe mit dichterem Apparat dazu, meldet die Kürzung sich selbst.
  const notenBudget = verseBudget(code);
  const alleNoten = verseNotes(code, bookId, chapter, new Set(verse_einzeln.map((r) => r.verse)));
  const fussnoten = alleNoten.slice(0, notenBudget.nimm(alleNoten.length));
  const hinweise = [
    verseMaxHinweis(budget, { art: "verse", gefunden: gefunden.length }),
    noteMaxHinweis(notenBudget),
    ...bracketHints(verse_einzeln.map((r) => r.text)),
  ].filter((h): h is string => h !== null);

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
    ...(fussnoten.length > 0 ? { fussnoten } : {}),
    ...gekuerztFeld(budget, notenBudget),
    quellen: quellen(translationQuelle(code)),
  };
}

// --- Grundtext: Editionsrouting und Wortnutzlast ---------------------------
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
export function originalPayload(
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

