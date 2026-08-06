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
import {
  BUCH_KEINE_ZEICHENKETTE,
  BUCH_ZU_LANG,
  KAPITEL_AUSSERHALB,
  VERSE_AUSSERHALB,
} from "../lib/meldungen.ts";

export const compareBuendel = buendel({
  name: "compare",
  calls: {
    cmpVerse999: ["bible_compare", { book: "1Joh", chapter: 5, verse: 999 }],
    comma: ["bible_compare", { book: "1Joh", chapter: 5, verse: 7 }],
    mk1446: ["bible_compare", { book: "Mk", chapter: 14, verse: 46 }],
    // Keine TAGNT-Zeile: neun NT-Verse haben keine, `bezeugung` fehlt dann zu Recht.
    cmpOhneBezeugung: ["bible_compare", { book: "Joh", chapter: 7, verse: 53 }],
    cmpBuchZahl: ["bible_compare", { book: 123, chapter: 1, verse: 1 }],
    // Seit dem 06.08.2026 liegen die drei Buchprüfungen in `requireBookName`.
    // Die eigene „is required"-Meldung dieses Werkzeugs nennt als einzige nur
    // neutestamentliche Beispiele, weil es alttestamentliche Bücher ohnehin
    // abweist; ungedeckt war sie hier bis dahin trotzdem.
    cmpBuchFehlt: ["bible_compare", { chapter: 1, verse: 1 }],
    cmpBuchZuLang: ["bible_compare", { book: "J".repeat(60), chapter: 1, verse: 1 }],
    // `0` ist ein gesetzter Wert vom falschen Typ, kein fehlendes Feld. Kein
    // Test fuhr bis dahin einen falsy Nicht-String, und `!book` hätte hier still
    // die andere Meldung geliefert (gemessen 06.08.2026).
    cmpBuchNull: ["bible_compare", { book: 0, chapter: 1, verse: 1 }],
    // Die fachliche Abweisung dieses Werkzeugs, und bis zum 06.08.2026 die
    // einzige ohne jeden Aufruf: Fürs AT gibt es nur eine Edition, ein Vergleich
    // hat dort nichts zu vergleichen. Sie trägt die Grenze `book_id < 40`, auf
    // der die gesamte AT/NT-Weiche des Servers beruht.
    cmpAltesTestament: ["bible_compare", { book: "Psalter", chapter: 23, verse: 1 }],
    // Kapitel jenseits der Grenze: als einziges der vier Stellen-Werkzeuge
    // prüfte `bible_compare` bisher nur `verse`, nicht `chapter`.
    cmpKapitel999: ["bible_compare", { book: "1Joh", chapter: 999, verse: 1 }],
  },
  pruefe({ res }) {
    const { cmpVerse999, comma, mk1446, cmpOhneBezeugung, cmpBuchZahl } = res;
    const { cmpBuchFehlt, cmpBuchZuLang, cmpBuchNull, cmpAltesTestament, cmpKapitel999 } = res;

    eq("bible_compare AT: abgewiesen", cmpAltesTestament.isError, true);
    // Zeichengleich, nicht als Teilstring: Der Satz nennt den Grund (eine
    // einzige Edition) und ist damit die Auskunft, die den Aufrufer davon
    // abhält, es mit einem anderen AT-Buch erneut zu versuchen.
    eq(
      "bible_compare AT: nennt den Grund",
      cmpAltesTestament.text,
      "Der Editionsvergleich gilt nur fürs NT; fürs AT gibt es nur eine Edition (hebräischer WLC)."
    );
    eq("bible_compare chapter: Text", cmpKapitel999.text, KAPITEL_AUSSERHALB);
    eq("bible_compare chapter: isError", cmpKapitel999.isError, true);

    eq("bible_compare verse: Text", cmpVerse999.text, VERSE_AUSSERHALB);
    eq("bible_compare verse: isError", cmpVerse999.isError, true);
    eq("bible_compare book=123: nennt den Typ", cmpBuchZahl.text, BUCH_KEINE_ZEICHENKETTE);
    eq("bible_compare book=0: nennt den Typ, nicht die Anwesenheit", cmpBuchNull.text, BUCH_KEINE_ZEICHENKETTE);
    eq(
      "bible_compare book fehlt: eigene Meldung, nur NT-Beispiele",
      cmpBuchFehlt.text,
      "Error: 'book' is required (e.g. 'Römer', '1Joh')."
    );
    eq("bible_compare: langer Buchname", cmpBuchZuLang.text, BUCH_ZU_LANG);

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
