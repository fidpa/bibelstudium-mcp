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

const INVALID_PARAMS = -32602;

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
  },
  pruefe({ res }, ctx) {
    const { unbekanntesWerkzeug } = res;
    const { nennungLookup, nennungSuche, nennungXref, nennungFrei } = res;

    eq("sieben Werkzeuge gelistet", ctx.tools.length, 7);
    for (const t of ctx.tools) {
      const a = t.annotations as Json | undefined;
      eq(`${String(t.name)}: readOnlyHint`, a?.readOnlyHint, true);
      eq(`${String(t.name)}: openWorldHint`, a?.openWorldHint, false);
      check(`${String(t.name)}: kein destructiveHint`, a !== undefined && !("destructiveHint" in a));
    }

    // bible_setup steht hier nicht in der Liste (die Datenbank existiert), also
    // müssen alle sieben gelisteten Werkzeuge eines deklarieren.
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
        hinweis.includes("Namensnennung") && hinweis.includes("'quellen'"),
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
    // Gemeinfreie Ausgabe: kein Satz. Eine Auflage, die auch dort stünde, wo es
    // keine gibt, wäre eine falsche Aussage über die Lizenz.
    check(
      "gemeinfreie Ausgabe: keine Nennungspflicht behauptet",
      !String(nennungFrei.json?.hinweis ?? "").includes("Namensnennung"),
      `war "${String(nennungFrei.json?.hinweis ?? "")}"`
    );

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
