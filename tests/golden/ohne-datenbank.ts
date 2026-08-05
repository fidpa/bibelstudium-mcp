/**
 * Der Fehler des Servers selbst: eine Instanz ohne Datenbank.
 *
 * Sie ist der Grund, warum hier ein zweiter Serverprozess läuft. Eine fehlende
 * Datenbank ist ein Zustand des Servers und kein Fehler der Anfrage, und das ist
 * die einzige Abweisung, die `InternalError` behält: `-32602` gilt für alles,
 * was an der Anfrage falsch ist, `-32603` allein hierfür. Zugleich ist es der
 * Fall, den ein späterer Durchgang über die Wurfstellen am ehesten mit
 * umstellte, und deshalb ist er hier festgenagelt.
 *
 * Ohne die Nachprüfung der übrigen Bündel: Die eine Antwort ist ein Fehler, und
 * `structuredContent` gibt es zu Recht nicht.
 *
 * Einzeln lauffähig: `bun run tests/golden/ohne-datenbank.ts`
 */
import { resolve, dirname } from "node:path";
import { buendel, fahre } from "../lib/buendel.ts";
import { eq, has, abschluss } from "../lib/zusicherungen.ts";
import { NO_ERROR } from "../lib/mcp-client.ts";

const INTERNAL_ERROR = -32603;

export const ohneDatenbankBuendel = buendel({
  name: "ohne-datenbank",
  // Zwei Ebenen hoch: diese Datei liegt in tests/golden/.
  env: { BIBLE_DB_PATH: resolve(dirname(dirname(import.meta.dirname)), "tmp/gibt-es-nicht.db") },
  ohneNachpruefung: true,
  calls: {
    leerLookup: ["bible_lookup", { book: "Johannes", chapter: 3, verses: "16" }],
  },
  resources: {
    leerRessource: "bible://buecher",
  },
  pruefe({ res, ressourcen }, ctx) {
    const { leerLookup } = res;
    const { leerRessource } = ressourcen;

    eq("Ressource ohne Datenbank: InternalError", leerRessource.code, INTERNAL_ERROR);
    has(
      "Ressource ohne Datenbank: nennt bible_setup (stdio)",
      leerRessource.error,
      "bible_setup"
    );
    // Die Werkzeugsperre antwortet über `isError`, wie sie es mit Datenbank auch tut.
    eq("Werkzeug ohne Datenbank: bleibt isError", leerLookup.isError, true);
    eq("Werkzeug ohne Datenbank: kein JSON-RPC-Fehler", leerLookup.code, NO_ERROR);
    // Beide Listen sind leer, es wird also nichts angeboten, was sich nicht lesen lässt.
    eq("resources/list ohne Datenbank: leer", ctx.resourceList.length, 0);
    eq("resources/templates/list ohne Datenbank: leer", ctx.templateList.length, 0);
  },
});

if (import.meta.main) {
  await fahre([ohneDatenbankBuendel]);
  abschluss();
}
