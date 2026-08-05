/**
 * `bible_crossrefs`: Querverweise samt ihrer Zieltexte.
 *
 * Der tragende Fall ist ein mehrversiges Ziel. Es kam früher nur als ein String
 * mit eingebetteten Versnummern zurück, und wer daraus zitierte, schnitt Anfang
 * und Ende weg; deshalb liegt jeder Vers zusätzlich einzeln vor.
 *
 * Einzeln lauffähig: `bun run tests/golden/crossrefs.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, abschluss, type Json } from "../lib/zusicherungen.ts";
import {
  BUCH_KEINE_ZEICHENKETTE,
  BUCH_ZU_LANG,
  VERSE_AUSSERHALB,
} from "../lib/meldungen.ts";

const OVERLONG_NAME = "J".repeat(60);

export const crossrefsBuendel = buendel({
  name: "crossrefs",
  calls: {
    xrefVerse999: ["bible_crossrefs", { book: "Joh", chapter: 3, verse: 999 }],
    xrefJoh146: ["bible_crossrefs", { book: "Joh", chapter: 14, verse: 6, limit: 5 }],
    // Ein zu langer Buchname ist ein Längenproblem, kein fehlendes oder unbekanntes Feld
    xrefLongBook: ["bible_crossrefs", { book: OVERLONG_NAME, chapter: 1, verse: 1 }],
    // Ein falscher Typ ist wieder etwas anderes als ein fehlendes Feld
    xrefBuchZahl: ["bible_crossrefs", { book: 123, chapter: 1, verse: 1 }],
    // Die werkzeugeigene „is required"-Meldung war hier ungedeckt: Sie ist die
    // einzige Angabe, die `requireBookName` seit dem 06.08.2026 als Parameter
    // bekommt, und ein Einbau, der die eines anderen Werkzeugs setzte, blieb grün.
    xrefBuchFehlt: ["bible_crossrefs", { chapter: 1, verse: 1 }],
  },
  pruefe({ res }) {
    const { xrefVerse999, xrefJoh146, xrefLongBook, xrefBuchZahl, xrefBuchFehlt } = res;

    eq("bible_crossrefs verse: Text", xrefVerse999.text, VERSE_AUSSERHALB);
    eq("bible_crossrefs verse: isError", xrefVerse999.isError, true);
    // Nannte früher die falsche Bedingung: sagte 'book' is required, obwohl book
    // gesetzt war, nur zu lang (26.07.2026).
    eq("bible_crossrefs: langer Buchname", xrefLongBook.text, BUCH_ZU_LANG);
    eq("bible_crossrefs book=123: nennt den Typ", xrefBuchZahl.text, BUCH_KEINE_ZEICHENKETTE);
    eq(
      "bible_crossrefs book fehlt: eigene Meldung samt eigenen Beispielen",
      xrefBuchFehlt.text,
      "Error: 'book' is required (e.g. '1. Mose', 'Jesaja', 'Römer')."
    );

    const v = (xrefJoh146.json?.verweise ?? []) as Array<Json>;
    eq("Joh 14,6: fünf Verweise", v.length, 5);
    eq("Joh 14,6: stärkster Verweis", v[0]?.stelle, "Apostelgeschichte 4,12");
    const multi = v.find((x) => String(x.stelle).includes("11,25-26"));
    check("Joh 14,6: Joh 11,25-26 enthalten", multi !== undefined);
    const einzeln = (multi?.verse_einzeln ?? []) as Array<Json>;
    eq("Joh 11,25-26: zwei Einzelverse", einzeln.length, 2);
    eq("Joh 11,25-26: erste Versnummer", einzeln[0]?.nr, 25);
    has("Joh 14,6: lesehinweis gesetzt", String(xrefJoh146.json?.lesehinweis ?? ""), "vollständig übernehmen");
  },
});

if (import.meta.main) {
  await fahre([crossrefsBuendel]);
  abschluss();
}
