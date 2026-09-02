/**
 * Der HTTP-Transport dieses Servers: CORS, Herkunftsprüfung, `/health`, die
 * Methodenweiche, die Protokoll-Telemetrie und der eigene Metrik-Port.
 *
 * **Warum das hier liegt und nicht mehr im Bootstrap von `server.ts`.** Der
 * Transport muss von den Werkzeugen nichts wissen. Er nimmt eine Anfrage
 * entgegen, entscheidet über Herkunft, Pfad und Methode und reicht den Rest
 * weiter; welche Werkzeuge es gibt, was sie zurückgeben und wie ihre Schemata
 * aussehen, geht ihn nichts an. Getrennt ist diese Grenze nachprüfbar: Aus
 * `server.ts` kommt genau ein Symbol herein, und aus den Nachbarmodulen zwei
 * Namen für die Datenbankfrage und einer für die Metriktexte.
 *
 * **`createServer` wird hereingereicht, nicht importiert.** Ein Import ginge in
 * die falsche Richtung: `server.ts` ruft `serveHttp` auf, und ein Rückimport von
 * dort wäre ein Zyklus und zugleich der Beweis, dass der Schnitt falsch liegt.
 * Es ist außerdem eine **Fabrik** und kein Server, weil jede Anfrage ihre eigene
 * Instanz bekommt; die Begründung dafür steht unten am Aufrufort.
 *
 * Was hier steht, ist keine Geschmacksfrage: Jede Weiche unten geht auf einen
 * Vorfall oder eine Messung zurück, und die Daten stehen jeweils daneben.
 *
 * Kein `console.log` in dieser Datei. Sie wird in den stdio-Prozess importiert,
 * und dort liegt auf stdout der JSON-RPC-Strom.
 */
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { dataMissing, db } from "./db.ts";
import { metrikenText } from "./metriken.ts";

/**
 * Die Fabrik, die je Anfrage eine frische Server-Instanz liefert.
 *
 * Als Typ hier und nicht als Import von `server.ts`: siehe Kopf dieser Datei.
 */
export type ServerFabrik = () => Server;

/**
 * HTTP-Modus, zuzuschalten über MCP_HTTP_PORT. Ohne die Variable spricht der
 * Server stdio wie bisher; lokale Clients und `bun run test` sind also nicht
 * betroffen.
 *
 * Gebunden wird an 127.0.0.1, sofern MCP_HTTP_HOST nichts anderes sagt. Diese
 * Vorgabe ist der sicherheitsrelevante Teil: Diesen Server von außen zu
 * erreichen soll einen bewussten Schritt verlangen (einen Tunnel oder einen
 * Reverse Proxy, der TLS abschließt) und nie eine vergessene Voreinstellung.
 * Den Port unmittelbar zu veröffentlichen gäbe zudem die Adresse der Maschine
 * preis, und weder TLS noch Zugriffsschutz bringt der Server mit.
 *
 * Zustandslos: `Server` bindet einen einzigen Transport, jede Anfrage bekommt
 * deshalb aus createServer() ihre eigene Instanz. Datenbank und alle
 * vorbereiteten Statements bleiben auf Modulebene geteilt, eine Anfrage kostet
 * also kaum mehr als das Verdrahten der Handler.
 */
// --- Kopfzeilen, Methoden, Herkunft ---------------------------------------

// CORS, damit auch browserbasierte Clients den Endpunkt nutzen können. Für
// MCP-Clients ohne Browser ist es folgenlos: die schicken keinen Origin. Kein
// Widerspruch zur Origin-Prüfung unten: Die entscheidet, WER antworten
// bekommt, diese Kopfzeilen sagen dem Browser nur, was er damit tun darf.
//
// 'expose' nennt die Sitzungs-ID aus der Zeit vor dem zustandslosen Umbau.
// Dieser Server vergibt keine und sendet die Kopfzeile nie, ein Browser bekommt
// hier also nichts freigegeben, was es gibt. Die Zeile steht folgenlos und wird
// mit dem Umstieg auf die Revision 2026-07-28 fällig, die das Feld ganz
// streicht ("do not mint or echo session IDs").
const CORS_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  // Die Antwort hängt vom Origin ab (200 oder 403): `vary` sagt das jedem
  // Zwischenspeicher, `no-store` nimmt ihm die Gelegenheit ganz. Heute nicht
  // ausnutzbar (Cloudflare speichert application/json nicht von sich aus),
  // aber die Bauart, die später leckt (02.09.2026).
  "vary": "origin",
  "cache-control": "no-store",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};

