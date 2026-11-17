/**
 * `bible_compare_chapter`: welche Verse eines NT-Kapitels zwischen den
 * Editionen abweichen.
 *
 * Die Übersicht verweist für jeden Vers auf `bible_compare` und darf deshalb
 * nicht anders urteilen als dieser. Geprüft wird das nicht gegen Literale,
 * sondern gegen den Einzelvergleich selbst: Dieselben Verse laufen über beide
 * Werkzeuge, und was die Übersicht zu einem Vers sagt, muss sich aus dem
 * Einzelvergleich ergeben. Ein Paar, das die Übersicht ausließe, fiele genau
 * dort auf.
 *
 * Der 3. Johannesbrief trägt das Bündel, weil er alle Lagen in einem Kapitel
 * führt: Verse, in denen alle drei Editionen übereinstimmen, Verse, die nur
 * gegen den kritischen Text abweichen, und einen Vers (15), den Mehrheitstext
 * und Textus Receptus nicht kennen (sie enden bei 14, gemessen 17.11.2026).
 *
 * Einzeln lauffähig: `bun run tests/golden/compare-chapter.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, hint, abschluss, type Json } from "../lib/zusicherungen.ts";
import { KAPITEL_AUSSERHALB } from "../lib/meldungen.ts";

type Vers = { vers: number; tagnt_bedeutungsvariante?: boolean; vergleiche: Array<Record<string, unknown>> };
const verse = (j: Json | null): Vers[] => (j?.verse ?? []) as Vers[];
/** Die Paare eines Einzelvergleichs, die nicht „identisch" melden. */
const abweichendePaare = (j: Json | null): Array<Record<string, unknown>> =>
  ((j?.vergleiche ?? []) as Array<Record<string, unknown>>).filter(
    (p) => p.ergebnis !== "identisch (nach Normalisierung)"
  );

