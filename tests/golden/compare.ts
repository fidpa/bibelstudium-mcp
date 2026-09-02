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
import { MAX_BOOK_LENGTH } from "../../src/werkzeug-helfer.ts";
import { check, eq, has, lacks, abschluss } from "../lib/zusicherungen.ts";
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
    // Keine TAGNT-Zeile: neun NT-Verse haben keine, `bezeugung` fehlt dann zu
    // Recht, muss das aber sagen.
    cmpOhneBezeugung: ["bible_compare", { book: "Joh", chapter: 7, verse: 53 }],
    // Der Gegenfall zu 1Joh 5,7: ein Vers, dessen Bezeugung tatsächlich eine
    // Variantennotiz führt (γένεσις/γέννησις). Nur so lässt sich messen, dass der
    // Hinweis auf 'bedeutungsvariante' dort steht, wo das Feld auch kommt: Bloß
    // seine Abwesenheit zu prüfen, ginge auch bei einem Hinweis durch, der ihn
    // nie nennt.
    cmpMitNotiz: ["bible_compare", { book: "Mt", chapter: 1, verse: 18 }],
    cmpBuchZahl: ["bible_compare", { book: 123, chapter: 1, verse: 1 }],
    // Seit dem 06.08.2026 liegen die drei Buchprüfungen in `requireBookName`.
    // Die eigene „is required"-Meldung dieses Werkzeugs nennt als einzige nur
    // neutestamentliche Beispiele, weil es alttestamentliche Bücher ohnehin
    // abweist; ungedeckt war sie hier bis dahin trotzdem.
    cmpBuchFehlt: ["bible_compare", { chapter: 1, verse: 1 }],
    cmpBuchZuLang: ["bible_compare", { book: "J".repeat(MAX_BOOK_LENGTH + 10), chapter: 1, verse: 1 }],
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
    // Das Gegenstück zu Mt 1,18: ein Vers, dessen Notizen ausschließlich
    // Schreibvarianten sind. Mt 1,5 führt sechs davon und keine einzige
    // Bedeutungsvariante (gemessen 07.08.2026). Geprüft war bis dahin nur die
    // andere Art; ein Einbau, der das Feld 'schreibvariante' ganz wegließ, blieb
    // grün, und der Hinweis unterscheidet die beiden Lagen nach demselben
    // Merkmal.
    cmpSchreibvariante: ["bible_compare", { book: "Mt", chapter: 1, verse: 5 }],
    // Drei Fälle für den Editionsabgleich, alle am 02.09.2026 gemessen. Mt 18,6:
    // Die Notiz trennt zwei Lesarten mit „¦" (ἐπὶ: TR ¦ εἰς: SBL+Byz); bis dahin
    // wurde nur an „;" getrennt, und die Antwort behauptete „byzantine liest
    // hier περὶ, nicht ἐπὶ". Dazu liest TR „εἰς" an anderer Stelle des Verses,
    // was ohne die Mehrformen-Regel den Satz „tr liest hier εἰς" erzeugte.
    cmpTrenner: ["bible_compare", { book: "Mt", chapter: 18, verse: 6 }],
    // Mk 4,8: Kopf ἓν, Lesart εἰς, und alle drei Editionen führen beide Formen im
    // Vers. Kein Satz darf fallen, weil keiner entscheidbar ist.
    cmpBeideFormen: ["bible_compare", { book: "Mk", chapter: 4, verse: 8 }],
    // Mt 21,11: Bis zum 02.09.2026 fehlte in TR das Wort ganz (der Import
    // übersprang die Variantengruppe der Quelle), und der Abgleich behauptete
    // erst den Kopf, dann „weder noch". Seit dem Import der ersten Lesart liest
    // TR Ναζαρέτ, genau die TR-Lesart der Notiz: kein Satz über tr.
    cmpWederNoch: ["bible_compare", { book: "Mt", chapter: 21, verse: 11 }],
    // Fünf Lagen des positionsfesten Abgleichs (seit 02.09.2026), je eine Stelle:
    // Mt 28,3 Byz „λευκον ωσει χιων": Lesart an der Stelle, Kopf ὡς anderswo
    // im Vers; die Mehrformen-Regel allein verschluckte diesen Satz.
    cmpStelle: ["bible_compare", { book: "Mt", chapter: 28, verse: 3 }],
    // Mk 10,16: Byz lässt das Wort an der Stelle aus („ηὐλόγει" steht nirgends).
    cmpLuecke: ["bible_compare", { book: "Mk", chapter: 10, verse: 16 }],
    // Mk 1,13 Byz „ημερας τεσσαρακοντα": Lesart direkt neben der Lücke.
    cmpWortstellung: ["bible_compare", { book: "Mk", chapter: 1, verse: 13 }],
    // Apg 5,19: an der Stelle steht ein drittes Wort (ηνοιξεν mit beweglichem ν).
    cmpDrittes: ["bible_compare", { book: "Apg", chapter: 5, verse: 19 }],
    // Lk 3,32: keine Stelle bestimmbar, Byz führt weder Kopf noch Lesart.
    cmpOhneStelle: ["bible_compare", { book: "Lk", chapter: 3, verse: 32 }],
    // Mt 21,7: SBL schreibt die Elision „ἐπ’" mit U+2019; bis zum 02.09.2026
    // passte sie nicht auf den Kopf „ἐπ᾽", und der Satz „sblgnt liest hier
    // ἐπάνω" fiel (das ἐπάνω steht am Versende).
    cmpApostroph: ["bible_compare", { book: "Mt", chapter: 21, verse: 7 }],
  },
  pruefe({ res }) {
    {
      const { cmpTrenner, cmpBeideFormen, cmpWederNoch } = res;
      const abweichend = (r: typeof cmpTrenner) =>
        ((((r.json?.bezeugung ?? {}) as Record<string, unknown>)["abweichend"] ?? []) as Array<Record<string, unknown>>);
      const saetze = (r: typeof cmpTrenner) =>
        abweichend(r).flatMap((e) => (Array.isArray(e["abgleich"]) ? (e["abgleich"] as string[]) : []));
      const peri = abweichend(cmpTrenner).find((e) => e["wort"] === "περὶ");
      const belege = (peri?.["in_dieser_db"] ?? {}) as Record<string, string[]>;
      check(
        'Mt 18,6: „εἰς" mit byzantine und sblgnt belegt',
        (belege["εἰς"] ?? []).includes("byzantine") && (belege["εἰς"] ?? []).includes("sblgnt"),
        JSON.stringify(belege)
      );
      check('Mt 18,6: kein Satz nennt byzantine mit „ἐπὶ"', !saetze(cmpTrenner).some((s) => s.startsWith("byzantine") && s.includes("ἐπὶ")), saetze(cmpTrenner).join(" | "));
      check('Mt 18,6: kein Satz nennt tr mit „εἰς"', !saetze(cmpTrenner).some((s) => s.startsWith("tr") && s.includes("εἰς")), saetze(cmpTrenner).join(" | "));
      check("Mt 18,6: keine Quellenkonflikte", !("quellenkonflikte" in (cmpTrenner.json ?? {})));
      check("Mk 4,8: ἓν gegen εἰς überall doppelt, kein Satz", saetze(cmpBeideFormen).length === 0, saetze(cmpBeideFormen).join(" | "));
      check("Mk 4,8: Bezeugung trotzdem besetzt", abweichend(cmpBeideFormen).length > 0);
      check("Mt 21,11: kein Satz über tr, das die TR-Lesart liest", !saetze(cmpWederNoch).some((s) => s.startsWith("tr ")), saetze(cmpWederNoch).join(" | "));
      const { cmpStelle, cmpLuecke, cmpWortstellung, cmpDrittes, cmpOhneStelle, cmpApostroph } = res;
      has("Mt 28,3: Lesart an der Stelle, Kopf anderswo", saetze(cmpStelle).join(" | "), 'byzantine liest hier "ὡσεὶ"; die TAGNT-Notiz führt dafür nur TR als Zeugen.');
      has(
        "Mk 10,16: Lücke wird als Lücke gemeldet",
        saetze(cmpLuecke).join(" | "),
        'byzantine führt an dieser Stelle kein Wort, also auch nicht "ηὐλόγει"; die TAGNT-Notiz nennt Byz jedoch als Zeugen'
      );
      has("Mk 1,13: Lesart neben der Lücke heißt andere Wortstellung", saetze(cmpWortstellung).join(" | "), 'byzantine liest hier "τεσσαράκοντα" in anderer Wortstellung');
      has("Apg 5,19: drittes Wort an der Stelle wird genannt", saetze(cmpDrittes).join(" | "), 'byzantine liest an dieser Stelle "ηνοιξεν", weder "ἀνοίξας" noch "ἤνοιξε"');
      has("Lk 3,32: ohne Stelle bleibt der Satz mit weder und noch", saetze(cmpOhneStelle).join(" | "), 'byzantine führt an dieser Stelle weder "Ἰωβὴδ" noch "Ἰωβὴλ"');
      check("Mt 21,7: kein Satz nennt sblgnt mit ἐπάνω", !saetze(cmpApostroph).some((s) => s.startsWith("sblgnt") && s.includes("ἐπάνω")), saetze(cmpApostroph).join(" | "));
    }
    const { cmpVerse999, comma, mk1446, cmpOhneBezeugung, cmpMitNotiz, cmpBuchZahl } = res;
    const { cmpBuchFehlt, cmpBuchZuLang, cmpBuchNull, cmpAltesTestament, cmpKapitel999 } = res;
    const { cmpSchreibvariante } = res;

    // Die zweite Variantenart, und zwar an einem Vers, der nur sie führt: Sonst
    // deckte der Fall von Mt 1,18 sie mit ab, ohne sie zu prüfen.
    {
      const abw = ((cmpSchreibvariante.json?.bezeugung ?? {}) as Record<string, unknown>)["abweichend"];
      const liste = (Array.isArray(abw) ? abw : []) as Array<Record<string, unknown>>;
      check("Mt 1,5: Bezeugung besetzt", liste.length > 0, `${liste.length} Einträge`);
      check(
        "Mt 1,5: mindestens eine Schreibvariante steht da",
        liste.some((e) => typeof e["schreibvariante"] === "string"),
        JSON.stringify(liste.map((e) => Object.keys(e)))
      );
      // Die Abgrenzung gehört zur Aussage: Wäre hier auch eine Bedeutungsvariante
      // dabei, prüfte der Fall dieselbe Lage wie Mt 1,18 ein zweites Mal.
      check(
        "Mt 1,5: keine Bedeutungsvariante, das ist der Unterschied zu Mt 1,18",
        !liste.some((e) => "bedeutungsvariante" in e)
      );
      // Der Hinweis verzweigt danach, ob überhaupt eine Notiz vorliegt. Eine
      // Schreibvariante allein muss dafür genügen.
      has(
        "Mt 1,5: Schreibvariante allein verweist auf 'bezeugung'",
        String(cmpSchreibvariante.json?.hinweis ?? ""),
        "steht in 'bezeugung'"
      );
      lacks(
        "Mt 1,5: kein Satz über eine ungeklärte Art",
        String(cmpSchreibvariante.json?.hinweis ?? ""),
        "sagt diese Antwort nicht"
      );
    }

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
    // Die drei Felder, die aus dem Abgleich entstehen, beim Namen: Sie waren bis
    // zum 02.09.2026 von keiner Zusicherung gedeckt, obwohl derselbe Aufruf sie
    // fährt; ein Einbau, der sie aus dem Eintrag nahm, blieb grün.
    {
      const bez = (mk1446.json?.bezeugung ?? {}) as Record<string, unknown>;
      const eintrag = ((bez["abweichend"] ?? []) as Array<Record<string, unknown>>).find((e) => "abgleich" in e);
      check("Mk 14,46: ein Eintrag trägt 'abgleich'", eintrag !== undefined);
      check("Mk 14,46: derselbe Eintrag trägt 'in_dieser_db'", typeof eintrag?.["in_dieser_db"] === "object" && eintrag?.["in_dieser_db"] !== null);
      has("Mk 14,46: bezeugung.lesehinweis erklärt 'in_dieser_db'", String(bez["lesehinweis"] ?? ""), "'in_dieser_db' zeigt pro Form");
      const commaBez = (comma.json?.bezeugung ?? {}) as Record<string, unknown>;
      check("1Joh 5,7: ohne Notiz kein lesehinweis in bezeugung", !("lesehinweis" in commaBez));
      // Joh 7,53 fehlt im SBLGNT: Der Paarvergleich meldet das als eigenen
      // Zweig, der bis dahin in derselben Antwort mitlief, ungeprüft.
      const ergebnisse = ((cmpOhneBezeugung.json?.vergleiche ?? []) as Array<Record<string, unknown>>).map((v) => String(v["ergebnis"] ?? ""));
      check("Joh 7,53: sblgnt führt den Vers nicht, der Vergleich sagt es", ergebnisse.some((e) => e === 'Vers fehlt in Edition "sblgnt"'), ergebnisse.join(" | "));
    }
    const qk = (mk1446.json?.quellenkonflikte ?? []) as string[];
    eq("Mk 14,46: ein Quellenkonflikt", qk.length, 1);
    has("Mk 14,46: nennt Editionslesart zuerst", qk[0] ?? "", 'byzantine liest hier "ἐπέβαλον"');

    check("Joh 7,53: ohne bezeugung", !("bezeugung" in (cmpOhneBezeugung.json ?? {})));
    eq("Joh 7,53: kein Fehler", cmpOhneBezeugung.isError, false);
    // Das fehlende Feld muss als fehlend dastehen. Ein fremder Client stand hier
    // vor der Wahl, die Lücke als „nicht bezeugt" zu lesen (06.08.2026), und der
    // Vers ist in byzantine und tr vorhanden: Die Deutung wäre falsch gewesen.
    has(
      "Joh 7,53: nennt den Grund für die fehlende Bezeugung",
      String(cmpOhneBezeugung.json?.bezeugung_fehlt ?? ""),
      "keine Zeile"
    );
    lacks(
      "Joh 7,53: hinweis verweist nicht auf das fehlende Feld",
      String(cmpOhneBezeugung.json?.hinweis ?? ""),
      "steht in 'bezeugung'"
    );
    // Und er nennt nicht „die aufgeführten Formen": Hier ist keine aufgeführt.
    // Der Satz gilt zwei verschiedenen Lagen, ohne Bezeugung und mit einer ohne
    // Notiz, und darf nicht die eine mit den Worten der anderen beschreiben.
    has(
      "Joh 7,53: hinweis nennt die richtige Lage",
      String(cmpOhneBezeugung.json?.hinweis ?? ""),
      "keine Bezeugung vor, siehe 'bezeugung_fehlt'"
    );

    // Der Hinweis folgt dem Bestand der Antwort, nicht einer festen Formulierung.
    // 1Joh 5,7 führt 22 Wörter und keine einzige Notiz, Mt 1,18 eine; bis 0.6.12
    // verwies der Hinweis in beiden Fällen gleich, also bei 55,6 % der
    // aufgeführten Wörter auf ein Feld, das nicht dasteht, und verbot im selben
    // Satz, die Art zu erschließen.
    lacks(
      "1Joh 5,7 ohne Notiz: kein Verweis auf 'bezeugung'",
      String(comma.json?.hinweis ?? ""),
      "steht in 'bezeugung'"
    );
    has(
      "1Joh 5,7 ohne Notiz: sagt, dass die Art offen bleibt",
      String(comma.json?.hinweis ?? ""),
      "sagt diese Antwort nicht"
    );
    has(
      "Mt 1,18 mit Notiz: verweist auf 'bezeugung'",
      String(cmpMitNotiz.json?.hinweis ?? ""),
      "steht in 'bezeugung'"
    );
    const mtAbw = ((cmpMitNotiz.json?.bezeugung ?? {}) as Record<string, unknown>)["abweichend"];
    check(
      "Mt 1,18: eine Notiz steht tatsächlich da",
      Array.isArray(mtAbw) &&
        mtAbw.some((e) => typeof e === "object" && e !== null && "bedeutungsvariante" in e)
    );
    // Die acht Apparatzeugen tragen dieselben Namen wie geladene Editionen, „Byz"
    // insbesondere. Die Legende muss den Unterschied benennen: In 10,8 % der
    // NT-Verse gehen Apparatspalte und Editionstext auseinander.
    has(
      "Bezeugung: Apparatzeugen von den Editionen abgegrenzt",
      String(((cmpMitNotiz.json?.bezeugung ?? {}) as Record<string, unknown>)["quelle"] ?? ""),
      "nicht der oben verglichene Text 'byzantine'"
    );
    eq("kurzref: 1Joh 5,7", comma.json?.kurzref, "1Joh 5,7");

  },
});

if (import.meta.main) {
  await fahre([compareBuendel]);
  abschluss();
}