/**
 * Die erlaubten Methoden je Pfad, und zwar genau einmal hingeschrieben.
 *
 * Sie erscheinen an zwei Stellen, die auseinanderlaufen können und es hier
 * bereits taten: in `Allow` einer 405 (von RFC 9110 verlangt) und in
 * `access-control-allow-methods` der Vorabanfrage. Am 03.08.2026 meldete
 * derselbe Pfad drei verschiedene Listen: `GET /mcp` antwortete mit
 * `Allow: POST, OPTIONS`, `PUT` und `PATCH` bekamen vom SDK
 * `Allow: GET, POST, DELETE`, und die Vorabanfrage nannte
 * `GET, POST, DELETE, OPTIONS`. Aus einer Konstante gespeist kann das nicht
 * wieder vorkommen.
 *
 * Deshalb steht die Angabe auch nicht mehr in CORS_HEADERS: Die gilt für jede
 * Antwort, die Methodenliste aber je Pfad. Global gesetzt behauptete sie
 * zwangsläufig für einen der beiden Pfade etwas Falsches.
 */
const METHODS_MCP = "POST, OPTIONS";
const METHODS_HEALTH = "GET, HEAD, OPTIONS";
// Ohne OPTIONS: Der Metrik-Endpunkt spricht mit keinem Browser, es gibt dort
// keine Vorabanfrage zu beantworten.
const METHODS_METRIKEN = "GET, HEAD";

// --- Gesundheit und CORS-Hülle --------------------------------------------

/**
 * Warum /health die Datenbank abfragt, statt `dataMissing` zu melden.
 *
 * `dataMissing` wird einmal beim Start entschieden. Eine Datei, die im
 * laufenden Betrieb getauscht oder beschädigt wird, ließe den Wert auf `null`
 * stehen, und /health meldete weiter „ok" für einen Server, der keine einzige
 * Stelle mehr nachschlagen kann. Die billigste Abfrage, die den ganzen Weg als
 * funktionierend nachweist, ist eine Zeile aus der Tabelle, die jedes Werkzeug
 * braucht; sie kommt aus dem Seiten-Cache von SQLite und kostet Mikrosekunden,
 * eine Überwachung darf sie also regelmäßig aufrufen.
 *
 * Liefert null im gesunden Fall, sonst den Grund, damit der Aufrufer etwas hat,
 * das er in den Antwortrumpf legen kann.
 */
