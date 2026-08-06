/**
 * Ein knapper MCP-Client über stdio, so viel wie die Golden-Tests brauchen.
 *
 * Startet einen FRISCHEN `server.ts` als eigenen Prozess und misst damit nie die
 * womöglich veraltete Instanz einer laufenden Editorsitzung. Alle Anfragen gehen
 * in einem Schub hinaus, die Antworten werden über ihre `id` zugeordnet.
 */
import { resolve, dirname } from "node:path";
import type { Json } from "./zusicherungen.ts";

// Zwei Ebenen hoch in die Wurzel: diese Datei liegt in tests/lib/, der Server
// seit dem 05.08.2026 in src/.
const SERVER = resolve(dirname(dirname(import.meta.dirname)), "src/server.ts");

/**
 * `json` ist der geparste Textblock, `structured` das Feld `structuredContent`.
 * Beide werden behalten, weil es gerade um ihren Vergleich geht: Im Server
 * entstehen sie aus einem Wert, und dieser Test ist die einzige Stelle, der es
 * auffiele, wenn sie einmal auseinandergehen.
 */
export type ToolResult = {
  text: string;
  json: Json | null;
  structured: Json | null;
  isError: boolean;
  error: string;
  code: number;
};

/**
 * Eine Antwort auf `prompts/get`. Prompts haben keinen `isError`-Kanal, ein
 * abgewiesenes Argument kommt also als JSON-RPC-Fehler statt als Ergebnis an:
 * `error` hält dessen Meldung, `text` den gerenderten Prompt eines geglückten
 * Aufrufs.
 */
export type PromptResult = { text: string; error: string; code: number };

/**
 * Eine Antwort auf `resources/read`. Wie Prompts haben Ressourcen keinen
 * `isError`-Kanal; `json` ist der eine geparste `contents`-Eintrag, `error` die
 * JSON-RPC-Meldung eines abgewiesenen Abrufs.
 */
export type ResourceResult = {
  uri: string;
  mimeType: string;
  text: string;
  json: Json | null;
  error: string;
  code: number;
};

/** Ein Werkzeugaufruf: Name und Argumente. */
export type Aufruf = readonly [string, Json];

/**
 * Der JSON-RPC-Fehlercode eines abgewiesenen Aufrufs, 0 bei geglücktem Aufruf.
 *
 * Ausgelesen seit 0.5.11, als die Fehler des Aufrufers aufhörten,
 * `InternalError` zu melden. Die Zusicherungen sichern die Unterscheidung,
 * wessen Fehler vorliegt: `-32602` für alles, was an der Anfrage falsch ist,
 * `-32603` allein für den Zustand des Servers (eine Instanz ohne Datenbank).
 */
export const NO_ERROR = 0;

export type Lauf = {
  tools: Json[];
  results: ToolResult[];
  promptResults: PromptResult[];
  resourceResults: ResourceResult[];
  resourceList: Json[];
  templateList: Json[];
  promptList: Json[];
};

/**
 * Dasselbe wie `callTools`, aber jeder Aufruf trägt einen Namen statt einer
 * Position.
 *
 * Das ist der Unterschied, um dessentwillen es diese Funktion gibt: Die
 * Ergebnisse kamen früher als Liste zurück und wurden positionsweise zerlegt,
 * abgesichert allein durch eine Typzusicherung auf die Länge. Ein
 * eingeschobener Fall verschob dabei jeden Namen darunter, lautlos, und die
 * Zusicherungen prüften anschließend die falsche Antwort. Über einen Mapped
 * Type auf dieselben Schlüssel ist ein vertippter oder entfallener Aufruf ein
 * Übersetzungsfehler.
 *
 * Der Mapped Type ist dabei wesentlich: Eine Index-Signatur
 * (`Record<string, ToolResult>`) fiele unter `noUncheckedIndexedAccess` auf
 * `ToolResult | undefined` zurück, und eine Zusicherung auf einem
 * `undefined` prüfte nichts.
 */
export async function callNamed<
  const C extends Record<string, Aufruf>,
  const P extends Record<string, Aufruf>,
  const R extends Record<string, string>,
>(
  calls: C,
  prompts: P = {} as P,
  resources: R = {} as R,
  env: Record<string, string> = {}
): Promise<{
  tools: Json[];
  results: { [K in keyof C]: ToolResult };
  promptResults: { [K in keyof P]: PromptResult };
  resourceResults: { [K in keyof R]: ResourceResult };
  resourceList: Json[];
  templateList: Json[];
  promptList: Json[];
}> {
  const callKeys = Object.keys(calls);
  const promptKeys = Object.keys(prompts);
  const resourceKeys = Object.keys(resources);
  const lauf = await callTools(
    callKeys.map((k) => calls[k] as Aufruf),
    promptKeys.map((k) => prompts[k] as Aufruf),
    resourceKeys.map((k) => resources[k] as string),
    env
  );
  const zu = <T>(keys: string[], werte: T[]): Record<string, T> =>
    Object.fromEntries(keys.map((k, i) => [k, werte[i] as T]));
  return {
    tools: lauf.tools,
    results: zu(callKeys, lauf.results) as { [K in keyof C]: ToolResult },
    promptResults: zu(promptKeys, lauf.promptResults) as { [K in keyof P]: PromptResult },
    resourceResults: zu(resourceKeys, lauf.resourceResults) as { [K in keyof R]: ResourceResult },
    resourceList: lauf.resourceList,
    templateList: lauf.templateList,
    promptList: lauf.promptList,
  };
}

