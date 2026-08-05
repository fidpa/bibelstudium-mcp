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
  },
  pruefe({ res }, ctx) {
    const { unbekanntesWerkzeug } = res;

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
