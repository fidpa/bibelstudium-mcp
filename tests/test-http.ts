/**
 * Regressionsprüfung des HTTP-Transports.
 *
 * Ergänzt `test-golden.ts`, das ausschließlich über stdio spricht und damit
 * alles prüft, was der Server *sagt*, aber nichts davon, wie er *antwortet*:
 * Statuscodes je Methode, `Allow`-Werte, Origin, die Kopfzeilen der
 * Vorabanfrage. Genau dort saßen am 03.08.2026 zwei Fehler, von denen einer
 * (GET mit 200 statt 405) rund 40 000 Anfragen am Tag erzeugte, weil ein
 * Client die Antwort als eröffneten Strom las und im Sekundentakt neu verband.
 *
 * Abgrenzung zum Guard in `.github/workflows/lint.yml`: Der prüft, dass
 * `bible_setup` im HTTP-Modus weder gelistet noch aufrufbar ist. Diese Datei
 * prüft das Transportverhalten und überschneidet sich damit nicht.
 *
 * **Datenunabhängig, also CI-tauglich.** Geprüft wird der Transport, nicht der
 * Inhalt; der einzige datenabhängige Punkt ist `/health`, und dort lautet die
 * Zusicherung „200 oder 503, Rumpf ist JSON mit Feld `status`". Anders als
 * `bun run test` braucht diese Datei deshalb keine gebaute Datenbank:
 *
 *   bun run test:http
 *
 * Zwei Fallstricke, beide bezahlt:
 *
 * - `curl -X HEAD` ohne `-I` wartet auf einen Rumpf, den es bei HEAD nie gibt,
 *   und läuft in den Timeout. Das sieht wie ein hängender Server aus und ist
 *   keiner. Hier wird mit `fetch` gemessen, wo das nicht auftritt; wer einen
 *   Fall von Hand nachstellt, sollte es wissen.
 * - `protocolSightings` in `server.ts` ist auf 20 gedeckelt. Prüfungen mit
 *   erfundenen Protokollrevisionen sind im selben Prozess deshalb nicht
 *   beliebig wiederholbar. Die wenigen hier bleiben weit darunter.
 */
import { resolve, dirname } from "node:path";
// Geteilt mit den Golden-Tests. Der Kern hängt an nichts weiter: Diese Datei
// bleibt datenunabhängig und damit die einzige, die auch in der CI laufen kann.
import { abschluss, check, eq } from "./lib/zusicherungen.ts";

const SERVER = resolve(dirname(import.meta.dirname), "src/server.ts");

/**
 * Bewusst nicht 8931: Diesen Port belegen der Dienst und der CI-Guard. Läuft
 * dort etwas, scheitert `Bun.serve` mit EADDRINUSE, und ein Test, der lediglich
 * auf eine Antwort pollt, bekäme sie vom fremden Prozess und prüfte das falsche
 * Programm. Deshalb wird unten auch nicht gepollt, sondern auf die Startzeile
 * dieses Prozesses gewartet.
 */
const PORT = 8939;
const BASE = `http://127.0.0.1:${PORT}`;

const JSON_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

// --- Serverstart ------------------------------------------------------------

type Server = { proc: Bun.Subprocess; stop: () => void };

/**
 * Startet einen frischen Server und kehrt erst zurück, wenn **dieser** Prozess
 * seine Startzeile geschrieben hat.
 *
 * Auf stderr zu warten statt auf `/health` zu pollen, unterscheidet den eigenen
 * Prozess von einem fremden auf demselben Port und meldet einen Startfehler mit
 * dem Wortlaut des Servers, statt ihn als Zeitüberschreitung zu verkleiden.
 *
 * `env` wird vollständig gesetzt und nicht geerbt: Ein `MCP_HTTP_ALLOWED_ORIGINS`
 * oder `MCP_HTTP_HOST` aus der Arbeitsumgebung würde sonst genau die
 * Origin-Prüfungen unten kippen, und seit dem 03.08.2026 steht diese Variable
 * im Betrieb gesetzt.
 */