function healthProblem(): string | null {
  if (dataMissing !== null) return dataMissing;
  try {
    const row = db.query("SELECT COUNT(*) AS n FROM books").get() as { n: number } | null;
    if (row === null || row.n === 0) return "Die Datenbank antwortet, enthält aber keine Bücher.";
    return null;
  } catch (error) {
    return `Die Datenbank ist nicht lesbar: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * `methods` ist Pflicht und hat bewusst keinen Vorgabewert.
 *
 * Ein Vorgabewert würde genau den Fehler konservieren, den die Aufteilung
 * behebt: Eine vergessene Aufrufstelle bekäme stillschweigend eine
 * Methodenliste, die für ihren Pfad nicht gilt. So scheitert stattdessen der
 * Typecheck. `null` heißt „für diese Antwort gibt es keine Methodenliste" und
 * lässt die Kopfzeile weg; das ist der richtige Wert für 403 und 404, wo es
 * entweder keinen Pfad gibt oder der Aufrufer ihn nicht sehen soll.
 */
function withCors(response: Response, methods: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  if (methods !== null) headers.set("access-control-allow-methods", methods);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// --- Protokoll-Telemetrie -------------------------------------------------

/**
 * Warum der Endpunkt festhält, welche Protokollrevision seine Aufrufer sprechen.
 *
 * Die Revision 2026-07-28 hat `initialize` und die Sitzung abgeschafft: Ein
 * moderner Client trägt Version, Identität und Fähigkeiten im `_meta` jeder
 * Anfrage und spiegelt die Version in die Kopfzeile `MCP-Protocol-Version`.
 * Dieser Server läuft auf dem 1.x-SDK und spricht allein die Revisionen mit
 * Handschlag; nach der Verträglichkeitsmatrix der Spezifikation scheitert ein
 * moderner Client also entweder rundweg oder, schlimmer, bekommt eine in der
 * Ära mehrdeutige Methode unter der alten Bedeutung bedient: Der zustandslose
 * POST-Pfad nimmt Anfragen ohne Handschlag an, hier fiele es also niemandem
 * auf. Der Umstieg auf das v2-SDK ist eine Paketteilung samt Neufassung jeder
 * Handler-Registrierung; der Auslöser sollte deshalb ein gemessener Client sein
 * und kein Datum. Dies ist diese Messung.
 *
 * Eine Zeile je Protokollversion, nicht je Anfrage und nicht je Client. Der
 * Endpunkt ist öffentlich und authlos: Eine Zeile je Anfrage wäre ein
 * Zugriffsprotokoll, nach dem niemand gefragt hat, und ein müheloser Weg, das
 * Journal zu füllen. Die Menge ist gedeckelt, aus demselben Grund, aus dem die
 * Sitzungsregistratur verschwunden ist: Sie wächst mit Eingaben des Aufrufers,
 * und eine ungedeckelte ist genau das Leck, das dieser Server schon einmal
 * hatte.
 *
 * Nichts vom Aufrufer wird wörtlich geschrieben. Die Version wird gegen das
 * Format einer Revision geprüft, nicht bloß gesäubert, und der selbstgemeldete
 * Name des Clients wird gar nicht festgehalten. Beides folgt aus der
 * Datenschutzerklärung, die dieser Endpunkt veröffentlicht und die
 * Betriebsereignisse „ohne Personenbezug" zusagt: Ein Versprechen über freien
 * Text von Fremden hält immer nur das Wohlwollen ihrer Software, während ein
 * Wert, der vor dem Journal gegen `YYYY-MM-DD` geprüft wird, konstruktiv
 * gehalten ist. Sowohl die Kopfzeile `Mcp-Protocol-Version` als auch
 * `params.protocolVersion` bestimmt der Aufrufer, und in beide passt eine
 * Adresse oder ein Name.
 */
const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
/**
 * Die erste Revision, die Version und Identität je Anfrage trägt. Revisionen
 * heißen nach ISO-Daten, ein Zeichenkettenvergleich ordnet sie also, und `>=`
 * ist die Prüfung auf die Ära.
 */
const FIRST_MODERN_REVISION = "2026-07-28";
const MAX_PROTOCOL_SIGHTINGS = 20;
const protocolSightings = new Set<string>();
let modernLogged = false;

/** Steht für eine Angabe, die kein Revisionsname ist, damit kein solcher Wert ins Protokoll gerät. */
const UNKNOWN_REVISION = "unbekannte Angabe";

/**
 * Eine Protokollrevision heißt nach ihrem Erscheinungsdatum. Alles andere wird
 * abgewiesen statt gesäubert: Dies ist der einzige Wert aus der Anfrage, der ins
 * Journal gelangt, und deshalb lohnt es sich, ihn auf eine Form festzulegen, die
 * weder eine Botschaft noch eine Kennung noch ein Steuerzeichen tragen kann.
 */
function asRevision(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function noteProtocolVersion(request: Request, rumpf: unknown): void {
  // Der billige Weg, den jede Anfrage nimmt, sobald eine Version einmal gesehen
  // ist: ein Blick in die Kopfzeilen und einer in die Menge, ohne den Rumpf zu
  // lesen.
  const headerRevision = asRevision(request.headers.get("mcp-protocol-version"));

  // Sichtungen aus der modernen Ära fallen in eine einzige Zeile zusammen, die
  // älteren werden nach Version geführt. Das Brauchbare an einem modernen
  // Aufrufer ist, dass es ihn gibt, und nicht, welches Datum er nennt; sie nach
  // Version zu führen gäbe einem authlosen Aufrufer beides: eine Zeile je
  // erfundenem Zukunftsdatum und einen Weg, die echte Sichtung aus der
  // gedeckelten Menge zu verdrängen. Gemessen am 28.07.2026: Zwanzig
  // vorgetäuschte Daten erzeugten zwanzig Warnungen und verschluckten dann den
  // echten Client vom 2026-07-28.
  const headerModern = headerRevision !== null && headerRevision >= FIRST_MODERN_REVISION;
  if (headerModern && modernLogged) return;
  if (!headerModern) {
    if (headerRevision !== null && protocolSightings.has(headerRevision)) return;
    if (protocolSightings.size >= MAX_PROTOCOL_SIGHTINGS) return;
  }

  let bodyRevision: string | null = null;
  let modernMeta = false;
  let discover = false;

  // Der Rumpf kommt geparst herein (der Aufrufer liest ihn ohnehin für das
  // SDK); hier wird nichts mehr geklont oder geparst. Die Kopfzeile fehlt genau
  // bei einem alten `initialize` und bei Clients vor 2025-06-18, die sie nie
  // definiert haben.
  {
    const body = asRecord(rumpf);
    if (body !== null) {
      discover = body["method"] === "server/discover";
      const params = asRecord(body["params"]);
      if (params !== null) {
        // Alte Ära: `initialize` nennt die Version in params.
        bodyRevision = asRevision(params["protocolVersion"]);
        // Moderne Ära: Jede Anfrage nennt sie stattdessen in _meta.
        const meta = asRecord(params["_meta"]);
        if (meta !== null && typeof meta[META_PROTOCOL_VERSION] === "string") {
          modernMeta = true;
          bodyRevision = asRevision(meta[META_PROTOCOL_VERSION]);
        }
      }
    }
  }

  const revision = bodyRevision ?? headerRevision;
  // `server/discover` gibt es nur in der modernen Ära, die Methode bezeichnet sie
  // also auch dann, wenn ein Aufrufer die Version weglässt.
  const modern = modernMeta || discover || (revision !== null && revision >= FIRST_MODERN_REVISION);
  // Ein Aufrufer, der keine gültige Revision nennt, wird trotzdem gezählt, aber
  // unter einer festen Bezeichnung: Seine eigene Zeichenkette darf nicht ins
  // Journal.
  const shown = revision ?? UNKNOWN_REVISION;

  if (modern) {
    if (modernLogged) return;
    modernLogged = true;
  } else {
    if (protocolSightings.has(shown)) return;
    if (protocolSightings.size >= MAX_PROTOCOL_SIGHTINGS) return;
    protocolSightings.add(shown);
    if (headerRevision !== null) protocolSightings.add(headerRevision);
  }

  if (modern) {
    console.error(
      `MCP-Protokoll: ${shown} (zustandslose Revision). ` +
        "Dieser Server spricht sie nicht: er läuft auf dem 1.x-SDK und kennt nur " +
        "das initialize-Verfahren. Umstieg auf das v2-SDK prüfen."
    );
  } else {
    console.error(`MCP-Protokoll: ${shown} (initialize-Verfahren).`);
  }
}

// --- Der MCP-Port ---------------------------------------------------------

export async function serveHttp(port: number, createServer: ServerFabrik): Promise<void> {
  const host = process.env["MCP_HTTP_HOST"] ?? "127.0.0.1";
  // Browser-Herkünfte, die mit diesem Server sprechen dürfen. Voreingestellt
  // leer: MCP-Clients sind keine Browser und schicken überhaupt keinen Origin,
  // die strenge Vorgabe kostet also nichts. Gegen DNS-Rebinding schließt sie das
  // Loch für POST (Browser setzen Origin dort auch gleichursprünglich), nicht
  // für GET /health: Ein gleichursprüngliches GET trägt keinen Origin, und eine
  // Host-Prüfung gibt es hier nicht (aus der Fetch-Spezifikation abgeleitet,
  // 02.09.2026; bis dahin behauptete dieser Satz das Gegenteil). Ein Web-Client
  // lässt sich über MCP_HTTP_ALLOWED_ORIGINS ausdrücklich zulassen.
  const allowedOrigins = (process.env["MCP_HTTP_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");
  // Erlaubte `Host`-Werte, und zwar als Opt-in: Ungesetzt gibt es keinen
  // Abgleich. Eine strenge Vorgabe (nur 127.0.0.1:PORT) bräche den gehosteten
  // Dienst, denn cloudflared spricht 127.0.0.1:8931 mit dem öffentlichen
  // Hostnamen als `Host` an (kein `httpHostHeader` in seiner Konfiguration,
  // gemessen 02.09.2026); eine Vorgabe mit dem öffentlichen Namen bräche jeden
  // lokalen Aufruf. Gesetzt schließt der Abgleich das Loch, das die
  // Origin-Prüfung offenlässt: Ein gleichursprüngliches GET nach einer
  // DNS-Umbindung trägt keinen Origin, wohl aber den fremden Host. Vergleich
  // exakt und in Kleinbuchstaben, mit Port, wie der Client ihn schickt.
  const allowedHosts = (process.env["MCP_HTTP_ALLOWED_HOSTS"] ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== "");

  Bun.serve({
    port,
    hostname: host,
    idleTimeout: 120,
    // Bun nimmt sonst bis zu 128 MB je Rumpf an. Die größte legitime Anfrage
    // dieses Servers ist ein Werkzeugaufruf mit einer Bibelstelle, also einige
    // hundert Byte; 1 MB lässt jeden davon durch und nimmt einem anonymen
    // Aufrufer die Möglichkeit, Speicher über den JSON-Parser zu binden.
    maxRequestBodySize: 1024 * 1024,
    // Ohne das richtet sich der Modus nach NODE_ENV, und im Entwicklungsmodus
    // liefert Bun bei einer ungefangenen Ausnahme einen Stacktrace an den
    // Aufrufer aus. Heute fängt der SDK-Transport alle geprüften Fehlerpfade
    // sauber ab; die Zeile sorgt dafür, dass ein künftiges `throw` im Handler
    // nicht zum Informationsleck wird.
    development: false,
    async fetch(request) {
      const url = new URL(request.url);

      // Spezifikation: Server MÜSSEN den Origin prüfen, und zwar „on all
      // incoming connections". Die eigene Option des SDK dafür gilt als
      // überholt, zugunsten genau dieser Art äußerer Prüfung.
      //
      // Sie steht vor allem anderen, seit dem 03.08.2026. Vorher lag sie hinter
      // `/health` und hinter der Pfadprüfung, und damit war sie für `/health`
      // gar nicht wirksam: Eine beliebige Webseite konnte per JavaScript
      // erfahren, dass auf einem lokalen Port dieser Server läuft, und seinen
      // Zustand auslesen, den Grund einer Störung eingeschlossen. Genau das
      // Muster, gegen das die Prüfung in der Spezifikation steht.
      //
      // Am öffentlichen Endpunkt schützt sie wenig: Der ist absichtlich
      // authlos, es gibt kein Geheimnis zu erraten und keine Anmeldung, die
      // eine fremde Seite missbrauchen könnte. Ihr Wert liegt beim lokalen
      // Betrieb, den MCP_HTTP_PORT jederzeit erlaubt, und dort war ausgerechnet
      // der Pfad ungeschützt, den ein Fremder zuerst probiert.
      // 421 Misdirected Request (RFC 9110, 15.5.20): Die Anfrage war an einen
      // Host gerichtet, den dieser Server nicht bedient. Ohne CORS-Kopfzeilen und
      // ohne Logzeile, aus denselben Gründen wie die 403 darunter.
      if (allowedHosts.length > 0) {
        const host = (request.headers.get("host") ?? "").trim().toLowerCase();
        if (!allowedHosts.includes(host)) {
          return new Response("Misdirected request", { status: 421 });
        }
      }

      const origin = request.headers.get("origin");
      if (origin !== null && !allowedOrigins.includes(origin)) {
        // Keine CORS-Kopfzeilen, auch kein `access-control-allow-origin`: Mit
        // ihnen konnte eine fremde Seite die 403 lesen und daran erkennen, dass
        // auf diesem Port dieser Server läuft, also genau das, wogegen die
        // Prüfung steht, eine Antwortstufe später (bis 02.09.2026). Ohne sie
        // blockt der Browser das Lesen, und Abweisung und „kein Server" sehen
        // für die Seite gleich aus. Die 404 unten behält ihre Kopfzeilen.
        return new Response("Forbidden origin", { status: 403 });
      }

      if (url.pathname === "/health") {
        // Meldet, ob der Dienst funktioniert, und nicht bloß, dass der Prozess
        // läuft. An einem HTTP-Endpunkt sieht kein Terminal auf stderr, und ohne
        // bible_setup gibt es keinen Weg mehr innerhalb des Protokolls, eine
        // kaputte Datenbank zu bemerken: Jedes Werkzeug wiese einfach ab, eines
        // nach dem anderen. 503 statt 200, damit eine Überwachung es sieht, ohne
        // den Rumpf zu zerlegen.
        if (request.method === "OPTIONS") {
          return withCors(new Response(null, { status: 204 }), METHODS_HEALTH);
        }
        // HEAD gehört dazu: Eine Überwachung, die nur den Status will, darf den
        // Rumpf sparen. Alles andere ist auf einer Zustandsauskunft sinnlos und
        // wurde bis zum 03.08.2026 trotzdem mit 200 beantwortet, ein DELETE
        // eingeschlossen.
        if (request.method !== "GET" && request.method !== "HEAD") {
          return withCors(
            new Response(null, { status: 405, headers: { allow: METHODS_HEALTH } }),
            METHODS_HEALTH
          );
        }
        const problem = healthProblem();
        return withCors(
          new Response(
            JSON.stringify(problem === null ? { status: "ok" } : { status: "fehler", grund: problem }),
            {
              status: problem === null ? 200 : 503,
              headers: { "content-type": "application/json" },
            }
          ),
          METHODS_HEALTH
        );
      }

      if (url.pathname !== "/mcp") {
        return withCors(new Response("Not found", { status: 404 }), null);
      }

      // Die Vorabanfrage steht hinter der Pfadprüfung, damit sie nur für einen
      // Pfad zusagt, den es gibt. Davor beantwortete sie jede Adresse mit 204
      // und einer Methodenliste, auch eine, die anschließend 404 lieferte.
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }), METHODS_MCP);
      }

      // Eine Weiche für alle Methoden, nicht nur für GET.
      //
      // Bis zum 03.08.2026 fing dieser Handler allein GET ab und überließ den
      // Rest dem Transport. Das ergab auf ein und demselben Pfad drei
      // Auskünfte: `GET` bekam `Allow: POST, OPTIONS`, `HEAD`, `PUT` und
      // `PATCH` bekamen vom SDK `Allow: GET, POST, DELETE`, und `DELETE`
      // bekam 200, weil `validateSession` im zustandslosen Betrieb nichts zu
      // prüfen hat. `withCors` überschreibt nur die `access-control`-Felder,
      // der fremde `Allow` blieb also stehen. Wer bloß die Vorabanfrage
      // richtiggestellt hätte, hätte eine Falschaussage gegen die nächste
      // getauscht.
      //
      // `DELETE` antwortet deshalb seit dem 03.08.2026 mit 405 statt 200. Die
      // Spezifikation erlaubt das an dieser Stelle ausdrücklich (MAY), und ein
      // Server ohne Sitzung hat nichts zu beenden. Die frühere Entscheidung,
      // es beim 200 des SDK zu belassen, stand unter der Annahme, dass keine
      // Kopfzeile etwas anderes behauptet; mit einer Methodenliste je Pfad
      // gilt die nicht mehr.
      //
      // GET wird beantwortet, aber nicht offengehalten.
      //
      // Der GET-Kanal dient server-initiierten Nachrichten. Dieser Server sendet
      // keine: er ist zustandslos, schiebt nichts und hat nichts fortzusetzen.
      // Ohne diesen Zweig lief ein GET trotzdem durch den Transport und blieb als
      // SSE-Stream offen, der nie ein Byte liefert: gemessen 120 Sekunden je
      // Verbindung (Bun `idleTimeout`), 30 parallele GETs hielten 30
      // Dateideskriptoren samt je einer Serverinstanz. Für einen anonymen
      // Endpunkt ist das ein kostenloser Verbindungshalter, und eine
      // Ratenbegrenzung davor greift bei offenen Verbindungen schlecht.
      //
      // Warum 405 und nicht 200: Die Spezifikation lässt auf diesen GET genau
      // zwei Antworten zu, `text/event-stream` oder 405. Eine 200 mit leerem
      // Rumpf ist keine davon, und der Aufrufer kann sie nur als eröffneten
      // Strom lesen. Im SDK-Client ist `response.ok` dann wahr, er geht in
      // `_handleSseStream`, der Rumpf endet sofort, und die Wiederverbindung
      // greift mit `initialReconnectionDelay: 1000`. `maxRetries: 2` fängt das
      // nicht: Der Zähler gilt gescheiterten Verbindungen, eine 200 gilt als
      // geglückt und setzt ihn zurück. Das Ergebnis ist eine Schleife ohne Ende,
      // im Sekundentakt.
      //
      // Gemessen am 03.08.2026 am laufenden Dienst: 41 430 GET gegen 389 POST
      // binnen 24 Stunden, 0,93 Anfragen je Sekunde durchgehend (1000 ms Takt
      // plus Umlaufzeit), rund 40 000 Anfragen am Tag ohne jede Nutzlast. Die
      // mittlere Antwort war mit 797 Byte kleiner als ein einzelner Vers, es
      // wurde also nichts abgerufen. Auf 405 kehrt derselbe Client wortlos
      // zurück ("This is an expected case that should not trigger an error") und
      // arbeitet mit POST weiter.
      //
      // Die frühere Begründung, 200 sei an den einzigen nachweislich
      // funktionierenden fremden Connector angeglichen, stützte sich auf eine
      // Beobachtung an fremdem Gerät (n=1) und nicht darauf, dass claude.ai die
      // 200 braucht; die Fehlersuche-Anleitung von Claude nennt 405 beim
      // Erreichbarkeitstest ausdrücklich als unbedenklich.
      //
      // `Allow` gehört zwingend dazu, RFC 9110 verlangt es bei 405, und es ist
      // die eigentliche Auskunft: nur POST, absichtlich so.
      if (request.method !== "POST") {
        return withCors(
          new Response(null, { status: 405, headers: { allow: METHODS_MCP } }),
          METHODS_MCP
        );
      }

      // Den Rumpf genau einmal lesen und dem SDK geparst übergeben. Bis zum
      // 02.09.2026 las die Telemetrie einen Klon und das SDK danach das
      // Original: zwei vollständige Parses je Anfrage ohne Kopfzeile, bis zu
      // 1 MB. Ein unlesbarer Rumpf geht ungeparst weiter, das SDK antwortet dann
      // wie bisher mit 400, und die Telemetrie zählt nach der Kopfzeile. Ein
      // Aufrufer darf ein Nachschlagen nie dadurch zerbrechen, dass er einen
      // Rumpf schickt, den dies hier nicht lesen kann.
      let rumpf: unknown;
      try {
        rumpf = await request.clone().json();
      } catch {
        rumpf = undefined;
      }
      noteProtocolVersion(request, rumpf);

      // Zustandslos: ein Server samt Transport je Anfrage, keine
      // Sitzungsregistratur. Dieser Server ist reines Anfrage-Antwort-Spiel, er
      // schiebt keine Benachrichtigungen und hat nichts fortzusetzen; Sitzungen
      // brächten ihm also nichts und kosteten eine Registratur, die zu räumen, zu
      // deckeln und verfallen zu lassen wäre. Eine frühere sitzungsbehaftete
      // Fassung lief genau dort aus (21 Anfragen, 21 Sitzungen, die nie
      // verschwanden, gemessen 25.07.2026). Beide Objekte fallen aus dem
      // Geltungsbereich, sobald der Antwortstrom endet.
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await createServer().connect(transport);
      return withCors(
        await transport.handleRequest(request, rumpf === undefined ? undefined : { parsedBody: rumpf }),
        METHODS_MCP
      );
    },
  });

  console.error(`Bibelstudium MCP server running on http://${host}:${port}/mcp`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.error(
      `WARNUNG: gebunden an ${host}, also nicht nur lokal erreichbar. ` +
        "Ohne vorgelagertes TLS und Zugriffsschutz nicht ins offene Netz stellen."
    );
  }
}

