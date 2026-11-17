/**
 * Was für alle Werkzeuge zugleich gilt: die Serveroberfläche.
 *
 * Hierher gehört, was kein einzelnes Werkzeug allein aussagen kann. Die
 * Annotationen, weil die Vorgabewerte der Spezifikation (`readOnlyHint: false`,
 * `openWorldHint: true`) auf keines dieser Werkzeuge zutreffen und deshalb an
 * jedem stehen müssen. Die Schemadeklaration, weil ein Werkzeug, das sein
 * `outputSchema` still verlöre, aus der Nachprüfung des Runners einfach
 * herausfiele und seine Prüfungen mitnähme. Und der eine Aufruf, der kein
 * Werkzeugfehler ist, sondern ein JSON-RPC-Fehler.
 *
 * Einzeln lauffähig: `bun run tests/golden/uebergreifend.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, abschluss, type Json } from "../lib/zusicherungen.ts";
import { isRecord } from "../schema-validator.ts";
import { INVALID_PARAMS } from "../lib/mcp-client.ts";
import { handleCompare } from "../../src/handlers/compare.ts";
import { handleConcordance } from "../../src/handlers/concordance.ts";
import { handleCrossrefs } from "../../src/handlers/crossrefs.ts";
import { handleLookup } from "../../src/handlers/lookup.ts";
import { handleOriginal } from "../../src/handlers/original.ts";
import { handleSearch } from "../../src/handlers/search.ts";
import { fehlerKlasseVon, istLeeresErgebnis } from "../../src/werkzeug-helfer.ts";


/**
 * Die beiden Nennungswortlaute, die nicht wir formulieren, sondern der
 * Rechteinhaber vorgibt: bei der Schlachter 2000 der Verlagsvermerk aus dem
 * Lizenzvertrag, bei der Schlachter 1951 die Angabe, die CC BY 4.0 mit dem
 * Text weiterzugeben verlangt. Bei beiden ist eine Abweichung kein Schönheits-
 * fehler, sondern ein Verstoß gegen die Bedingung, unter der die Ausgabe
 * überhaupt ausgeliefert werden darf.
 *
 * Sie stehen hier als Literal und **nicht** als Import aus `translations.ts`:
 * Ein Vergleich gegen die Quelle, die er prüfen soll, ist immer grün und sichert
 * nichts. Wer den Wortlaut dort ändert, muß ihn hier zweitschreiben, und genau
 * das ist der Zweck. Vorlage ist das unterzeichnete Papier, nicht der Code.
 *
 * Exportiert, weil `ressourcen.ts` dieselbe Tabelle braucht: Die beiden
 * Textressourcen geben denselben Wortlaut aus wie `bible_lookup`, und eine
 * dritte Handschrift derselben zwei Zeichenketten liefe von dieser weg. Der
 * Zweck bleibt gewahrt, denn geprüft wird `translations.ts`, und von dort
 * kommt hier nichts.
 */
export const VORGESCHRIEBENE_NENNUNG: Record<string, string> = {
  "Schlachter 2000":
    "Bibeltext der Schlachter, Copyright 2000 © Genfer Bibelgesellschaft. " +
    "Wiedergegeben mit freundlicher Genehmigung. Alle Rechte vorbehalten.",
  "Schlachter 1951":
    "Die Heilige Schrift, Schlachter 1951, © 1951 Genfer Bibelgesellschaft " +
    "(Geneva Bible Society), bereitgestellt unter CC BY 4.0, " +
    "https://creativecommons.org/licenses/by/4.0/, Lizenzerklärung " +
    "https://ebible.org/deu1951/copyright.htm",
};