export const compareChapterBuendel = buendel({
  name: "compare-chapter",
  calls: {
    kapitel: ["bible_compare_chapter", { book: "3Joh", chapter: 1 }],
    // Dieselben Verse einzeln, als Maßstab.
    einzel1: ["bible_compare", { book: "3Joh", chapter: 1, verse: 1 }],
    einzel4: ["bible_compare", { book: "3Joh", chapter: 1, verse: 4 }],
    einzel12: ["bible_compare", { book: "3Joh", chapter: 1, verse: 12 }],
    bereich: ["bible_compare_chapter", { book: "3Joh", chapter: 1, verses: "4-6" }],
    // Vers 16 gibt es in keiner Edition, Vers 15 nur im SBLGNT.
    ohneDaten: ["bible_compare_chapter", { book: "3Joh", chapter: 1, verses: "14-16" }],
    nurOhneDaten: ["bible_compare_chapter", { book: "3Joh", chapter: 1, verses: "16-17" }],
    altesTestament: ["bible_compare_chapter", { book: "1. Mose", chapter: 1 }],
    kapitelFehlt: ["bible_compare_chapter", { book: "3Joh", chapter: 2 }],
    kapitel999: ["bible_compare_chapter", { book: "3Joh", chapter: 999 }],
    ohneBuch: ["bible_compare_chapter", { chapter: 1 }],
    versUmgekehrt: ["bible_compare_chapter", { book: "3Joh", chapter: 1, verses: "10-5" }],
  },
  pruefe({ res }) {
    const { kapitel, einzel1, einzel4, einzel12 } = res;
    eq("Kapitel: kein Fehler", kapitel.isError, false);
    const j = kapitel.json;
    const liste = verse(j);

    eq("Kapitel: geprüft wird die Vereinigung der Editionen", j?.verse_geprueft, 15);
    eq("Kapitel: reference nennt die geprüften Verse", j?.reference, "3 Johannes 1,1-15");
    eq("Kapitel: die Zahl stimmt mit der Liste", j?.verse_mit_unterschied, liste.length);
    check("Kapitel: Liste aufsteigend", liste.every((v, i) => i === 0 || liste[i - 1]!.vers < v.vers));
    check("Kapitel: kein gelisteter Vers ohne abweichendes Paar", liste.every((v) => v.vergleiche.length > 0));
    check(
      "Kapitel: kein gelistetes Paar meldet identisch",
      liste.every((v) => v.vergleiche.every((p) => p.ergebnis !== "identisch (nach Normalisierung)"))
    );

    // Der Maßstab: Was der Einzelvergleich an einem Vers als abweichend
    // meldet, steht in der Übersicht zeichengleich da, kein Paar mehr und
    // keines weniger.
    for (const [nr, einzel] of [[4, einzel4], [12, einzel12]] as const) {
      const hier = liste.find((v) => v.vers === nr);
      check(`Vers ${nr}: steht in der Übersicht`, hier !== undefined);
      eq(
        `Vers ${nr}: dieselben Paare wie bible_compare`,
        JSON.stringify(hier?.vergleiche),
        JSON.stringify(abweichendePaare(einzel.json))
      );
    }
    // Der Gegenfall: Ein Vers, den der Einzelvergleich durchweg identisch
    // meldet, steht nicht in der Liste, wohl aber unter `identisch`.
    eq("Vers 1: Einzelvergleich meldet kein abweichendes Paar", abweichendePaare(einzel1.json).length, 0);
    check("Vers 1: nicht in der Liste", !liste.some((v) => v.vers === 1));
    check("Vers 1: unter identisch", String(j?.identisch ?? "").split(".")[0]!.startsWith("1"));

    // Vers 15 führt nur das SBLGNT. Gegen beide anderen ist das eine Abweichung;
    // zwischen den beiden, die ihn nicht kennen, ist es keine.
    const v15 = liste.find((v) => v.vers === 15);
    eq(
      "Vers 15: zwei Paare, beide gegen das SBLGNT",
      (v15?.vergleiche ?? []).map((p) => p.paar).join(" | "),
      "byzantine ↔ sblgnt | tr ↔ sblgnt"
    );

    // Die Zahl je Paar ist über die Liste ausgezählt, und jedes Paar steht da.
    const paare = (j?.paare ?? []) as Array<{ paar: string; verse_mit_unterschied: number }>;
    eq("Kapitel: drei Editionspaare", paare.map((p) => p.paar).join(" | "), "byzantine ↔ tr | byzantine ↔ sblgnt | tr ↔ sblgnt");
    for (const p of paare) {
      eq(
        `Paar ${p.paar}: Zahl stimmt mit der Liste`,
        p.verse_mit_unterschied,
        liste.filter((v) => v.vergleiche.some((x) => x.paar === p.paar)).length
      );
    }
    // identisch und abweichend teilen die geprüften Verse ohne Rest.
    const zaehleVerse = (s: string): number =>
      s === "" ? 0 : s.split(".").reduce((n, teil) => {
        const [a, b] = teil.split("-").map(Number);
        return n + (b === undefined ? 1 : b - a! + 1);
      }, 0);
    eq("Kapitel: identisch + abweichend = geprüft", zaehleVerse(String(j?.identisch ?? "")) + liste.length, 15);

    // Die Marke aus dem Apparat: am gelisteten Vers und in der Versliste oben
    // dieselbe Auskunft, und sie deckt sich mit dem, was der Einzelvergleich in
    // `bezeugung` führt.
    const markiert = new Set(liste.filter((v) => v.tagnt_bedeutungsvariante === true).map((v) => v.vers));
    const hatNotiz = (e: Json | null): boolean =>
      ((((e?.bezeugung ?? {}) as Record<string, unknown>).abweichend ?? []) as Array<Record<string, unknown>>)
        .some((w) => typeof w.bedeutungsvariante === "string");
    eq("Vers 4: Marke wie die Bezeugung des Einzelvergleichs", markiert.has(4), hatNotiz(einzel4.json));
    eq("Vers 12: Marke wie die Bezeugung des Einzelvergleichs", markiert.has(12), hatNotiz(einzel12.json));
    check("Kapitel: Versliste der Marken vorhanden", typeof j?.tagnt_bedeutungsvarianten === "string");
    has("Kapitel: hinweis sagt, woher die Marke stammt", hint(j), "stammen aus dem Apparat (STEPBible TAGNT), nicht aus den hier verglichenen Editionen");
    has("Kapitel: hinweis verweist auf den Einzelvergleich", hint(j), "bible_compare");

    // --- Bereich ---
    eq("Bereich: geprüft werden die genannten Verse", res.bereich.json?.verse_geprueft, 3);
    eq("Bereich: reference", res.bereich.json?.reference, "3 Johannes 1,4-6");
    eq(
      "Bereich: dieselben Einträge wie im ganzen Kapitel",
      JSON.stringify(verse(res.bereich.json)),
      JSON.stringify(liste.filter((v) => v.vers >= 4 && v.vers <= 6))
    );

    // --- angefragte Verse, die es nicht gibt ---
    eq("ohne Daten: kein Fehler, solange ein Vers bleibt", res.ohneDaten.isError, false);
    eq("ohne Daten: benannt", JSON.stringify(res.ohneDaten.json?.verse_ohne_daten), "[16]");
    eq("ohne Daten: reference nennt nur Geprüftes", res.ohneDaten.json?.reference, "3 Johannes 1,14-15");
    has("ohne Daten: hinweis sagt es", hint(res.ohneDaten.json), "führt keine geladene Edition Daten");
    eq("nur Verse ohne Daten: isError", res.nurOhneDaten.isError, true);
    eq("nur Verse ohne Daten: Meldung", res.nurOhneDaten.text, "Keine Urtext-Daten für 3 Johannes 1,16-17.");

    // --- Abweisungen ---
    eq("AT: isError", res.altesTestament.isError, true);
    has("AT: nennt den Grund", res.altesTestament.text, "Der Editionsvergleich gilt nur fürs NT");
    eq("Kapitel gibt es nicht: isError", res.kapitelFehlt.isError, true);
    eq("Kapitel gibt es nicht: Meldung", res.kapitelFehlt.text, "Keine Urtext-Daten für 3 Johannes 2.");
    eq("Kapitel außerhalb: Meldung nennt die Grenze", res.kapitel999.text, KAPITEL_AUSSERHALB);
    eq("ohne Buch: isError", res.ohneBuch.isError, true);
    has("ohne Buch: eigene Meldung mit NT-Beispielen", res.ohneBuch.text, "'book' is required (e.g. 'Römer', '1Joh')");
    eq("umgekehrte Spanne: isError", res.versUmgekehrt.isError, true);
    has("umgekehrte Spanne: nennt die Bedingung", res.versUmgekehrt.text, "the first number must not be greater than the second");
  },
});

if (import.meta.main) {
  await fahre([compareChapterBuendel]);
  abschluss();
}
