/**
 * Aufrufzähler des Servers, ausgegeben im Prometheus-Textformat.
 *
 * Beantwortet die eine Frage, die weder das Journal noch der vorgelagerte
 * Tunnel beantworten kann: welches Werkzeug wie oft benutzt wird. Der Tunnel
 * sieht ausschließlich `POST /mcp`, der Werkzeugname steht im Rumpf, und
 * protokolliert wird er nirgends.
 *
 * **Was hier bewusst nicht entsteht.** Gezählt werden Namen, nichts sonst:
 * keine Argumente, keine Bibelstelle, kein Suchbegriff, keine Ressourcen-URI,
 * keine Quelladresse, keine Sitzung. Abfragen an einen Bibeldienst lassen
 * Rückschlüsse auf religiöse Überzeugungen zu; ein Zähler ohne Bezugspunkt tut
 * das nicht, eine Zeile je Anfrage täte es. Deshalb ein Aggregat und kein Log.
 *
 * **Warum die erlaubten Label-Werte registriert werden.** Prompt- und
 * Ressourcennamen stehen in `server.ts`, und diese Datei wird von dort
 * importiert; sie zurückzuimportieren hieße, den Schnitt zwischen beiden
 * aufzugeben. Der Aufrufer meldet seine Namen deshalb einmal beim Start an, und
 * alles, was danach nicht dazugehört, wird auf `unbekannt` abgebildet. Das ist
 * keine Kosmetik: Der Endpunkt ist authlos, ein Aufrufer kann beliebige Namen
 * schicken, und jede fremde Zeichenkette wäre sonst eine neue Zeitreihe in der
 * Überwachung. Die Werkzeugnamen selbst stehen unten in dieser Datei, mit der
 * Begründung dort.
 *
 * Kein `console.log` in dieser Datei. Sie wird in den stdio-Prozess importiert,
 * und dort liegt auf stdout der JSON-RPC-Strom.
 */

/** Für ein Label, dessen Wert nicht registriert wurde. */
export const UNBEKANNT = "unbekannt";

/**
 * Die Werkzeugnamen, unter denen gezählt wird.
 *
 * Sie stehen hier und nicht in `server.ts`, obwohl die Werkzeuge dort
 * beschrieben sind, und zwar aus einem messbaren Grund: `server.ts` startet den
 * Server beim Import. Eine Testdatei, die sich die Liste von dort holte, zöge
 * einen laufenden Server samt geöffneter Datenbank in ihren eigenen Prozess
 * (beobachtet 18.08.2026) und verlöre damit ihre Datenunabhängigkeit. Diese
 * Datei hat keine Nebenwirkung, also ist sie der Ort.
 *
 * `bible_setup` gehört dazu, obwohl ein HTTP-Endpunkt es nicht anbietet: Über
 * stdio wird es aufgerufen, und ohne eigenen Namen liefe es unter `unbekannt`
 * und verfälschte dort die Zahl, die es zu lesen gilt.
 *
 * Dass die Liste zur tatsächlich angebotenen Werkzeugliste passt, sichert eine
 * Zusicherung in den Tests, nicht die Sorgfalt beim Ändern.
 */
export const WERKZEUG_NAMEN = [
  "bible_setup",
  "bible_lookup",
  "bible_original",
  "bible_crossrefs",
  "bible_concordance",
  "bible_search",
  "bible_compare",
  "bible_server_info",
] as const;

/**
 * Wie ein Werkzeugaufruf ausging.
 *
 * Vier Werte, weil dieser Server drei Antwortarten kennt und die vierte Lage
 * davon zu trennen ist: `ok` und `fehler` sind beides reguläre Antworten (ein
 * Ergebnis beziehungsweise eines mit `isError`), `abgewiesen` ist ein
 * JSON-RPC-Fehler, den der Server absichtlich wirft, und `ausnahme` ist alles
 * Übrige. Die letzten beiden zusammenzufassen verwischte den Unterschied
 * zwischen „ein Modell hat den Server falsch bedient" und „hier ist etwas
 * kaputt", und genau dieser Unterschied ist der Grund, überhaupt zu zählen.
 */
export type Ergebnis = "ok" | "fehler" | "abgewiesen" | "ausnahme";

const ERGEBNISSE: readonly Ergebnis[] = ["ok", "fehler", "abgewiesen", "ausnahme"];

/**
 * Ein Zähler je Metrik. Die Schlüssel sind die Label-Werte, bei zwei Labels
 * verbunden durch ein Leerzeichen: Ein registrierter Name enthält keines, die
 * Zerlegung beim Ausgeben ist damit eindeutig.
 */
const werkzeugAufrufe = new Map<string, number>();
const promptAufrufe = new Map<string, number>();
const ressourceAufrufe = new Map<string, number>();

