/**
 * Das Werkzeug `bible_crossrefs`: die Querverweise zu einem Vers, nach den
 * Bewertungen von OpenBible.info geordnet, mit dem deutschen Zieltext.
 *
 * Ein mehrversiges Ziel wird zweimal getragen, als zusammengesetztes `text` und
 * zusätzlich je Vers in `verse_einzeln`. Das ist kein Versehen: Die
 * zusammengesetzte Zeichenkette wurde beim Zitieren schon an beiden Enden
 * abgeschnitten, weil die eingeflochtenen Versnummern wie Fließtext aussehen.
 */

import { stmtVerse, stmtVerseRange, stmtXrefs } from "../db.ts";
import { DATASET_QUELLEN, quellen, translationQuelle } from "../editions.ts";
import { gekuerztFeld, verseBudget, verseMaxHinweis } from "../verse-budget.ts";
import {
  MAX_BOOK_LENGTH,
  MAX_CHAPTER,
  MAX_VERSE,
  bookNotFound,
  bookTooLong,
  bracketHints,
  chapterOutOfRange,
  errorResult,
  getBookDisplayName,
  jsonResult,
  requireTranslation,
  resolveBook,
  stripHtml,
  toInt,
  verseOutOfRange,
} from "../werkzeug-helfer.ts";

/**
 * Bedient das Werkzeug `bible_crossrefs`: liefert die Querverweise zu einem
 * Vers, nach den Bewertungen von OpenBible.info geordnet, mit dem deutschen
 * Zieltext, soweit die Wortlaut-Grenze der Ausgabe ihn zulässt.
 */