// --- Der Metrik-Port ------------------------------------------------------

/**
 * Der Metrik-Endpunkt, zuzuschalten über MCP_METRICS_PORT.
 *
 * **Ein eigener Listener, kein Pfad am MCP-Port, und das ist der Kern.** Wo
 * dieser Server hinter einem Tunnel oder Reverse Proxy liegt, wird in aller
 * Regel ein ganzer Hostname auf seinen Port geleitet, ohne Regel je Pfad. Ein
 * `/metrics` am selben Port wäre damit öffentlich, und keine Herkunftsprüfung
 * hilft: Der Proxy verbindet von 127.0.0.1 und ist am Socket nicht von einem
 * lokalen Aufrufer zu unterscheiden. Ein zweiter Port lässt sich dagegen
 * einfach nicht veröffentlichen.
 *
 * **Ein Bindefehler darf den Server nicht beenden.** `Bun.serve` wirft synchron,
 * und zwar sowohl bei belegtem Port als auch bei einer Adresse, die es auf
 * dieser Maschine nicht gibt, beide Male mit derselben Meldung „Failed to start
 * server. Is port … in use?" (gemessen 18.08.2026). Ungefangen liefe der Wurf
 * bis in den `catch`-Zweig von `main()` und damit in `process.exit(1)`: Ein
 * Merkmal zur Beobachtung des Dienstes legte den Dienst still, und das in genau
 * den Lagen, in denen ohnehin etwas klemmt, etwa wenn die Netzwerkadresse beim
 * Systemstart noch nicht steht. Deshalb wird gefangen, gemeldet und
 * weitergemacht.
 *
 * Die Startmeldung sagt bewusst nicht „running on": Auf diese Zeichenfolge
 * wartet der Testtreiber, um den MCP-Listener als bereit zu erkennen.
 */