const werkzeugNamen = new Set<string>();
const promptNamen = new Set<string>();
const ressourceArten = new Set<string>();

const TRENNER = " ";

/**
 * Registrierte Werte werden sofort auf 0 gesetzt, statt erst beim ersten
 * Aufruf zu erscheinen.
 *
 * Zwei Gründe, beide praktisch: Eine Kachel zeigt sonst „No data" statt einer
 * belegten Null, und `increase()` braucht einen früheren Messpunkt, um eine
 * Zunahme überhaupt ausweisen zu können. Der erste Aufruf eines selten
 * benutzten Werkzeugs bliebe damit unsichtbar.
 */
function grundstellung(zaehler: Map<string, number>, schluessel: string[]): void {
  for (const s of schluessel) zaehler.set(s, 0);
}

export function registriereWerkzeuge(namen: readonly string[]): void {
  for (const name of [...namen, UNBEKANNT]) werkzeugNamen.add(name);
  grundstellung(
    werkzeugAufrufe,
    [...werkzeugNamen].flatMap((name) => ERGEBNISSE.map((e) => `${name}${TRENNER}${e}`))
  );
}

export function registrierePrompts(namen: readonly string[]): void {
  for (const name of [...namen, UNBEKANNT]) promptNamen.add(name);
  grundstellung(promptAufrufe, [...promptNamen]);
}

export function registriereRessourcen(arten: readonly string[]): void {
  for (const art of [...arten, UNBEKANNT]) ressourceArten.add(art);
  grundstellung(ressourceAufrufe, [...ressourceArten]);
}

function hoch(zaehler: Map<string, number>, schluessel: string): void {
  zaehler.set(schluessel, (zaehler.get(schluessel) ?? 0) + 1);
}

/** Fremde Namen fallen auf `unbekannt`, siehe Dateikopf. */
function bekannt(erlaubt: Set<string>, name: string): string {
  return erlaubt.has(name) ? name : UNBEKANNT;
}

export function zaehleWerkzeug(name: string, ergebnis: Ergebnis): void {
  hoch(werkzeugAufrufe, `${bekannt(werkzeugNamen, name)}${TRENNER}${ergebnis}`);
}

export function zaehlePrompt(name: string): void {
  hoch(promptAufrufe, bekannt(promptNamen, name));
}

export function zaehleRessource(art: string): void {
  hoch(ressourceAufrufe, bekannt(ressourceArten, art));
}

/**
 * Von Hand erzeugt, ohne Client-Bibliothek.
 *
 * Dieses Repository hat eine einzige Laufzeit-Abhängigkeit, das MCP-SDK, und
 * drei Zähler rechtfertigen keine zweite. Was eine Bibliothek zusätzlich
 * brächte, ist vor allem das Maskieren von Label-Werten; hier stammt jeder Wert
 * aus einer registrierten Liste oder ist `unbekannt`, enthält also weder
 * Anführungszeichen noch Zeilenumbruch noch Rückstrich.
 *
 * Format: https://prometheus.io/docs/instrumenting/exposition_formats/
 */
export function metrikenText(): string {
  const zeilen: string[] = [];

  zeilen.push(
    "# HELP bibelstudium_mcp_werkzeug_aufrufe_total Werkzeugaufrufe nach Name und Ausgang.",
    "# TYPE bibelstudium_mcp_werkzeug_aufrufe_total counter"
  );
  for (const [schluessel, wert] of [...werkzeugAufrufe].sort()) {
    const teile = schluessel.split(TRENNER);
    zeilen.push(
      `bibelstudium_mcp_werkzeug_aufrufe_total{werkzeug="${teile[0]}",ergebnis="${teile[1]}"} ${wert}`
    );
  }

  zeilen.push(
    "# HELP bibelstudium_mcp_prompt_aufrufe_total Prompt-Abrufe, geglückte wie gescheiterte.",
    "# TYPE bibelstudium_mcp_prompt_aufrufe_total counter"
  );
  for (const [name, wert] of [...promptAufrufe].sort()) {
    zeilen.push(`bibelstudium_mcp_prompt_aufrufe_total{prompt="${name}"} ${wert}`);
  }

  zeilen.push(
    "# HELP bibelstudium_mcp_ressource_aufrufe_total Ressourcenabrufe nach Art, nie nach URI.",
    "# TYPE bibelstudium_mcp_ressource_aufrufe_total counter"
  );
  for (const [art, wert] of [...ressourceAufrufe].sort()) {
    zeilen.push(`bibelstudium_mcp_ressource_aufrufe_total{art="${art}"} ${wert}`);
  }

  // Abschließender Zeilenumbruch, das Ausstellungsformat verlangt ihn.
  return zeilen.join("\n") + "\n";
}
