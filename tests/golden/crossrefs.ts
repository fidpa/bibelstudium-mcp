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
import { MAX_BOOK_LENGTH } from "../../src/werkzeug-helfer.ts";
import { check, eq, has, hint, lacks, abschluss, type Json } from "../lib/zusicherungen.ts";
import {
  BUCH_KEINE_ZEICHENKETTE,
  BUCH_ZU_LANG,
  VERSE_AUSSERHALB,
  KAPITEL_AUSSERHALB,
} from "../lib/meldungen.ts";

const OVERLONG_NAME = "J".repeat(MAX_BOOK_LENGTH + 10);

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
    // Ein Verweisziel, das die Ausgabe nur teilweise führt: Daniel 4,34-35 hat in
    // Menge einen Vers (andere Zählung). Bis zum 02.09.2026 hing
    // `abschnitt_gekuerzt` allein an der Vier-Vers-Grenze, und `stelle` reichte
    // weiter als der gelieferte Text, ohne dass das Feld stand.
    xrefTeilSpanne: ["bible_crossrefs", { book: "1. Chronik", chapter: 29, verse: 11, translation: "MB", limit: 3 }],
    // Mt 19,4 liegt in einer Parallelgruppe mit 1 Mose 1,27 und 5,2; beide
    // Kapitel zählen in WLC und allen fünf Ausgaben gleich (31 bzw. 32, gemessen
    // 02.09.2026). Kein Mitglied darf `zaehlung_abweichend` tragen, der Vorbehalt
    // im Hinweis steht trotzdem, weil das AT berührt ist.
    xrefParallelenGleicheZaehlung: ["bible_crossrefs", { book: "Matthäus", chapter: 19, verse: 4, limit: 1 }],
    // Drei Eingabepfade, die die Nachbarwerkzeuge prüfen und dieses bis zum
    // 02.09.2026 nicht: Kapitel jenseits der Grenze, unbekanntes Buch, unbekannte
    // Übersetzung über den Werkzeugkanal.
    xrefKapitel999: ["bible_crossrefs", { book: "Joh", chapter: 999, verse: 1 }],
    xrefBuchUnbekannt: ["bible_crossrefs", { book: "Hesekiel-Zusatz", chapter: 1, verse: 1 }],
    xrefUebersetzungUnbekannt: ["bible_crossrefs", { book: "Joh", chapter: 3, verse: 16, translation: "XYZ" }],
    xrefGesamtVoll: ["bible_crossrefs", { book: "Psalm", chapter: 2, verse: 7, limit: 30 }],
    // Die Parallelstellen aus der UBS-Datenbank. Markus 2,12 ist der Fall, der
    // den Zugewinn trägt: Die zehn bestbewerteten Verweise nennen weder Lukas
    // 5,25-26 noch Johannes 5,9, die Parallelgruppe nennt beide
    // (gemessen 22.08.2026).
    parallelenMk2_12: ["bible_crossrefs", { book: "Markus", chapter: 2, verse: 12, limit: 3 }],
    // Bedingtes Feld: Matthäus 5,1 steht in keiner Gruppe, hat aber Verweise.
    parallelenOhne: ["bible_crossrefs", { book: "Matthäus", chapter: 5, verse: 1, limit: 3 }],
    // Gruppe ohne einen einzigen Querverweis. Bis dieser Datensatz dazukam,
    // war das eine Fehlerantwort; betroffen sind 338 Verse (gemessen 22.08.2026).
    parallelenOhneVerweis: ["bible_crossrefs", { book: "Matthäus", chapter: 12, verse: 47 }],
    // Die Referenzform mit Komma. Zehn Referenzen der Quelle nennen zwei
    // Abschnitte mit einer echten Lücke dazwischen; als eine Spanne gelesen
    // lieferte diese Antwort Lukas 6,29 bis 6,34 mit, die nicht zur Stelle
    // gehören.
    parallelenKomma: ["bible_crossrefs", { book: "Matthäus", chapter: 5, verse: 44, limit: 1 }],
    // Alttestamentlicher Fall: Die Quelle zählt nach der hebräischen Bibel,
    // Psalm 18 hat dort 51 Verse und in Luther 50.
    parallelenAt: ["bible_crossrefs", { book: "2. Samuel", chapter: 22, verse: 2, limit: 1 }],
    // Die Wortlaut-Grenze gegen die größte Gruppe, die Wortereignisformel in
    // Jeremia und Ezechiel mit 37 anderen Stellen. Erwartet werden Zahlen und
    // Flaggen, kein Wortlaut: Ein Erwartungswert mit Text der Schlachter 2000
    // gehört nicht in dieses Repository.
    parallelenSltGrenze: [
      "bible_crossrefs",
      { book: "Hesekiel", chapter: 12, verse: 1, translation: "SLT", limit: 30 },
    ],
  },
  pruefe({ res }, ctx) {
    {
      const daniel = ((res.xrefTeilSpanne.json?.verweise ?? []) as Array<Json>).find((v) => v["stelle"] === "Daniel 4,34-35");
      check("1Chr 29,11 (MB): Verweis auf Daniel 4,34-35 gelistet", daniel !== undefined);
      eq("Daniel 4,34-35 (MB): ein Vers geliefert", ((daniel?.["verse_einzeln"] ?? []) as unknown[]).length, 1);
      eq("Daniel 4,34-35 (MB): abschnitt_gekuerzt nennt 1 von 2", JSON.stringify(daniel?.["abschnitt_gekuerzt"]), JSON.stringify({ verse_gezeigt: 1, verse_gesamt: 2 }));
      const par = JSON.stringify(res.xrefParallelenGleicheZaehlung.json?.parallelen ?? null);
      check("Mt 19,4: Parallelen mit 1 Mose 1,27 geliefert", par.includes("1 Mose 1,27"), par.slice(0, 200));
      lacks("Mt 19,4: gleiche Zählung, kein Mitglied als abweichend markiert", par, "zaehlung_abweichend");
      has("Mt 19,4: der Vorbehalt steht trotzdem", String(res.xrefParallelenGleicheZaehlung.json?.hinweis ?? ""), "hebräischen Bibel");
      eq("bible_crossrefs chapter=999: Text", res.xrefKapitel999.text, KAPITEL_AUSSERHALB);
      has("bible_crossrefs unbekanntes Buch: nennt das nächstliegende", res.xrefBuchUnbekannt.text, '"Hesekiel"');
      has("bible_crossrefs translation=XYZ: abgewiesen", res.xrefUebersetzungUnbekannt.text, 'Unknown translation "XYZ"');
    }
    // Schema gegen Verhalten: `default` und `max` aus der Beschreibung des
    // `limit`-Arguments müssen mit dem übereinstimmen, was der Handler tut.
    // Beide kommen seit dem 02.09.2026 aus einer Konstante; diese Zusicherung
    // hält fest, dass niemand wieder eine nackte Zahl daneben schreibt.
    {
      const tool = ctx.tools.find((t) => t["name"] === "bible_crossrefs") ?? {};
      const props = ((tool["inputSchema"] as Record<string, unknown> | undefined)?.["properties"] ?? {}) as Record<string, Record<string, unknown>>;
      const m = /\(default (\d+), max (\d+)\)/.exec(String(props["limit"]?.["description"] ?? ""));
      check("bible_crossrefs: limit-Beschreibung nennt default und max", m !== null, String(props["limit"]?.["description"]));
      eq("bible_crossrefs: default im Schema gleich der Beschreibung", props["limit"]?.["default"], Number(m?.[1]));
      eq("bible_crossrefs: max der Beschreibung gleich der Klemmung", (res.xrefGesamtMax.json?.verweise as unknown[] ?? []).length, Number(m?.[2]));
    }

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

    // --- Parallelstellen ---
    const { parallelenMk2_12, parallelenOhne, parallelenOhneVerweis } = res;
    const { parallelenKomma, parallelenAt, parallelenSltGrenze } = res;

    /** Alle Stellen einer Antwort, über die Gruppen hinweg flach gelesen. */
    const stellen = (j: Json | null | undefined): Array<Record<string, unknown>> => {
      const p = j?.parallelen as { gruppen?: Array<{ stellen?: unknown }> } | undefined;
      return (p?.gruppen ?? []).flatMap(
        (g) => (g.stellen ?? []) as Array<Record<string, unknown>>
      );
    };

    const mk = stellen(parallelenMk2_12.json);
    eq("Mk 2,12: drei Parallelstellen", mk.length, 3);
    check(
      "Mk 2,12: Lukas 5,25-26 ist dabei, obwohl kein Verweis sie nennt",
      mk.some((s) => s.stelle === "Lukas 5,25-26")
    );
    check("Mk 2,12: Johannes 5,9 ist dabei", mk.some((s) => s.stelle === "Johannes 5,9"));
    check(
      "Mk 2,12: der abgefragte Vers steht nicht in seiner eigenen Gruppe",
      mk.every((s) => s.stelle !== "Markus 2,12")
    );
    check("Mk 2,12: Locator der Quelle liegt bei", mk.every((s) => typeof s.locator === "string"));
    has("Mk 2,12: die UBS-Nennung geht mit hinaus",
      JSON.stringify(parallelenMk2_12.json?.quellen),
      "UBS Parallel Passage Database, © 2023 United Bible Societies.");
    // Der Vorbehalt zur Zählung gehört ins Alte Testament und sonst nirgends
    // hin: Eine rein neutestamentliche Gruppe hat das Problem nicht, und ein
    // Vorbehalt, der überall steht, wird nirgends gelesen.
    lacks("Mk 2,12 (nur NT): kein Zählungsvorbehalt",
      hint(parallelenMk2_12.json), "hebräischen Bibel");

    // Das Feld ist bedingt. Stünde es leer da, hieße das etwas anderes, nämlich
    // „geprüft und nichts gefunden" statt „diese Frage stellt sich hier nicht".
    eq("Mt 5,1: kein Feld 'parallelen'", parallelenOhne.json?.parallelen, undefined);
    check("Mt 5,1: Verweise gibt es trotzdem",
      (parallelenOhne.json?.verweise as unknown[] ?? []).length > 0);

    eq("Mt 12,47: keine Fehlerantwort mehr", parallelenOhneVerweis.isError, false);
    eq("Mt 12,47: null Verweise", parallelenOhneVerweis.json?.gesamt, 0);
    eq("Mt 12,47: zwei Parallelstellen", stellen(parallelenOhneVerweis.json).length, 2);
    // Genannt wird nur, was die Antwort benutzt hat. Ohne einen einzigen
    // Verweis wäre die OpenBible-Nennung eine Behauptung.
    lacks("Mt 12,47: OpenBible nicht genannt, weil nicht benutzt",
      JSON.stringify(parallelenOhneVerweis.json?.quellen), "OpenBible.info");

    const komma = stellen(parallelenKomma.json).find((s) => s.locator === "LUK 6:27-28,35");
    check("Mt 5,44: die Referenz mit Komma ist erhalten", komma !== undefined);
    eq("Mt 5,44: Stellenangabe in deutscher Zitierform", komma?.stelle, "Lukas 6,27-28.35");
    eq(
      "Mt 5,44: nur die drei genannten Verse, nicht die Spanne dazwischen",
      JSON.stringify(((komma?.verse_einzeln ?? []) as Array<{ nr: number }>).map((v) => v.nr)),
      "[27,28,35]"
    );

    const at = stellen(parallelenAt.json);
    eq("2Sam 22,2: Psalter 18,2-3 ist die Parallele", at[0]?.stelle, "Psalter 18,2-3");
    eq("2Sam 22,2: abweichende Zählung ist markiert", at[0]?.zaehlung_abweichend, true);
    has("2Sam 22,2: der Vorbehalt steht im Hinweis",
      hint(parallelenAt.json), "nach der Zählung der hebräischen Bibel");
    has("2Sam 22,2: und nennt den Locator als maßgeblich",
      hint(parallelenAt.json), "maßgeblich ist 'locator'");

    // Die Wortlaut-Grenze. Geprüft werden Zahlen, nie ein Erwartungswert mit
    // Text: Bis zum 22.08.2026 meldete `gekuerzt` hier 29 entfallene Stellen,
    // während der `hinweis` schwieg, weil das Teilbudget das Hauptbudget nicht
    // belastet. Genau das fängt die dritte Zusicherung ab.
    const slt = stellen(parallelenSltGrenze.json);
    const gekuerztSlt = parallelenSltGrenze.json?.gekuerzt as Record<string, number> | undefined;
    eq("Hes 12,1 (SLT): 37 Parallelstellen gelistet", slt.length, 37);
    eq("Hes 12,1 (SLT): acht davon tragen Wortlaut",
      slt.filter((s) => typeof s.text === "string").length, 8);
    has("Hes 12,1 (SLT): die Kürzung steht auch im Hinweis, nicht nur im Feld",
      hint(parallelenSltGrenze.json), "Von den 37 Parallelstellen tragen 8 ihren Text");
    eq("Hes 12,1 (SLT): entfallene Stellen sind beziffert",
      gekuerztSlt?.parallelen_entfallen, 29);
    eq("Hes 12,1 (SLT): die eigene Obergrenze steht dabei",
      gekuerztSlt?.parallelen_max, 8);
    // Die Zusage gilt über beide Teile zusammen: Ein zweites volles Budget
    // machte aus „höchstens 20 Verse je Abruf" stillschweigend 40.
    check("Hes 12,1 (SLT): Wortlaut insgesamt unter der Grenze",
      // Gemessen 02.09.2026 statt konstruktiv wahr (TESTING.md 3.2): Die acht
      // Verse im Wortlaut sind genau die Parallelstellen, kein Verweis trägt Text.
      gekuerztSlt?.im_wortlaut === 8 && gekuerztSlt?.parallelen_gezeigt === 8 && gekuerztSlt?.ohne_wortlaut === 0,
      JSON.stringify(gekuerztSlt));
  },
});

if (import.meta.main) {
  await fahre([crossrefsBuendel]);
  abschluss();
}
