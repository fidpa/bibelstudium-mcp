/**
 * Das Werkzeug `bible_original`: ein Vers Wort für Wort, mit Grundform,
 * aufgelöster Morphologie und Strong-Nummer.
 *
 * Diese Datei prüft die Argumente und gibt weiter; das Editionsrouting nach
 * Testament, das Nachschlagen und der Bau der Wortliste liegen in
 * `originalPayload`, weil die Ressource `bible://grundtext/…` dieselbe Nutzlast
 * liefert und über einen zweiten Weg nicht auseinanderlaufen darf.
 */

import {
  MAX_CHAPTER,
  MAX_VERSE,
  bookNotFound,
  chapterOutOfRange,
  errorResult,
  jsonResult,
  originalPayload,
  requireBookName,
  resolveBook,
  toInt,
  verseOutOfRange,
} from "../werkzeug-helfer.ts";

/**
 * Bedient das Werkzeug `bible_original`: liefert einen NT-Vers Wort für Wort mit
 * Lemma und aufgelöster Morphologie aus den SBLGNT/MorphGNT-Daten.
 */
export function handleOriginal(args: {
  book?: unknown;
  chapter?: unknown;
  verse?: unknown;
  texttyp?: unknown;
}) {
  const geprueft = requireBookName(
    args.book,
    "Error: 'book' is required (e.g. '1. Mose', 'Jesaja', 'Römer')."
  );
  if ("error" in geprueft) {
    return errorResult(geprueft.error);
  }
  const { book } = geprueft;

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