export function handleCrossrefs(args: {
  book?: unknown;
  chapter?: unknown;
  verse?: unknown;
  limit?: unknown;
  translation?: unknown;
}) {
  if (!stmtXrefs) {
    return errorResult(
      "Querverweis-Daten nicht geladen. Bitte 'bun run download:crossrefs' ausführen."
    );
  }
  const resolved = requireTranslation(args.translation);
  if ("error" in resolved) {
    return errorResult(resolved.error);
  }
  const translation = resolved.code;

  const { book } = args;
  if (!book || typeof book !== "string") {
    return errorResult("Error: 'book' is required (e.g. '1. Mose', 'Jesaja', 'Römer').");
  }
  if (book.length > MAX_BOOK_LENGTH) {
    return errorResult(bookTooLong);
  }
  const chapter = toInt(args.chapter);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    return errorResult(chapterOutOfRange);
  }
  const verse = toInt(args.verse);
  if (verse === null || verse < 1 || verse > MAX_VERSE) {
    return errorResult(verseOutOfRange);
  }
  const limit = Math.min(Math.max(toInt(args.limit) ?? 10, 1), 30);
  const budget = verseBudget(translation);

  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }

  const rows = stmtXrefs.all(bookId, chapter, verse, limit);
  if (rows.length === 0) {
    return errorResult(
      `Keine Querverweise für ${getBookDisplayName(bookId)} ${chapter},${verse} gefunden.`
    );
  }

  const verweise = rows.map((r) => {
    const bookName = getBookDisplayName(r.to_book);
    const sameChapter = r.to_chapter === r.to_chapter_end;
    const stelle = sameChapter
      ? r.to_verse === r.to_verse_end
        ? `${bookName} ${r.to_chapter},${r.to_verse}`
        : `${bookName} ${r.to_chapter},${r.to_verse}-${r.to_verse_end}`
      : `${bookName} ${r.to_chapter},${r.to_verse} – ${r.to_chapter_end},${r.to_verse_end}`;

    // Text: die volle Spanne innerhalb eines Kapitels (gedeckelt bei vier
    // Versen), sonst allein der erste Vers, denn Ziele über Kapitelgrenzen hinweg
    // sind selten und meist lang. Mehrversige Spannen gehen zusätzlich als
    // `verse_einzeln` hinaus: Die zusammengefügte Form flicht die Versnummern in
    // die Zeichenkette, überlässt das Zerlegen also den Konsumenten, und die
    // schneiden dabei die äußeren Ränder weg (beobachtet am 25.07.2026,
    // Joh 11,25-26 zitiert ohne „Jesus spricht zu ihr:" und ohne die
    // abschließende Frage).
    //
    // Die Wortlaut-Grenze wird hier je Verweis genommen, nicht je Vers
    // (`nimmGanz`), und beide Textfelder werden aus derselben bewilligten Liste
    // gebaut, damit ein Vers einmal zählt, obwohl er zweimal hinausgeht. Eine
    // Grenze auf Versebene schnitte in gemessen 3335 von 29 364 möglichen
    // Abrufen mitten in eine Spanne: `stelle` nennte weiter den ganzen
    // Abschnitt, `verse_einzeln` trüge einen Teil davon, und die Ellipse unten
    // greift nur bei `span > CAP`, sagte es also nicht. Wer ein drittes
    // verstragendes Feld ergänzt, leitet es ebenfalls aus dieser Liste ab.
    // Verbraucht wird in `votes`-Reihenfolge (das Statement sortiert so): Die
    // bestbewerteten Verweise behalten ihren Text.
    let text: string | null = null;
    let einzeln: Array<{ nr: number; text: string }> | null = null;
    if (sameChapter) {
      const span = r.to_verse_end - r.to_verse + 1;
      const CAP = 4;
      const verses = stmtVerseRange.all(
        translation, r.to_book, r.to_chapter, r.to_verse, Math.min(r.to_verse_end, r.to_verse + CAP - 1)
      );
      // Findet sich kein Vers, fehlt das Feld, statt leer dazustehen. Ein leerer
      // String war nie eine Aussage: Er sagte weder, dass es den Vers in dieser
      // Übersetzung nicht gibt, noch sonst etwas, und seit die Grenze dasselbe
      // Feld weglassen kann, stünden zwei Bedeutungen nebeneinander.
      if (verses.length > 0 && budget.nimmGanz(verses.length)) {
        text = verses
          .map((v) => (span > 1 ? `${v.verse} ${stripHtml(v.text)}` : stripHtml(v.text)))
          .join(" ");
        if (span > CAP) text += ` … [bis V. ${r.to_verse_end}]`;
        if (span > 1) einzeln = verses.map((v) => ({ nr: v.verse, text: stripHtml(v.text) }));
      }
    } else {
      // Erst holen, dann bewilligen: Umgekehrt verbrauchte ein Ziel ohne
      // gefundenen Vers Budget, das kein Wortlaut aufbraucht.
      const v = stmtVerse.get(translation, r.to_book, r.to_chapter, r.to_verse);
      if (v && budget.nimmGanz(1)) {
        text = `${stripHtml(v.text)} … [Abschnitt bis ${r.to_chapter_end},${r.to_verse_end}]`;
      }
    }
    return {
      stelle,
      votes: r.votes,
      ...(text !== null ? { text } : {}),
      ...(einzeln !== null ? { verse_einzeln: einzeln } : {}),
    };
  });

  // Nur der Text, der wirklich hinausgeht: Sonst warnte die Antwort vor
  // Klammern in Versen, die sie nicht geliefert hat.
  const texte = verweise.flatMap((v) => (typeof v.text === "string" ? [v.text] : []));
  const hinweise = [
    verseMaxHinweis(budget, {
      art: "verweise",
      mitText: texte.length,
      gesamt: verweise.length,
    }),
    ...bracketHints(texte),
  ].filter((h): h is string => h !== null);
  const response = {
    reference: `${getBookDisplayName(bookId)} ${chapter},${verse}`,
    verweise,
    ...(verweise.some((v) => "verse_einzeln" in v)
      ? {
          lesehinweis:
            "Mehrversige Verweise tragen zusätzlich 'verse_einzeln' (ein Eintrag je Vers, " +
            "ohne eingebettete Versnummern). Beim Zitieren daraus die Verse vollständig " +
            "übernehmen, nicht Anfang oder Ende des Abschnitts weglassen.",
        }
      : {}),
    ...(hinweise.length > 0 ? { hinweis: hinweise.join(" ") } : {}),
    ...gekuerztFeld(budget),
    quellen: quellen(DATASET_QUELLEN.crossrefs, translationQuelle(translation)),
  };

  return jsonResult(response);
}
