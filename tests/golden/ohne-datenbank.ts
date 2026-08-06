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
import packageJson from "../../package.json";
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, lacks, abschluss } from "../lib/zusicherungen.ts";
import { NO_ERROR } from "../lib/mcp-client.ts";

const INTERNAL_ERROR = -32603;

export const ohneDatenbankBuendel = buendel({
  name: "ohne-datenbank",
  // Zwei Ebenen hoch: diese Datei liegt in tests/golden/.
  env: { BIBLE_DB_PATH: resolve(dirname(dirname(import.meta.dirname)), "tmp/gibt-es-nicht.db") },
  ohneNachpruefung: true,
  calls: {
    leerLookup: ["bible_lookup", { book: "Johannes", chapter: 3, verses: "16" }],
    // Der unbekannte Name gehört hierher und nicht zu `uebergreifend`: Mit
    // Datenbank ist er `-32602`, ohne sie fängt ihn die Sperre davor ab. Nur
    // dieses Bündel kann die zweite Hälfte dieser Absicht festhalten.
    leerUnbekannt: ["bible_nichtvorhanden", {}],
    // Das eine Werkzeug, das ohne Daten antwortet, statt auf die Sperre zu
    // laufen. Es steht bewusst VOR ihr, damit die Frage nach Fassung und
    // Bestand gerade dann beantwortet wird, wenn sie am naheliegendsten ist.
    leerServerInfo: ["bible_server_info", {}],
  },
  resources: {
    leerRessource: "bible://buecher",
  },
  pruefe({ res, ressourcen }, ctx) {
    const { leerLookup, leerUnbekannt, leerServerInfo } = res;
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

    // Die Reihenfolge im Dispatch, festgenagelt. Der Wurf für einen unbekannten
    // Namen liegt HINTER der Sperre, also bekommt er hier den Setup-Hinweis mit
    // `isError` statt `-32602`. Das ist entschieden, nicht zufällig: Wer die
    // Kette zu einem `switch` mit `default: throw` aufräumt, zieht den Wurf nach
    // vorn und kippt genau diese beiden Zeilen. Bis zum 06.08.2026 wurde der
    // Fall nur mit Datenbank gefahren, wo er die andere Hälfte zeigt.
    eq("unbekanntes Werkzeug ohne Datenbank: kein JSON-RPC-Fehler", leerUnbekannt.code, NO_ERROR);
    eq("unbekanntes Werkzeug ohne Datenbank: isError", leerUnbekannt.isError, true);
    has(
      "unbekanntes Werkzeug ohne Datenbank: bekommt den Setup-Hinweis",
      leerUnbekannt.text,
      "bible_setup mit bestaetigung"
    );

    // `bible_server_info` liegt vor der Sperre und antwortet.
    eq("bible_server_info ohne Datenbank: kein Fehler", leerServerInfo.isError, false);
    eq(
      "bible_server_info ohne Datenbank: nennt die Fassung",
      leerServerInfo.json?.version,
      packageJson.version
    );
    check(
      "bible_server_info ohne Datenbank: keine Übersetzung geladen",
      Array.isArray(leerServerInfo.json?.uebersetzungen) &&
        leerServerInfo.json.uebersetzungen.length === 0
    );
    // Auch der leere Bestand meldet keine Host-Details, und gerade hier ist die
    // Versuchung groß, den gesuchten Pfad in die Antwort zu schreiben.
    for (const verboten of ["/home/", "/Users/", "uptime", "hostname"]) {
      lacks(`bible_server_info ohne Datenbank: ${verboten}`, leerServerInfo.text, verboten);
    }

    // Ohne Daten trägt die Liste ein Werkzeug MEHR, nicht weniger: das einzige,
    // das den Zustand beheben kann. Über stdio, versteht sich; im HTTP-Modus
    // fällt es weg, was `tests/test-http.ts` misst.
    const namen = ctx.tools.map((t) => String(t.name));
    eq("tools/list ohne Datenbank: acht Werkzeuge", namen.length, 8);
    check("tools/list ohne Datenbank: bietet bible_setup an", namen.includes("bible_setup"));
  },
});

if (import.meta.main) {
  await fahre([ohneDatenbankBuendel]);
  abschluss();
}
