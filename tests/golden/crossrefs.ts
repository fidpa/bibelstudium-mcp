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
import { check, eq, has, hint, lacks, abschluss, type Json } from "../lib/zusicherungen.ts";
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
    // Die beiden Abkürzungen langer Ziele. Ein Ziel über mehr als vier Verse
    // wird beschnitten, eines über eine Kapitelgrenze ebenfalls, und beide
    // hängen eine Ellipse samt Endangabe an. Genau diese Angabe liest ein
    // Konsument als Vollständigkeitssignal; bis zum 06.08.2026 war sie von
    // keiner Zusicherung berührt. 1. Mose 1,1 verweist auf Sprüche 8,22-30
    // (neun Verse), 1. Mose 11,31 auf 1. Mose 11,32 bis 12,1.
    xrefLangeSpanne: ["bible_crossrefs", { book: "1. Mose", chapter: 1, verse: 1, limit: 30 }],
    xrefUeberKapitel: ["bible_crossrefs", { book: "1. Mose", chapter: 11, verse: 31, limit: 30 }],
    // Der Klammerhinweis darf sich nicht an der eigenen Einfügung entzünden.
    // 1. Mose 25,21 verweist auf 1. Mose 15,2-3, und Menge setzt dort einen
    // Einschub in eckige Klammern: derselbe Aufruf muss in MB warnen und in LUT
    // schweigen, wo die Ausgabe nachweislich keinen einzigen Klammervers führt.
    xrefKlammerEcht: ["bible_crossrefs", { book: "1. Mose", chapter: 25, verse: 21, translation: "MB" }],
    xrefKlammerKeine: ["bible_crossrefs", { book: "1. Mose", chapter: 25, verse: 21, translation: "LUT" }],
    // Kein Verweis ist ein Ergebnis, keine Panne.
    xrefKeine: ["bible_crossrefs", { book: "1. Mose", chapter: 1, verse: 13 }],
    // `gesamt` und der Kürzungssatz. 1. Mose 1,1 führt 62 Verweise; bis zum
    // 06.08.2026 lieferte das Werkzeug 10 bzw. 30 davon und sagte es nirgends,
    // also stilles Kürzen in 13 548 von 29 364 möglichen Abrufen. Drei Fälle,
    // weil der Ausweg dreimal verschieden ist: unter dem Maximum hilft Erhöhen,
    // am Maximum hilft es nicht mehr, und ungekürzt darf kein Satz dastehen.
    xrefGesamtVorgabe: ["bible_crossrefs", { book: "1. Mose", chapter: 1, verse: 1 }],
    xrefGesamtMax: ["bible_crossrefs", { book: "1. Mose", chapter: 1, verse: 1, limit: 100 }],
    xrefGesamtVoll: ["bible_crossrefs", { book: "Psalm", chapter: 2, verse: 7, limit: 30 }],
  },
  pruefe({ res }) {
    const { xrefVerse999, xrefJoh146, xrefLongBook, xrefBuchZahl, xrefBuchFehlt } = res;
    const { xrefLangeSpanne, xrefUeberKapitel, xrefKeine } = res;
    const { xrefKlammerEcht, xrefKlammerKeine } = res;
    const { xrefGesamtVorgabe, xrefGesamtMax, xrefGesamtVoll } = res;

    // Die Zahl steht als Feld da, nicht nur im Fließtext: Was ein Konsument
    // ableiten muss, schätzt er (25.07.2026 über sechs Läufe gemessen).
    eq("1Mo 1,1 (Vorgabe): gesamt nennt alle 62", xrefGesamtVorgabe.json?.gesamt, 62);
    eq("1Mo 1,1 (Vorgabe): zehn geliefert", (xrefGesamtVorgabe.json?.verweise as unknown[] ?? []).length, 10);
    has("1Mo 1,1 (Vorgabe): Kürzung gemeldet", hint(xrefGesamtVorgabe.json), "Nur die 10 bestbewerteten von 62 Verweisen");
    has("1Mo 1,1 (Vorgabe): Erhöhen ist der Ausweg", hint(xrefGesamtVorgabe.json), "limit erhöhen");
    eq("1Mo 1,1 (limit=100): auf 30 geklemmt", (xrefGesamtMax.json?.verweise as unknown[] ?? []).length, 30);
    eq("1Mo 1,1 (limit=100): gesamt unverändert 62", xrefGesamtMax.json?.gesamt, 62);
    lacks("1Mo 1,1 (limit=100): fordert nicht zum Erhöhen auf", hint(xrefGesamtMax.json), "limit erhöhen");
    has("1Mo 1,1 (limit=100): nennt die Obergrenze", hint(xrefGesamtMax.json), "mehr als 30 gibt dieses Werkzeug");
    // Die Gegenprobe: Wo nichts abgeschnitten wurde, darf kein Kürzungssatz
    // stehen. Ohne sie bliebe ein Satz, der immer erscheint, unbemerkt.
    eq("Ps 2,7: gesamt gleich der Zahl der Verweise", xrefGesamtVoll.json?.gesamt, 18);
    lacks("Ps 2,7: kein Kürzungssatz", hint(xrefGesamtVoll.json), "gelistet");

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

    // Die Ellipse innerhalb eines Kapitels: Sie nennt den letzten Vers, den sie
    // weglässt, und ohne diese Zahl läse sich der abgeschnittene Text
    // vollständig.
    const spanne = ((xrefLangeSpanne.json?.verweise ?? []) as Array<Json>).find((x) =>
      String(x.stelle).startsWith("Sprüche 8,22")
    );
    check("1. Mose 1,1: Sprüche 8,22-30 enthalten", spanne !== undefined);
    has("lange Spanne: Ellipse nennt den letzten Vers", String(spanne?.text ?? ""), "… [bis V. 30]");

    // Und über die Kapitelgrenze hinweg mit Kapitel UND Vers: Eine bloße
    // Versnummer wäre dort mehrdeutig.
    const ueber = ((xrefUeberKapitel.json?.verweise ?? []) as Array<Json>).find((x) =>
      String(x.stelle).includes("11,32")
    );
    check("1. Mose 11,31: Ziel über die Kapitelgrenze enthalten", ueber !== undefined);
    has(
      "über Kapitelgrenze: Ellipse nennt Kapitel und Vers",
      String(ueber?.text ?? ""),
      "… [Abschnitt bis 12,1]"
    );

    // Die Ellipse allein war kein Signal: `verse_einzeln` trug vier von neun
    // Versen, ohne es zu sagen, während der `lesehinweis` daraus vollständiges
    // Zitieren verlangte. Beides muss jetzt zusammenpassen.
    eq("lange Spanne: verse_einzeln trägt vier Verse",
      ((spanne?.verse_einzeln ?? []) as unknown[]).length, 4);
    eq("lange Spanne: abschnitt_gekuerzt nennt die gezeigten Verse",
      (spanne?.abschnitt_gekuerzt as Json | undefined)?.verse_gezeigt, 4);
    eq("lange Spanne: abschnitt_gekuerzt nennt die ganze Spanne",
      (spanne?.abschnitt_gekuerzt as Json | undefined)?.verse_gesamt, 9);
    has("lange Spanne: lesehinweis nennt das Feld",
      String(xrefLangeSpanne.json?.lesehinweis ?? ""), "abschnitt_gekuerzt");

    // Über die Kapitelgrenze steht nur der erste Vers da, und es gibt gar kein
    // `verse_einzeln`, obwohl `stelle` mehrere Verse nennt. `verse_gesamt`
    // fehlt hier bewusst: Die Länge über die Grenze hinweg steht nicht fest.
    eq("über Kapitelgrenze: abschnitt_gekuerzt nennt einen Vers",
      (ueber?.abschnitt_gekuerzt as Json | undefined)?.verse_gezeigt, 1);
    check("über Kapitelgrenze: kein verse_gesamt",
      (ueber?.abschnitt_gekuerzt as Json | undefined)?.verse_gesamt === undefined);
    check("über Kapitelgrenze: kein verse_einzeln", ueber?.verse_einzeln === undefined);

    // Der Klammerhinweis in beide Richtungen. Er lief bis zum 06.08.2026 auf
    // den servereigenen Marker an und behauptete damit das Gegenteil der Lage.
    has("1Mo 25,21 (MB): Klammerhinweis bei echtem Einschub",
      hint(xrefKlammerEcht.json), "Wörter in eckigen Klammern");
    lacks("1Mo 25,21 (LUT): kein Klammerhinweis",
      hint(xrefKlammerKeine.json), "Wörter in eckigen Klammern");
    lacks("lange Spanne: Marker löst keinen Klammerhinweis aus",
      hint(xrefLangeSpanne.json), "Wörter in eckigen Klammern");
    lacks("über Kapitelgrenze: Marker löst keinen Klammerhinweis aus",
      hint(xrefUeberKapitel.json), "Wörter in eckigen Klammern");

    eq("ohne Querverweise: isError", xrefKeine.isError, true);
    eq("ohne Querverweise: nennt die Stelle", xrefKeine.text, "Keine Querverweise für 1 Mose 1,13 gefunden.");
    // Auch die Verweisantwort trägt die Kopiervorlage: Aus ihr wird zitiert.
    eq("kurzref: Joh 14,6", xrefJoh146.json?.kurzref, "Joh 14,6");

  },
});

if (import.meta.main) {
  await fahre([crossrefsBuendel]);
  abschluss();
}