export async function callTools(
  calls: ReadonlyArray<Aufruf>,
  prompts: ReadonlyArray<Aufruf> = [],
  resources: ReadonlyArray<string> = [],
  // Zusätzliche Umgebung für den gestarteten Server. Genutzt für die eine
  // Instanz, deren BIBLE_DB_PATH auf eine Datei zeigt, die es nicht gibt: nur so
  // ist die Abweisung erreichbar, die dem Server zur Last fällt und nicht dem
  // Aufrufer.
  env: Record<string, string> = {}
): Promise<Lauf> {
  const proc = Bun.spawn(["bun", "run", SERVER], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, ...env },
  });
  const w = proc.stdin;
  const send = (m: unknown) => w.write(JSON.stringify(m) + "\n");

  send({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-golden", version: "1" },
    },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  calls.forEach(([name, args], i) =>
    send({ jsonrpc: "2.0", id: 2 + i, method: "tools/call", params: { name, arguments: args } })
  );
  prompts.forEach(([name, args], i) =>
    send({
      jsonrpc: "2.0",
      id: 2 + calls.length + i,
      method: "prompts/get",
      params: { name, arguments: args },
    })
  );
  // Die Ids sind positionsgebunden und müssen getrennt bleiben: 1 ist
  // tools/list, dann die Werkzeugaufrufe, dann die Prompts, dann die
  // Ressourcenabrufe, zuletzt die drei Auflistungen.
  const resBase = 2 + calls.length + prompts.length;
  resources.forEach((uri, i) =>
    send({ jsonrpc: "2.0", id: resBase + i, method: "resources/read", params: { uri } })
  );
  send({ jsonrpc: "2.0", id: resBase + resources.length, method: "resources/list" });
  send({
    jsonrpc: "2.0",
    id: resBase + resources.length + 1,
    method: "resources/templates/list",
  });
  send({ jsonrpc: "2.0", id: resBase + resources.length + 2, method: "prompts/list" });
  await w.flush();

  const expected = calls.length + prompts.length + resources.length + 4;
  const seen = new Map<number, Json>();
  const dec = new TextDecoder();
  const reader = proc.stdout.getReader();
  const deadline = Date.now() + 120_000;
  let buf = "";
  while (seen.size < expected && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as Json & { id?: number };
      if (typeof msg.id === "number" && msg.id >= 1) seen.set(msg.id, msg);
    }
  }
  proc.kill();

  if (seen.size < expected) {
    throw new Error(
      `Server antwortete nur auf ${seen.size} von ${expected} Anfragen. ` +
        `Läuft 'bun install', und existiert data/bible.db?`
    );
  }

  const listed = seen.get(1) as { result?: { tools?: Json[] } };
  const results = calls.map((_, i) => {
    const m = seen.get(2 + i) as {
      result?: {
        content?: Array<{ text?: string }>;
        structuredContent?: Json;
        isError?: boolean;
      };
      error?: { message?: string; code?: number };
    };
    const text = m.result?.content?.[0]?.text ?? "";
    let json: Json | null = null;
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = null; // Fehlerergebnisse sind reiner Text, kein JSON
    }
    return {
      text,
      json,
      structured: m.result?.structuredContent ?? null,
      isError: m.result?.isError === true,
      error: m.error?.message ?? "",
      code: m.error?.code ?? NO_ERROR,
    };
  });

  const promptResults = prompts.map((_, i) => {
    const m = seen.get(2 + calls.length + i) as {
      result?: { messages?: Array<{ content?: { text?: string } }> };
      error?: { message?: string; code?: number };
    };
    return {
      text: m.result?.messages?.[0]?.content?.text ?? "",
      error: m.error?.message ?? "",
      code: m.error?.code ?? NO_ERROR,
    };
  });

  const resourceResults = resources.map((_, i) => {
    const m = seen.get(resBase + i) as {
      result?: { contents?: Array<{ uri?: string; mimeType?: string; text?: string }> };
      error?: { message?: string; code?: number };
    };
    const entry = m.result?.contents?.[0];
    const text = entry?.text ?? "";
    let json: Json | null = null;
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = null;
    }
    return {
      uri: entry?.uri ?? "",
      mimeType: entry?.mimeType ?? "",
      text,
      json,
      error: m.error?.message ?? "",
      code: m.error?.code ?? NO_ERROR,
    };
  });

  const listedResources = seen.get(resBase + resources.length) as {
    result?: { resources?: Json[] };
  };
  const listedTemplates = seen.get(resBase + resources.length + 1) as {
    result?: { resourceTemplates?: Json[] };
  };
  const listedPrompts = seen.get(resBase + resources.length + 2) as {
    result?: { prompts?: Json[] };
  };

  return {
    tools: listed.result?.tools ?? [],
    results,
    promptResults,
    resourceResults,
    resourceList: listedResources.result?.resources ?? [],
    templateList: listedTemplates.result?.resourceTemplates ?? [],
    promptList: listedPrompts.result?.prompts ?? [],
  };
}