async function start(extraEnv: Record<string, string> = {}): Promise<Server> {
  const proc = Bun.spawn(["bun", "run", SERVER], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      MCP_HTTP_PORT: String(PORT),
      ...extraEnv,
    },
  });
  const stop = () => {
    try {
      proc.kill();
    } catch {
      // Schon beendet. Kein Grund, den Testlauf daran scheitern zu lassen.
    }
  };

  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
    if (seen.includes("running on")) {
      // Den Rest von stderr laufen lassen, sonst blockiert der Server, sobald
      // die Puffer volllaufen.
      void (async () => {
        try {
          while (true) {
            const { done: d } = await reader.read();
            if (d) break;
          }
        } catch {
          // Prozess beendet, nichts weiter zu tun.
        }
      })();
      return { proc, stop };
    }
  }

  stop();
  throw new Error(
    `Server startete nicht auf Port ${PORT}. Ausgabe war:\n${seen.trim() || "(nichts)"}`
  );
}

type Probe = { status: number; allow: string | null; corsMethods: string | null; body: string };

/**
 * Jede Antwort wird vollständig gelesen. POST antwortet als `text/event-stream`;
 * ein ungelesener Rumpf hielte die Verbindung offen, und der Testprozess endete
 * erst mit dem `idleTimeout` von 120 Sekunden.
 */
async function probe(path: string, init: RequestInit = {}): Promise<Probe> {
  const res = await fetch(`${BASE}${path}`, init);
  const body = await res.text();
  return {
    status: res.status,
    allow: res.headers.get("allow"),
    corsMethods: res.headers.get("access-control-allow-methods"),
    body,
  };
}

// --- Lauf 1: Voreinstellung, keine erlaubten Herkünfte -----------------------

const server = await start();