export function serveMetrics(): void {
  const portRaw = process.env["MCP_METRICS_PORT"];
  if (portRaw === undefined || portRaw === "") return;

  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // Nicht geworfen, aus demselben Grund wie unten: Ein Tippfehler in einer
    // Nebensache soll den Bibelserver nicht am Starten hindern.
    console.error(
      `MCP_METRICS_PORT ist keine gültige Portnummer: ${portRaw}. Metriken bleiben aus.`
    );
    return;
  }

  // Vorgabe wie beim MCP-Port: nur lokal. Wer die Zahlen aus einem anderen
  // Rechner abholen will, setzt die Adresse ausdrücklich.
  const host = process.env["MCP_METRICS_HOST"] ?? "127.0.0.1";

  try {
    Bun.serve({
      port,
      hostname: host,
      development: false,
      // Dieselben Grenzen wie am MCP-Port, aus demselben Grund: Ohne sie nimmt
      // Bun bis zu 128 MB je Rumpf an, und ein Abruf von /metrics trägt gar
      // keinen (02.09.2026).
      maxRequestBodySize: 4096,
      idleTimeout: 30,
      // Ohne diese Zeile teilen sich zwei Prozesse den Port stillschweigend.
      // Bun setzt SO_REUSEPORT von sich aus: Ein zweiter Serverprozess band
      // denselben Port anstandslos, beide erschienen als LISTEN, und der Kern
      // verteilte die Abrufe zwischen ihnen (gemessen 18.08.2026). Für eine
      // Überwachung ist das der schlechteste aller Ausgänge, denn jeder Abruf
      // trifft zufällig einen der beiden Zählerstände, und nichts daran sieht
      // nach einem Fehler aus. Mit `false` wirft der zweite Prozess stattdessen,
      // und der `catch` unten macht daraus eine Zeile im Protokoll.
      reusePort: false,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== "/metrics") {
          return new Response("Not found", { status: 404 });
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response(null, { status: 405, headers: { allow: METHODS_METRIKEN } });
        }
        // Keine CORS-Kopfzeilen: Diese Antwort geht an eine Überwachung, nicht
        // an einen Browser.
        return new Response(metrikenText(), {
          headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
        });
      },
    });
  } catch (fehler) {
    console.error(
      `Metriken nicht verfügbar: ${host}:${port} ließ sich nicht binden ` +
        `(${fehler instanceof Error ? fehler.message : String(fehler)}). ` +
        "Der Bibelserver läuft weiter."
    );
    return;
  }

  console.error(`Metriken bereit auf http://${host}:${port}/metrics`);
}