export const uebergreifendBuendel = buendel({
  name: "uebergreifend",
  calls: {
    // Der eine Werkzeugaufruf, der kein Werkzeugfehler ist, sondern ein
    // JSON-RPC-Fehler: `isError` braucht ein Werkzeug, das es trägt, und hier
    // gibt es keines.
    unbekanntesWerkzeug: ["bible_nichtvorhanden", {}],
    // Die Nennungspflicht gilt an drei Werkzeugen zugleich, weil alle drei
    // Wortlaut ausgeben, und sie hängt an der Ausgabe, nicht am Werkzeug. Ein
    // Aufruf je Werkzeug mit einer nennungspflichtigen Ausgabe, dazu die
    // Gegenprobe mit einer gemeinfreien: Ein Satz, der überall stünde, wäre
    // dasselbe Rauschen wie einer, der nirgends steht.
    nennungLookup: ["bible_lookup", { book: "Joh", chapter: 3, verses: "16", translation: "SLT" }],
    nennungSuche: ["bible_search", { query: "Gnade", translation: "SCH", limit: 3 }],
    nennungXref: ["bible_crossrefs", { book: "Joh", chapter: 3, verse: 16, limit: 3, translation: "SLT" }],
    nennungFrei: ["bible_lookup", { book: "Joh", chapter: 3, verses: "16", translation: "LUT" }],
    // `bible_lookup` nennt sein Argument `verses`, die drei Einzelvers-Werkzeuge
    // nennen es `verse`. Wer beide nacheinander benutzt, verwechselt sie (zwei
    // von fünf Aufrufen einer Prüfreihe, 02.09.2026). Jedes der vier nimmt
    // deshalb das Argument der anderen an, wenn sein eigenes fehlt.
    versLookup: ["bible_lookup", { book: "Joh", chapter: 3, verse: 16, translation: "LUT" }],
    versOriginal: ["bible_original", { book: "Joh", chapter: 3, verses: "16" }],
    versXref: ["bible_crossrefs", { book: "Joh", chapter: 3, verses: "16", limit: 1, translation: "LUT" }],
    versCompare: ["bible_compare", { book: "Joh", chapter: 3, verses: 16 }],
    // Das eigene Argument geht vor.
    versBeide: ["bible_original", { book: "Joh", chapter: 3, verse: 16, verses: "17" }],
    // Eine Spanne ist lesbar, passt aber nicht zum Werkzeug: eigene Meldung
    // statt „must be an integer". Nicht an `bible_original` geprüft: Das nimmt
    // seit 0.7.0 selbst eine Spanne an.
    versSpanne: ["bible_crossrefs", { book: "Joh", chapter: 3, verses: "16-17" }],
    versListe: ["bible_compare", { book: "Joh", chapter: 3, verses: "16,18" }],
  },
  pruefe({ res }, ctx) {
    const { unbekanntesWerkzeug } = res;
    const { nennungLookup, nennungSuche, nennungXref, nennungFrei } = res;

    eq("neun Werkzeuge gelistet", ctx.tools.length, 9);
    for (const t of ctx.tools) {
      const a = t.annotations as Json | undefined;
      eq(`${String(t.name)}: readOnlyHint`, a?.readOnlyHint, true);
      eq(`${String(t.name)}: openWorldHint`, a?.openWorldHint, false);
      check(`${String(t.name)}: kein destructiveHint`, a !== undefined && !("destructiveHint" in a));
    }

    // bible_setup steht hier nicht in der Liste (die Datenbank existiert), also
    // müssen alle neun gelisteten Werkzeuge eines deklarieren.
    for (const t of ctx.tools) {
      check(`${String(t.name)}: outputSchema deklariert`, isRecord(t.outputSchema));
    }

    // Die Nennung selbst steht seit je in `quellen`. Dass sie mitgehen muss, stand
    // nirgends, und ein fremder Client übernahm sie deshalb nicht (06.08.2026, ein
    // Dokument mit rund einem Dutzend Zitaten der Schlachter 2000). Geprüft wird
    // der Ort, nicht nur das Vorhandensein: `hinweis` ist das Feld, dem derselbe
    // Client durchgehend folgte.
    for (const [name, r] of [
      ["bible_lookup", nennungLookup],
      ["bible_search", nennungSuche],
      ["bible_crossrefs", nennungXref],
    ] as const) {
      const hinweis = String(r.json?.hinweis ?? "");
      check(
        `${name}: Nennungspflicht steht im hinweis`,
        hinweis.includes("die Nennung aus 'quellen' mitführen"),
        `war "${hinweis}"`
      );
      // Der Satz verweist auf die Nennung, statt sie zu wiederholen: Sie ist bei
      // der Schlachter 1951 rund 180 Zeichen lang, und zweimal dasselbe in jeder
      // Antwort ist der Anfang davon, dass beides überlesen wird.
      const q = (r.json?.quellen ?? []) as Array<{ nennung?: unknown }>;
      check(
        `${name}: Nennung steht genau einmal in der Antwort`,
        q.some((e) => typeof e.nennung === "string") &&
          !q.some((e) => typeof e.nennung === "string" && hinweis.includes(e.nennung))
      );
    }
    // Der Ort allein genügt nicht: Eine Nennung an der richtigen Stelle, aber im
    // falschen Wortlaut, erfüllt die Auflage nicht. Geprüft wird deshalb
    // zeichengenau gegen die Tabelle oben, je Ausgabe an dem Aufruf, der sie
    // führt. Bis 0.6.30 gab es diese Prüfung nicht, und der ausgelieferte
    // Vermerk der Schlachter 2000 wich vom vorgeschriebenen ab, ohne daß ein
    // Lauf davon rot wurde.
    for (const [name, r] of [
      ["Schlachter 2000", nennungLookup],
      ["Schlachter 1951", nennungSuche],
    ] as const) {
      const q = (r.json?.quellen ?? []) as Array<{ werk?: unknown; nennung?: unknown }>;
      const eintrag = q.find((e) => e.werk === name);
      eq(
        `${name}: Nennung im vorgeschriebenen Wortlaut`,
        eintrag?.nennung,
        VORGESCHRIEBENE_NENNUNG[name]
      );
    }

    // Gemeinfreie Ausgabe: kein Satz. Eine Auflage, die auch dort stünde, wo es
    // keine gibt, wäre eine falsche Aussage über die Lizenz.
    check(
      "gemeinfreie Ausgabe: keine Nennungspflicht behauptet",
      !String(nennungFrei.json?.hinweis ?? "").includes("Nennung"),
      `war "${String(nennungFrei.json?.hinweis ?? "")}"`
    );

    // `verse` und `verses`, in beide Richtungen.
    eq("bible_lookup mit verse: kein Fehler", res.versLookup.isError, false);
    eq("bible_lookup mit verse: der eine Vers, nicht das Kapitel", res.versLookup.json?.reference, "Johannes 3,16");
    for (const [name, r] of [
      ["bible_original", res.versOriginal],
      ["bible_crossrefs", res.versXref],
      ["bible_compare", res.versCompare],
    ] as const) {
      eq(`${name} mit verses: kein Fehler`, r.isError, false);
      eq(`${name} mit verses: derselbe Vers`, r.json?.reference, "Johannes 3,16");
    }
    eq("verse und verses zugleich: das eigene Argument gilt", res.versBeide.json?.reference, "Johannes 3,16");
    for (const [name, r] of [
      ["Spanne", res.versSpanne],
      ["Liste", res.versListe],
    ] as const) {
      eq(`${name} an einem Einzelvers-Werkzeug: isError`, r.isError, true);
      eq(
        `${name} an einem Einzelvers-Werkzeug: Meldung nennt den Einzelvers`,
        r.text,
        "Error: this tool takes exactly one verse; pass a single number in 'verse', not a range or list"
      );
    }

    // Die Klasse eines Fehlers reist nicht über die Leitung, sie hängt am
    // Ergebnisobjekt und wird nur gezählt. Über den Server ist sie deshalb nicht
    // zu sehen, und `test-http.ts` kennt nur die eine Klasse, die ohne Datenbank
    // entsteht. Geprüft wird hier im Prozess, je Klasse an mindestens einem
    // Handler: Eine vertauschte Klasse fiele sonst in keinem Lauf auf, und die
    // Zahlen der Überwachung wären falsch, ohne dass etwas rot würde.
    const klassen: Array<[string, object, string]> = [
      ["lookup ohne Buch", handleLookup({ chapter: 3 }), "eingabe"],
      ["lookup, Kapitel außerhalb", handleLookup({ book: "Joh", chapter: 999 }), "eingabe"],
      ["lookup, unlesbare Versliste", handleLookup({ book: "Joh", chapter: 3, verses: "abc" }), "eingabe"],
      ["lookup, unbekanntes Buch", handleLookup({ book: "Xyzbuch", chapter: 1 }), "buch"],
      ["lookup, apokryphes Buch", handleLookup({ book: "Tobit", chapter: 1 }), "buch"],
      ["lookup, Vers gibt es nicht", handleLookup({ book: "Ps", chapter: 117, verses: "5" }), "stelle"],
      ["lookup, unbekannte Ausgabe", handleLookup({ book: "Joh", chapter: 3, translation: "XXX" }), "ausgabe"],
      ["original ohne Vers", handleOriginal({ book: "Joh", chapter: 3 }), "eingabe"],
      ["original, Vers gibt es nicht", handleOriginal({ book: "3. Johannes", chapter: 1, verse: 15 }), "stelle"],
      ["original, ungültiger texttyp", handleOriginal({ book: "Joh", chapter: 3, verse: 16, texttyp: "quatsch" }), "ausgabe"],
      ["original, unbekanntes Buch", handleOriginal({ book: "Xyzbuch", chapter: 1, verse: 1 }), "buch"],
      ["compare am AT", handleCompare({ book: "1. Mose", chapter: 1, verse: 1 }), "eingabe"],
      ["compare, Vers gibt es nicht", handleCompare({ book: "Joh", chapter: 3, verse: 150 }), "stelle"],
      ["crossrefs ohne Vers", handleCrossrefs({ book: "Joh", chapter: 3 }), "eingabe"],
      ["crossrefs, Vers gibt es nicht", handleCrossrefs({ book: "Joh", chapter: 3, verse: 150 }), "stelle"],
      ["search ohne Ausdruck", handleSearch({}), "eingabe"],
      ["search, unbekanntes Buch", handleSearch({ query: "Gnade", book: "Xyzbuch" }), "buch"],
      ["concordance ohne Angabe", handleConcordance({}), "eingabe"],
      ["concordance, unbekanntes Wort", handleConcordance({ strong: "G99999" }), "stelle"],
      ["concordance, Strong gegen sblgnt", handleConcordance({ strong: "G26", texttyp: "sblgnt" }), "ausgabe"],
      ["concordance, ungültiger texttyp", handleConcordance({ strong: "G26", texttyp: "quatsch" }), "ausgabe"],
    ];
    for (const [name, ergebnis, erwartet] of klassen) {
      eq(`Fehlerklasse: ${name}`, fehlerKlasseVon(ergebnis), erwartet);
    }
    // Ein Erfolg trägt keine Klasse, und nur ein Erfolg ohne Fund trägt die
    // Marke `leer`; ein Fehler trägt sie nie.
    const erfolg = handleLookup({ book: "Joh", chapter: 3, verses: "16", translation: "LUT" });
    eq("Erfolg: keine Fehlerklasse", fehlerKlasseVon(erfolg), undefined);
    eq("Erfolg mit Fund: nicht leer", istLeeresErgebnis(erfolg), false);
    eq("Suche ohne Treffer: leer", istLeeresErgebnis(handleSearch({ query: "Xyzzyfoo", translation: "LUT" })), true);
    eq("Wort ohne Vorkommen: leer", istLeeresErgebnis(handleConcordance({ strong: "G168" })), true);
    eq("Vers ohne Querverweis: leer", istLeeresErgebnis(handleCrossrefs({ book: "1. Mose", chapter: 1, verse: 13 })), true);
    eq("Fehler: nicht leer", istLeeresErgebnis(handleSearch({})), false);

    // Ein Werkzeug, das es nicht gibt, hat keinen `isError`-Kanal, durch den es antworten könnte.
    eq("unbekanntes Werkzeug: InvalidParams", unbekanntesWerkzeug.code, INVALID_PARAMS);
    eq(
      "unbekanntes Werkzeug: Meldung nennt den Namen",
      unbekanntesWerkzeug.error,
      "Unknown tool: bible_nichtvorhanden"
    );
  },
});

if (import.meta.main) {
  await fahre([uebergreifendBuendel]);
  abschluss();
}
