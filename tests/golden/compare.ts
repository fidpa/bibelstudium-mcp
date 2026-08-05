/**
 * `bible_compare`: derselbe Vers in mehreren Editionen, Wort gegen Wort.
 *
 * Zwei Fälle tragen dieses Bündel. Das Comma Johanneum, weil es der bekannteste
 * Textunterschied des Neuen Testaments ist und weil seine Wortzahl schon einmal
 * geschätzt statt gelesen wurde. Und Mk 14,46, weil dort die Bezeugungsnotiz dem
 * Editionstext widerspricht: In rund 11 Prozent der NT-Verse gehen beide
 * auseinander, und der Vorbehalt muss oben in der Antwort stehen, nicht tief in
 * einem Unterfeld.
 *
 * Einzeln lauffähig: `bun run tests/golden/compare.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, abschluss } from "../lib/zusicherungen.ts";
import { BUCH_KEINE_ZEICHENKETTE, VERSE_AUSSERHALB } from "../lib/meldungen.ts";

export const compareBuendel = buendel({
  name: "compare",
  calls: {
    cmpVerse999: ["bible_compare", { book: "1Joh", chapter: 5, verse: 999 }],
    comma: ["bible_compare", { book: "1Joh", chapter: 5, verse: 7 }],
    mk1446: ["bible_compare", { book: "Mk", chapter: 14, verse: 46 }],
    // Keine TAGNT-Zeile: neun NT-Verse haben keine, `bezeugung` fehlt dann zu Recht.
    cmpOhneBezeugung: ["bible_compare", { book: "Joh", chapter: 7, verse: 53 }],
    cmpBuchZahl: ["bible_compare", { book: 123, chapter: 1, verse: 1 }],
  },
  pruefe({ res }) {
    const { cmpVerse999, comma, mk1446, cmpOhneBezeugung, cmpBuchZahl } = res;

    eq("bible_compare verse: Text", cmpVerse999.text, VERSE_AUSSERHALB);
    eq("bible_compare verse: isError", cmpVerse999.isError, true);
    eq("bible_compare book=123: nennt den Typ", cmpBuchZahl.text, BUCH_KEINE_ZEICHENKETTE);

    const eds = (comma.json?.editionen ?? []) as Array<{ texttyp: string; text: string }>;
    const byType = new Map(eds.map((e) => [e.texttyp, e.text]));
    eq("1Joh 5,7 byzantine", byType.get("byzantine"), "οτι τρεις εισιν οι μαρτυρουντες");
    eq("1Joh 5,7 sblgnt", byType.get("sblgnt"), "ὅτι τρεῖς εἰσιν οἱ μαρτυροῦντες");
    has("1Joh 5,7 tr trägt das Comma", byType.get("tr") ?? "", "ο πατηρ ο λογος και το αγιον πνευμα");
    check("1Joh 5,7 ohne Quellenkonflikt", !("warnung" in (comma.json ?? {})));
    // Die Wortzahlen stehen da, damit niemand zählen muss: Das Comma wurde als 16
    // zusätzliche Wörter gemeldet, wo Vergleich und TAGNT-Bezeugung beide 17
    // sagen (25.07.2026).
    const woerter = new Map(
      ((comma.json?.editionen ?? []) as Array<{ texttyp: string; woerter: number }>).map((e) => [
        e.texttyp,
        e.woerter,
      ])
    );
    eq("1Joh 5,7: Wortzahl tr", woerter.get("tr"), 22);
    eq("1Joh 5,7: Wortzahl byzantine", woerter.get("byzantine"), 5);
    const diffs = ((comma.json?.vergleiche ?? []) as Array<{ unterschiede?: string[] }>).flatMap(
      (v) => v.unterschiede ?? []
    );
    check(
      "1Joh 5,7: Zusatz mit 17 Wörtern beziffert",
      diffs.some((d) => d.includes("(17 Wörter)"))
    );

    has("Mk 14,46: warnung oben", String(mk1446.json?.warnung ?? ""), "widerspricht die TAGNT-Bezeugung");
    const qk = (mk1446.json?.quellenkonflikte ?? []) as string[];
    eq("Mk 14,46: ein Quellenkonflikt", qk.length, 1);
    has("Mk 14,46: nennt Editionslesart zuerst", qk[0] ?? "", 'byzantine liest hier "ἐπέβαλον"');

    check("Joh 7,53: ohne bezeugung", !("bezeugung" in (cmpOhneBezeugung.json ?? {})));
    eq("Joh 7,53: kein Fehler", cmpOhneBezeugung.isError, false);
  },
});

if (import.meta.main) {
  await fahre([compareBuendel]);
  abschluss();
}
