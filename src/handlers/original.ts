/**
 * Das Werkzeug `bible_original`: ein Vers oder bis zu zehn Verse eines Kapitels
 * Wort für Wort, mit Grundform, aufgelöster Morphologie und Strong-Nummer.
 *
 * Diese Datei prüft die Argumente und gibt weiter; das Editionsrouting nach
 * Testament, das Nachschlagen und der Bau der Wortliste liegen in
 * `originalPayload`, weil die Ressource `bible://grundtext/…` dieselbe Nutzlast
 * liefert und über einen zweiten Weg nicht auseinanderlaufen darf.
 */

import {
  MAX_CHAPTER,
  bookNotFound,
  chapterOutOfRange,
  MAX_ORIGINAL_VERSE,
  einzelVers,
  errorResult,
  jsonResult,
  originalBereichPayload,
  originalPayload,
  originalZuVieleVerse,
  parseVerses,
  pruefeVersliste,
  requireBookName,
  resolveBook,
  toInt,
} from "../werkzeug-helfer.ts";

/**
 * Bedient das Werkzeug `bible_original`.
 *
 * Zwei Wege zum Vers, und genau einer gilt: `verse` (eine Zahl) ist das
 * Argument, das es seit je gibt, und geht vor. Fehlt es, wird `verses` gelesen,
 * in der Schreibweise von `bible_lookup` („16", „16-18", „1,3,5"). Führt die
 * Angabe auf einen einzigen Vers, antwortet das Werkzeug wie immer; erst bei
 * mehreren trägt jedes Wort seinen `vers`. Die Grenze von zehn Versen wird nach
 * dem Auflösen der Spanne geprüft, an der Zahl der Verse und nicht an der Länge
 * der Angabe: „1-200" ist eine kurze Zeichenkette.
 */
export function handleOriginal(args: {
  book?: unknown;
  chapter?: unknown;
  verse?: unknown;
  verses?: unknown;
  texttyp?: unknown;
}) {
  const geprueft = requireBookName(
    args.book,
    "Error: 'book' is required (e.g. '1. Mose', 'Jesaja', 'Römer')."
  );
  if ("error" in geprueft) {
    return errorResult(geprueft.error, "eingabe");
  }
  const { book } = geprueft;

  const chapter = toInt(args.chapter);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    return errorResult(chapterOutOfRange, "eingabe");
  }
  const hatVerse = args.verse !== undefined && args.verse !== null;
  const hatVerses = args.verses !== undefined && args.verses !== null && args.verses !== "";
  let verse: number[];
  if (!hatVerse && hatVerses) {
    const versliste = pruefeVersliste(args.verses);
    if ("error" in versliste) {
      return errorResult(versliste.error, "eingabe");
    }
    verse = parseVerses(versliste.verses);
    if (verse.length > MAX_ORIGINAL_VERSE) {
      return errorResult(originalZuVieleVerse, "eingabe");
    }
  } else {
    // Fehlt beides, nennt die Meldung `verse`: das Argument, das genügt.
    const vers = einzelVers({ verse: args.verse });
    if ("error" in vers) {
      return errorResult(vers.error, "eingabe");
    }
    verse = [vers.verse];
  }

  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }

  const result =
    verse.length === 1
      ? originalPayload(book, bookId, chapter, verse[0]!, args.texttyp)
      : originalBereichPayload(book, bookId, chapter, verse, args.texttyp);
  if ("error" in result) {
    return errorResult(result.error, result.klasse);
  }

  return jsonResult(result.payload);
}
