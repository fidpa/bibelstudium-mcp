/**
 * `bible_lookup_many`: mehrere Stellen in einem Abruf.
 *
 * Drei Dinge trägt dieses Bündel, und jedes ist eine Zusage, die ein einzelner
 * `bible_lookup` nicht machen muss. Die Wortlaut-Grenze gilt über den ganzen
 * Abruf und je Ausgabe einmal: Wer sie je Eintrag neu vergäbe, lieferte in
 * einem Abruf ein Vielfaches dessen aus, was die Zusage erlaubt, und kein
 * einzelner Eintrag sähe falsch aus. Ein Eintrag, der scheitert, reißt die
 * anderen nicht mit. Und was mehreren Einträgen gilt (Quellen, Nennung, gleiche
 * Hinweise), steht einmal oben.
 *
 * Erwartungswerte stammen aus Luther 1912, Elberfelder 1871 und Schlachter
 * 1951; die Grenze wird an der Schlachter 1951 geprüft, die dieselbe Zahl trägt
 * wie die lokal geführte zweite Ausgabe und frei lizenziert ist.
 *
 * Einzeln lauffähig: `bun run tests/golden/lookup-many.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, hint, lacks, abschluss, type Json } from "../lib/zusicherungen.ts";
import { MAX_STELLEN } from "../../src/handlers/lookup-many.ts";

type Eintrag = Record<string, unknown>;
const eintraege = (j: Json | null): Eintrag[] => (j?.stellen ?? []) as Eintrag[];

export const lookupManyBuendel = buendel({
  name: "lookup-many",
  calls: {
    // Zwei Ausgaben, zwei Kapitel mit abweichender Zählung, zwei Fehlgriffe.
    vielGemischt: ["bible_lookup_many", {
      translation: "LUT",
      stellen: [
        { book: "Joh", chapter: 3, verses: "16" },
        { book: "Ps", chapter: 22, verses: "2" },
        { book: "Ps", chapter: 22, verses: "25" },
        { book: "Röm", chapter: 8, verses: "28", translation: "ELB" },
        { book: "Xyzbuch", chapter: 1 },
        { book: "Joh", chapter: 3, verses: "150" },
      ],
    }],
    // Dieselbe Stelle einzeln: Der Eintrag muss denselben Text tragen.
    einzelJoh316: ["bible_lookup", { book: "Joh", chapter: 3, verses: "16", translation: "LUT" }],
    // Die Grenze über den Abruf: 15 + 8 + 1 Verse gegen ein Budget von 20. Der
    // erste Eintrag geht ganz hinaus, der zweite mit 5 von 8 Versen, der dritte
    // gar nicht mehr.
    vielGrenze: ["bible_lookup_many", {
      translation: "SCH",
      stellen: [
        { book: "Ps", chapter: 119, verses: "1-15" },
        { book: "Joh", chapter: 3, verses: "14-21" },
        { book: "Röm", chapter: 8, verses: "28" },
      ],
    }],
    // Die Grenze je Ausgabe: Die Schlachter 1951 ist nach dem ersten Eintrag
    // verbraucht, Luther hat keine Grenze. Der dritte Eintrag ist der Fall, den
    // ein Budget je Eintrag statt je Abruf sofort verrät: Er bekäme Text.
    vielZweiAusgaben: ["bible_lookup_many", {
      stellen: [
        { book: "Ps", chapter: 119, verses: "1-20", translation: "SCH" },
        { book: "Joh", chapter: 3, verses: "16", translation: "LUT" },
        { book: "Joh", chapter: 3, verses: "16", translation: "SCH" },
      ],
    }],
    // Kein Eintrag liefert: Dann ist der Abruf als Ganzes ein Fehler.
    vielAlleFehler: ["bible_lookup_many", { stellen: [{ book: "Xyzbuch", chapter: 1 }, { chapter: 2 }] }],
    vielOhneStellen: ["bible_lookup_many", {}],
    vielLeereListe: ["bible_lookup_many", { stellen: [] }],
    vielZuViele: ["bible_lookup_many", {
      stellen: Array.from({ length: MAX_STELLEN + 1 }, () => ({ book: "Joh", chapter: 3, verses: "16" })),
    }],
    // Genau an der Grenze: 30 Einzelverse einer Ausgabe ohne Wortlaut-Grenze.
    vielGenauMax: ["bible_lookup_many", {
      translation: "LUT",
      stellen: Array.from({ length: MAX_STELLEN }, (_, i) => ({ book: "Joh", chapter: 3, verses: String(i + 1) })),
    }],
    // Eine Zeichenkette statt eines Objekts scheitert als Eintrag, nicht als Abruf.
    vielKeinObjekt: ["bible_lookup_many", {
      translation: "LUT",
      stellen: ["Joh 3,16", { book: "Joh", chapter: 3, verse: 16 }],
    }],
    // Der Apparat reist je Eintrag mit. Geprüft wird die Gestalt, nie der Text.
    vielApparat: ["bible_lookup_many", {
      translation: "SLT",
      stellen: [{ book: "Joh", chapter: 3, verses: "16" }, { book: "Joh", chapter: 3, verses: "17" }],
    }],
  },
  pruefe({ res }) {
    const { vielGemischt, einzelJoh316, vielGrenze, vielZweiAusgaben } = res;

    // --- gemischter Abruf ---
    eq("gemischt: kein Fehler", vielGemischt.isError, false);
    const g = eintraege(vielGemischt.json);
    eq("gemischt: ein Eintrag je Anfrage", g.length, 6);
    check("gemischt: Reihenfolge der Anfrage", g.every((e, i) => e.nr === i + 1));
    eq("gemischt: angefragt", vielGemischt.json?.angefragt, 6);
    eq("gemischt: geliefert", vielGemischt.json?.geliefert, 4);
    eq("gemischt: fehlgeschlagen", vielGemischt.json?.fehlgeschlagen, 2);
    eq("gemischt: ohne_wortlaut", vielGemischt.json?.ohne_wortlaut, 0);
    eq("gemischt: Eintrag 1 trägt den Text des Einzelabrufs", g[0]?.text, einzelJoh316.json?.text);
    eq("gemischt: Eintrag 1 trägt dieselbe reference", g[0]?.reference, einzelJoh316.json?.reference);
    eq("gemischt: Eintrag 1 trägt dieselbe kurzref", g[0]?.kurzref, einzelJoh316.json?.kurzref);
    eq("gemischt: Vorgabe-Ausgabe gilt, wo der Eintrag keine nennt", g[0]?.translation, "Luther 1912");
    eq("gemischt: die Ausgabe des Eintrags geht vor", g[3]?.translation, "Elberfelder 1871");
    // Ein gescheiterter Eintrag trägt dieselbe Meldung wie der Einzelabruf und
    // keinen Text; die übrigen bleiben unberührt.
    check("gemischt: unbekanntes Buch als Eintragsfehler", String(g[4]?.fehler ?? "").includes("ist kein Buch dieser Bibel-Datenbank"));
    eq("gemischt: Eintragsfehler nennt die Anfrage", g[4]?.anfrage, "Xyzbuch 1");
    eq("gemischt: Vers gibt es nicht", g[5]?.fehler, "No verses found for Joh 3,150. Check chapter and verse numbers.");
    check("gemischt: gescheiterte Einträge ohne text", !("text" in (g[4] ?? {})) && !("text" in (g[5] ?? {})));
    has("gemischt: hinweis zählt die Fehlgriffe", hint(vielGemischt.json), "2 der 6 Stellen ließen sich nicht nachschlagen");
    // Derselbe Satz zur Verszählung gilt beiden Einträgen aus Psalm 22 und steht
    // einmal da, mit beiden Stellen davor.
    const hinweis = hint(vielGemischt.json);
    has("gemischt: Zählungssatz nennt beide Stellen", hinweis, "Zu Ps 22,2; Ps 22,25: Die geführten Ausgaben zählen dieses Kapitel verschieden");
    eq("gemischt: Zählungssatz steht einmal", hinweis.split("zählen dieses Kapitel verschieden").length - 1, 1);
    // Quellen als Vereinigung, jede Ausgabe einmal, keine für einen Fehlgriff.
    const werke = ((vielGemischt.json?.quellen ?? []) as Array<{ werk?: unknown }>).map((q) => q.werk);
    eq("gemischt: zwei Quellen", werke.join(" | "), "Luther 1912 | Elberfelder 1871");
    lacks("gemischt: gemeinfreie Ausgaben ohne Nennungssatz", hinweis, "Nennung");
    check("gemischt: kein gekuerzt ohne Grenze", !("gekuerzt" in (vielGemischt.json ?? {})));

    // --- die Grenze über den Abruf ---
    eq("Grenze: kein Fehler", vielGrenze.isError, false);
    const k = eintraege(vielGrenze.json);
    eq("Grenze: erster Eintrag ganz", k[0]?.reference, "Psalter 119,1-15");
    check("Grenze: erster Eintrag ungekürzt", !("gekuerzt" in (k[0] ?? {})));
    eq("Grenze: zweiter Eintrag nennt, was er enthält", k[1]?.reference, "Johannes 3,14-18");
    eq(
      "Grenze: zweiter Eintrag nennt beide Zahlen",
      JSON.stringify(k[1]?.gekuerzt),
      JSON.stringify({ verse_gefunden: 8, verse_enthalten: 5 })
    );
    eq("Grenze: dritter Eintrag ohne Wortlaut", k[2]?.ohne_wortlaut, true);
    check("Grenze: dritter Eintrag ohne text und ohne reference", !("text" in (k[2] ?? {})) && !("reference" in (k[2] ?? {})));
    eq("Grenze: dritter Eintrag nennt die Anfrage", k[2]?.anfrage, "Röm 8,28");
    eq("Grenze: geliefert zählt nur Einträge mit Text", vielGrenze.json?.geliefert, 2);
    eq("Grenze: ohne_wortlaut gezählt", vielGrenze.json?.ohne_wortlaut, 1);
    eq(
      "Grenze: gekuerzt je Ausgabe, mit den Zahlen des Abrufs",
      JSON.stringify(vielGrenze.json?.gekuerzt),
      JSON.stringify([{ translation: "Schlachter 1951", verse_max: 20, im_wortlaut: 20, ohne_wortlaut: 4 }])
    );
    const grenzHinweis = hint(vielGrenze.json);
    has("Grenze: Satz nennt die Grenze über den Abruf", grenzHinweis, "höchstens 20 Verse im Wortlaut aus, über alle Stellen eines Abrufs zusammen");
    has("Grenze: Satz nennt beide Zahlen", grenzHinweis, "Enthalten sind 20 Verse, 4 weitere nicht");
    // Die Nennung einmal, gleich wie viele Einträge sie trifft.
    eq("Grenze: Nennungssatz steht einmal", grenzHinweis.split("die Nennung aus 'quellen' mitführen").length - 1, 1);
    eq("Grenze: eine Quelle", ((vielGrenze.json?.quellen ?? []) as unknown[]).length, 1);

    // --- die Grenze je Ausgabe ---
    const z = eintraege(vielZweiAusgaben.json);
    eq("zwei Ausgaben: Schlachter-Eintrag voll", z[0]?.reference, "Psalter 119,1-20");
    eq("zwei Ausgaben: Luther bleibt unberührt", z[1]?.reference, "Johannes 3,16");
    eq("zwei Ausgaben: zweiter Schlachter-Eintrag ohne Wortlaut", z[2]?.ohne_wortlaut, true);
    check("zwei Ausgaben: zweiter Schlachter-Eintrag ohne text", !("text" in (z[2] ?? {})));
    eq(
      "zwei Ausgaben: gekuerzt nennt allein die Schlachter 1951",
      JSON.stringify(vielZweiAusgaben.json?.gekuerzt),
      JSON.stringify([{ translation: "Schlachter 1951", verse_max: 20, im_wortlaut: 20, ohne_wortlaut: 1 }])
    );

    // --- Abweisungen ---
    eq("alle gescheitert: isError", res.vielAlleFehler.isError, true);
    has("alle gescheitert: nennt die Zahl", res.vielAlleFehler.text, "Keine der 2 Stellen ließ sich nachschlagen.");
    has("alle gescheitert: nennt jeden Grund mit Nummer", res.vielAlleFehler.text, "(2) Error: 'book' is required in every entry");
    for (const [name, r] of [
      ["ohne stellen", res.vielOhneStellen],
      ["leere Liste", res.vielLeereListe],
    ] as const) {
      eq(`${name}: isError`, r.isError, true);
      eq(
        `${name}: Meldung nennt die Form`,
        r.text,
        `Error: 'stellen' is required: an array of 1 to ${MAX_STELLEN} passages, each { book, chapter, verses?, translation? }`
      );
    }
    eq("zu viele: isError", res.vielZuViele.isError, true);
    eq("zu viele: Meldung nennt die Grenze", res.vielZuViele.text, `Error: 'stellen' must list at most ${MAX_STELLEN} passages per call`);
    eq("genau an der Grenze: kein Fehler", res.vielGenauMax.isError, false);
    eq("genau an der Grenze: alle geliefert", res.vielGenauMax.json?.geliefert, MAX_STELLEN);

    // --- Eintrag, der kein Objekt ist; `verse` statt `verses` ---
    const o = eintraege(res.vielKeinObjekt.json);
    eq("kein Objekt: der Abruf bleibt ein Erfolg", res.vielKeinObjekt.isError, false);
    eq(
      "kein Objekt: Eintragsfehler nennt die Form",
      o[0]?.fehler,
      "Error: each entry in 'stellen' must be an object { book, chapter, verses?, translation? }"
    );
    eq("verse im Eintrag: der eine Vers", o[1]?.reference, "Johannes 3,16");

    // --- Apparat je Eintrag ---
    // Nur mit der Ausgabe, die einen Apparat führt; ohne sie scheitern beide
    // Einträge an der nicht geladenen Ausgabe, und die Fälle entfallen.
    const mitApparat = res.vielApparat.isError === false;
    if (mitApparat) {
      const a = eintraege(res.vielApparat.json);
      check("Apparat: Eintrag mit Anmerkung trägt fussnoten", Array.isArray(a[0]?.fussnoten) && (a[0]?.fussnoten as unknown[]).length > 0);
      check("Apparat: Eintrag ohne Anmerkung trägt keine", !("fussnoten" in (a[1] ?? {})));
      has("Apparat: Nennungssatz einmal oben", hint(res.vielApparat.json), "die Nennung aus 'quellen' mitführen");
    }
  },
});

if (import.meta.main) {
  await fahre([lookupManyBuendel]);
  abschluss();
}