try {
  console.log("Methoden auf /mcp");
  {
    const post = await probe("/mcp", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    eq("POST /mcp: 200", post.status, 200);
    eq("POST /mcp: nennt die Methoden des Pfads", post.corsMethods, "POST, OPTIONS");

    // Der Wert von `Allow`, nicht nur der Statuscode. Vor dem 03.08.2026 kam
    // die 405 für diese vier Methoden aus dem SDK und trug dessen eigene Liste
    // `GET, POST, DELETE`, also die Auskunft eines anderen Servers als dieser.
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"]) {
      const r = await probe("/mcp", { method });
      eq(`${method} /mcp: 405`, r.status, 405);
      eq(`${method} /mcp: Allow`, r.allow, "POST, OPTIONS");
    }
  }

  console.log("Vorschriften der Spezifikation");
  {
    const note = await probe("/mcp", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    eq("Benachrichtigung: 202", note.status, 202);
    eq("Benachrichtigung: ohne Rumpf", note.body, "");

    const noAccept = await probe("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    eq("POST ohne Accept: 406", noAccept.status, 406);

    // Mit `tools/list`, nicht mit `initialize`: Das SDK prüft die Kopfzeile nur
    // ausserhalb der Initialisierung (`if (!isInitializationRequest)`), ein
    // `initialize` mit unbekannter Revision ergäbe also kein 400 und der Fall
    // wäre stillschweigend ungeprüft.
    const badVersion = await probe("/mcp", {
      method: "POST",
      headers: { ...JSON_HEADERS, "mcp-protocol-version": "1999-01-01" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    eq("unbekannte Protokollrevision: 400", badVersion.status, 400);

    const goodVersion = await probe("/mcp", {
      method: "POST",
      headers: { ...JSON_HEADERS, "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    eq("bekannte Protokollrevision: 200", goodVersion.status, 200);

    // Beide Kopfzeilen korrekt, sonst greift die Accept-Prüfung (406) oder die
    // des Inhaltstyps (415) vorher und der Parser wird nie erreicht.
    const badJson = await probe("/mcp", {
      method: "POST",
      headers: JSON_HEADERS,
      body: "{kaputt",
    });
    eq("fehlerhaftes JSON: 400", badJson.status, 400);
  }

  console.log("Origin-Pruefung");
  {
    const fremd = { origin: "https://boese.example" };

    const mcp = await probe("/mcp", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...fremd },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    eq("fremder Origin auf /mcp: 403", mcp.status, 403);

    // Der Befund vom 03.08.2026: Diese Prüfung lag hinter /health, der Pfad war
    // also für jede Webseite abfragbar.
    const health = await probe("/health", { headers: fremd });
    eq("fremder Origin auf /health: 403", health.status, 403);

    const fremdpfad = await probe("/", { headers: fremd });
    eq("fremder Origin auf unbekanntem Pfad: 403", fremdpfad.status, 403);

    const vorab = await probe("/mcp", { method: "OPTIONS", headers: fremd });
    eq("fremder Origin bei der Vorabanfrage: 403", vorab.status, 403);
    check(
      "abgewiesene Antwort nennt keine Methodenliste",
      vorab.corsMethods === null,
      `war ${JSON.stringify(vorab.corsMethods)}`
    );

    const ohne = await probe("/mcp", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    eq("ohne Origin: Durchlass", ohne.status, 200);
  }

  console.log("Vorabanfrage");
  {
    const mcp = await probe("/mcp", { method: "OPTIONS" });
    eq("OPTIONS /mcp: 204", mcp.status, 204);
    eq("OPTIONS /mcp: Methoden", mcp.corsMethods, "POST, OPTIONS");

    const health = await probe("/health", { method: "OPTIONS" });
    eq("OPTIONS /health: 204", health.status, 204);
    eq("OPTIONS /health: Methoden", health.corsMethods, "GET, HEAD, OPTIONS");

    // Vor dem 03.08.2026 wurde jede Adresse mit 204 samt Methodenliste
    // beantwortet, auch eine, die anschliessend 404 lieferte.
    const unbekannt = await probe("/gibtesnicht", { method: "OPTIONS" });
    eq("OPTIONS auf unbekanntem Pfad: 404", unbekannt.status, 404);
  }

  console.log("Zustandsauskunft");
  {
    const get = await probe("/health");
    check(
      "GET /health: 200 oder 503",
      get.status === 200 || get.status === 503,
      `war ${get.status}`
    );
    const parsed: unknown = JSON.parse(get.body);
    check(
      "GET /health: Rumpf nennt einen Status",
      typeof parsed === "object" && parsed !== null && "status" in parsed,
      get.body.slice(0, 120)
    );
    eq("GET /health: Methoden", get.corsMethods, "GET, HEAD, OPTIONS");

    const head = await probe("/health", { method: "HEAD" });
    eq("HEAD /health: gleicher Status wie GET", head.status, get.status);

    // Bis zum 03.08.2026 beantwortete die Zustandsauskunft jede Methode mit
    // 200, ein DELETE eingeschlossen.
    for (const method of ["POST", "DELETE", "PUT"]) {
      const r = await probe("/health", { method });
      eq(`${method} /health: 405`, r.status, 405);
      eq(`${method} /health: Allow`, r.allow, "GET, HEAD, OPTIONS");
    }
  }

  console.log("Unbekannte Pfade");
  {
    for (const path of ["/", "/mcp/", "/MCP", "/.well-known/oauth-authorization-server", "/metrics"]) {
      const r = await probe(path);
      eq(`GET ${path}: 404`, r.status, 404);
    }
  }
} finally {
  server.stop();
}

// --- Lauf 2: mit ausdrücklich erlaubter Herkunft -----------------------------

// Eigener Prozess, weil die erlaubten Herkünfte beim Start gelesen werden.
// Prüft die andere Richtung derselben Weiche: Ohne diesen Lauf wäre allein
// belegt, dass die Prüfung ablehnt, nicht dass sie jemanden durchlässt.
const erlaubt = "https://erlaubt.example";
const server2 = await start({ MCP_HTTP_ALLOWED_ORIGINS: erlaubt });

try {
  console.log("Erlaubte Herkunft");
  {
    const r = await probe("/mcp", {
      method: "POST",
      headers: { ...JSON_HEADERS, origin: erlaubt },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    eq("erlaubter Origin auf /mcp: Durchlass", r.status, 200);

    const health = await probe("/health", { headers: { origin: erlaubt } });
    check(
      "erlaubter Origin auf /health: Durchlass",
      health.status === 200 || health.status === 503,
      `war ${health.status}`
    );

    const fremd = await probe("/mcp", {
      method: "POST",
      headers: { ...JSON_HEADERS, origin: "https://boese.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    eq("fremder Origin bleibt abgewiesen: 403", fremd.status, 403);
  }
} finally {
  server2.stop();
}

abschluss();
