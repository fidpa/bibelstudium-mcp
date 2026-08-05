/**
 * `bible_original`: der Grundtext, seine Morphologie und seine Grenzen.
 *
 * Geprüft wird an einem hebräischen Vers (OSHB-Codes samt Morphemtrenner) und
 * an einer griechischen Edition ohne Strong-Nummern. Die Morphologie ist der
 * Grund für den hebräischen Fall: Drei Schemata werden hier dekodiert, und ein
 * Nichtverb ist kein Sonderfall, sondern die Hälfte des Textes.
 *
 * Einzeln lauffähig: `bun run tests/golden/original.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, abschluss, type Json } from "../lib/zusicherungen.ts";
import {
  BUCH_KEINE_ZEICHENKETTE,
  KAPITEL_AUSSERHALB,
  VERSE_AUSSERHALB,
} from "../lib/meldungen.ts";

export const originalBuendel = buendel({
  name: "original",
  calls: {
    // Grenzen: Die Meldung muss die wirkliche Grenze nennen, nicht "positive integer"
    origVerse999: ["bible_original", { book: "Ps", chapter: 23, verse: 999 }],
    origChap999: ["bible_original", { book: "Ps", chapter: 999, verse: 1 }],
    origBuchZahl: ["bible_original", { book: 123, chapter: 1, verse: 1 }],
    ps231: ["bible_original", { book: "Psalm", chapter: 23, verse: 1 }],
    // Eine Edition ohne Strong-Nummern: das Feld fehlt dann, und das ist richtig.
    origSblgnt: ["bible_original", { book: "Joh", chapter: 3, verse: 16, texttyp: "sblgnt" }],
    // Ohne `texttyp` entscheidet das Buch. Für das NT war diese Vorgabe bis zum
    // 05.08.2026 von keiner Zusicherung gedeckt: Ein eingebauter Fehler, der sie
    // auf 'tr' umstellte, lieferte eine andere Textform und blieb grün.
    origNtVorgabe: ["bible_original", { book: "1Joh", chapter: 5, verse: 7 }],
  },
  pruefe({ res }) {
    const { origVerse999, origChap999, origBuchZahl, ps231, origSblgnt, origNtVorgabe } = res;

    eq("bible_original verse: Text", origVerse999.text, VERSE_AUSSERHALB);
    eq("bible_original verse: isError", origVerse999.isError, true);
    eq("bible_original chapter", origChap999.text, KAPITEL_AUSSERHALB);
    eq("bible_original book=123: nennt den Typ", origBuchZahl.text, BUCH_KEINE_ZEICHENKETTE);

    const w = (ps231.json?.woerter ?? []) as Array<Json>;
    eq("Ps 23,1: Wortzahl", w.length, 6);
    eq("Ps 23,1: texttyp", ps231.json?.texttyp, "wlc");
    eq("Ps 23,1: Morphemtrenner erhalten", w[3]?.wort, "רֹ֝עִ֗/י");
    eq("Ps 23,1: Strong", w[3]?.strong, "H7462");
    eq("Ps 23,1: Code", w[3]?.code, "HVqrmsc/Sp1cs");
    has("Ps 23,1: Morphologie aufgelöst", String(w[3]?.morphologie ?? ""), "Partizip aktiv maskulin Singular konstrukt");
    eq("Ps 23,1: Nichtverb dekodiert", w[4]?.morphologie, "Partikel (Negation)");

    // Jedes bedingte Feld fehlt aus einem gemessenen Grund, und jedes zerbräche
    // einen prüfenden Client, wäre es als required deklariert.
    const sblgnt = (origSblgnt.json?.woerter ?? []) as Array<Json>;
    check("Joh 3,16 (sblgnt): Wörter vorhanden", sblgnt.length > 0);
    check("Joh 3,16 (sblgnt): ohne Strong-Nummern", sblgnt.every((x) => !("strong" in x)));

    // Die AT-Vorgabe deckt `ps231` oben mit ab (kein `texttyp`, Antwort 'wlc').
    // Hier die NT-Vorgabe, und zwar am schärfsten möglichen Vers: 1Joh 5,7 ist
    // die eine Stelle, an der die drei NT-Editionen weit auseinandergehen. Der
    // Mehrheitstext liest fünf Wörter, der Textus Receptus trägt hier das Comma
    // Johanneum und ist um ein Vielfaches länger. Eine verrutschte Vorgabe
    // bricht deshalb beide Zusicherungen und nicht nur die erste.
    eq("1Joh 5,7 ohne texttyp: Vorgabe byzantine", origNtVorgabe.json?.texttyp, "byzantine");
    eq("1Joh 5,7 ohne texttyp: Wortzahl des Mehrheitstextes",
      ((origNtVorgabe.json?.woerter ?? []) as Array<Json>).length, 5);
  },
});

if (import.meta.main) {
  await fahre([originalBuendel]);
  abschluss();
}
