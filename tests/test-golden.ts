/**
 * Regressionsprüfung der Serverkorrektheit.
 *
 * Spricht über stdio mit einem FRISCHEN `server.ts` und misst damit nie die
 * womöglich veraltete MCP-Instanz einer laufenden Editorsitzung.
 *
 * Aufgebaut aus Zusicherungen statt aus einem abgelegten Schnappschuss: Die
 * Erwartungen bleiben als Aussagen über die Daten lesbar („Psalm 23,1 hat sechs
 * Wörter", „das Comma steht nur im TR"), statt eine Textwand zu sein, die
 * niemand von Hand vergleicht.
 *
 * Braucht eine gebaute Datenbank, die CI kann den Test deshalb nicht ausführen
 * (dem Workflow fehlen die Daten). Lokal nach jeder Änderung an server.ts:
 *
 *   bun run test
 */
import { resolve, dirname } from "node:path";
import packageJson from "../package.json";
// Geteilt mit `schema-coverage.ts`, das die Breite prüft, wo diese Datei
// benannte Fälle prüft. Die Zusicherungen unten sind es, die den Prüfer ehrlich
// halten, und zwar für beide Aufrufer.
import { isRecord, schemaErrors } from "./schema-validator.ts";

const SERVER = resolve(dirname(import.meta.dirname), "server.ts");

type Json = Record<string, unknown>;
/**
 * `json` ist der geparste Textblock, `structured` das Feld `structuredContent`.
 * Beide werden behalten, weil es gerade um ihren Vergleich geht: Im Server
 * entstehen sie aus einem Wert, und dieser Test ist die einzige Stelle, der es
 * auffiele, wenn sie einmal auseinandergehen.
 */
type ToolResult = {
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
type PromptResult = { text: string; error: string; code: number };
/**
 * Eine Antwort auf `resources/read`. Wie Prompts haben Ressourcen keinen
 * `isError`-Kanal; `json` ist der eine geparste `contents`-Eintrag, `error` die
 * JSON-RPC-Meldung eines abgewiesenen Abrufs.
 */
type ResourceResult = {
  uri: string;
  mimeType: string;
  text: string;
  json: Json | null;
  error: string;
  code: number;
};

/**
 * Der JSON-RPC-Fehlercode eines abgewiesenen Aufrufs, 0 bei geglücktem Aufruf.
 *
 * Ausgelesen seit 0.5.11, als die Fehler des Aufrufers aufhörten,
 * `InternalError` zu melden. Die Zusicherungen unten sichern die Unterscheidung,
 * wessen Fehler vorliegt: `-32602` für alles, was an der Anfrage falsch ist,
 * `-32603` allein für den Zustand des Servers (eine Instanz ohne Datenbank).
 */
const NO_ERROR = 0;

// --- knapper MCP-Client über stdio ------------------------------------------

async function callTools(
  calls: ReadonlyArray<readonly [string, Json]>,
  prompts: ReadonlyArray<readonly [string, Json]> = [],
  resources: ReadonlyArray<string> = [],
  // Zusätzliche Umgebung für den gestarteten Server. Einmal genutzt, ganz am
  // Ende, um BIBLE_DB_PATH auf eine Datei zu richten, die es nicht gibt: nur so
  // ist die eine Abweisung erreichbar, die dem Server zur Last fällt und nicht
  // dem Aufrufer.
  env: Record<string, string> = {}
): Promise<{
  tools: Json[];
  results: ToolResult[];
  promptResults: PromptResult[];
  resourceResults: ResourceResult[];
  resourceList: Json[];
  templateList: Json[];
  promptList: Json[];
}> {
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

// --- Zusicherungen ----------------------------------------------------------

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (ok) return;
  failures++;
  console.log(`  FEHLGESCHLAGEN  ${name}${detail ? `\n                  ${detail}` : ""}`);
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `erwartet ${JSON.stringify(expected)}, war ${JSON.stringify(actual)}`);
}

/**
 * Teilzeichenketten-Prüfung über NFC-normalisierten Text.
 *
 * Nötig, nicht kosmetisch: `tagnt_words` führt bei 46 095 seiner 141 720
 * Wortformen die Oxia-Codepunkte (U+1F73 …), während `original_words`
 * durchgängig NFC ist (Tonos, U+03AD …). Beide sehen gleich aus, und
 * `ἐπέβαλον` aus der einen Quelle ist byteweise nicht `ἐπέβαλον` aus der
 * anderen. Ohne die Normalisierung hier scheiterte eine Zusicherung an einem
 * Unterschied, den niemand sehen kann.
 */
function has(name: string, haystack: string, needle: string): void {
  const h = haystack.normalize("NFC");
  const n = needle.normalize("NFC");
  check(name, h.includes(n), `"${needle}" fehlt in: ${haystack.slice(0, 160)}…`);
}

function lacks(name: string, haystack: string, needle: string): void {
  check(name, !haystack.includes(needle), `"${needle}" stand unerwartet drin`);
}

const hint = (j: Json | null): string => (typeof j?.hinweis === "string" ? j.hinweis : "");

// --- Fälle -------------------------------------------------------------------

// Eingabe genau an und knapp jenseits der abgeleiteten Grenzen von `verses`
// (MAX_VERSE_PARTS = 30 Segmente, MAX_VERSE = 200, also 30 × "176-176" plus 29
// Kommata = 239 Zeichen). Hier gebaut statt hineinkopiert, damit die Länge
// sichtbar bleibt.
const VERSES_MAX_VALID = Array(30).fill("100-176").join(","); // 239 Zeichen, sämtlich gültig
const VERSES_TOO_LONG = `${VERSES_MAX_VALID},1`; // 241 Zeichen
const VERSES_TOO_MANY = Array.from({ length: 35 }, (_, i) => String(i + 1)).join(",");
const OVERLONG_NAME = "J".repeat(60);

const CALLS = [
  // Grenzen: Die Meldung muss die wirkliche Grenze nennen, nicht "positive integer"
  ["bible_original", { book: "Ps", chapter: 23, verse: 999 }],
  ["bible_original", { book: "Ps", chapter: 999, verse: 1 }],
  ["bible_crossrefs", { book: "Joh", chapter: 3, verse: 999 }],
  ["bible_compare", { book: "1Joh", chapter: 5, verse: 999 }],
  ["bible_lookup", { book: "Ps", chapter: 999 }],
  // Buchauflösung
  ["bible_lookup", { book: "Hesekiel-Zusatz", chapter: 1, verses: "1" }],
  ["bible_lookup", { book: "Sirach", chapter: 1, verses: "1" }],
  // Klammern: Menge setzt Einschübe in Klammern, die anderen drei nicht
  ["bible_lookup", { book: "Joh", chapter: 3, verses: "16" }],
  ["bible_lookup", { book: "1. Mose", chapter: 15, verses: "3", translation: "MB" }],
  // Richtigkeit der Daten
  ["bible_compare", { book: "1Joh", chapter: 5, verse: 7 }],
  ["bible_compare", { book: "Mk", chapter: 14, verse: 46 }],
  ["bible_original", { book: "Psalm", chapter: 23, verse: 1 }],
  ["bible_search", { query: "lieb*", book: "1Joh" }],
  ["bible_crossrefs", { book: "Joh", chapter: 14, verse: 6, limit: 5 }],
  // Auskunft des Servers: Die Version muss die des Pakets sein, keine zweite Pflegestelle
  ["bible_server_info", {}],
  // `verses`: ein Fall je Fehlerklasse, dazu die größte gültige Eingabe. Jede
  // Meldung muss die tatsächlich verletzte Bedingung nennen, und keine der vier
  // Grenzen darf eine Antwort stillschweigend kürzen.
  ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_TOO_MANY }],
  ["bible_lookup", { book: "Ps", chapter: 117, verses: "1-500" }],
  ["bible_lookup", { book: "Ps", chapter: 117, verses: "1-500,2" }],
  ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_TOO_LONG }],
  ["bible_lookup", { book: "Ps", chapter: 119, verses: { kein: "string" } }],
  ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_MAX_VALID }],
  // Ein zu langer Buchname ist ein Längenproblem, kein fehlendes oder unbekanntes Feld
  ["bible_crossrefs", { book: OVERLONG_NAME, chapter: 1, verse: 1 }],
  ["bible_search", { query: "Gnade", book: OVERLONG_NAME }],
  ["bible_concordance", { lemma: "α".repeat(60) }],
  // Oberhalb der Scan-Grenze entfallen die beiden gezählten Felder: das gehört gesagt
  ["bible_search", { query: "der", limit: 2 }],
  // Bedingte Ausgabefelder, ein Fall je Feld, das rechtmäßig fehlen darf. Sie
  // stehen hier wegen der Ausgabeschemata: Jedes einzelne wäre ein harter
  // Client-Fehler, geriete es in `required` (ein Client des 1.x-SDK weist ein
  // erfolgreiches Ergebnis ab, das nicht zum deklarierten Schema passt).
  ["bible_compare", { book: "Joh", chapter: 7, verse: 53 }], // keine TAGNT-Zeile: neun NT-Verse haben keine
  ["bible_original", { book: "Joh", chapter: 3, verse: 16, texttyp: "sblgnt" }], // sblgnt führt keine Strong-Nummern
  ["bible_concordance", { strong: "G26", limit: 200 }], // alles aufgelistet: kein Kürzungshinweis
  ["bible_lookup", { book: "Hiob", chapter: 32, verses: "1-4", translation: "MB" }], // Menge ohne Klammern
  // Der eine Werkzeugaufruf, der kein Werkzeugfehler ist, sondern ein
  // JSON-RPC-Fehler: `isError` braucht ein Werkzeug, das es trägt, und hier
  // gibt es keines.
  ["bible_nichtvorhanden", {}],
] as const satisfies ReadonlyArray<readonly [string, Json]>;

// Prompts nennen den geladenen Bestand und die Felder der Antworten, die sie
// steuern; geprüft werden sie deshalb gegen `bible_server_info` und nicht gegen
// einen festen Wortlaut. Eine fest verdrahtete Liste von Übersetzungen oder
// Editionen veraltete genau auf der Instanz, der eine davon fehlt.
const PROMPT_CALLS = [
  ["word-study", { word: "Liebe" }],
  ["word-study", {}],
  ["variant-check", { reference: "1. Johannes 5,7" }],
  ["variant-check", { reference: OVERLONG_NAME.repeat(2) }],
  ["translation-compare", { reference: "Römer 8,1" }],
] as const satisfies ReadonlyArray<readonly [string, Json]>;

// Ressourcen werden über denselben frischen Server gelesen. Zuerst die
// gelingenden Fälle, dann je einer für jede Art, wie eine URI falsch sein kann;
// die Negativfälle müssen dieselbe Meldung tragen wie das entsprechende
// Werkzeugargument, sonst laufen die beiden Formulierungen auseinander.
const RESOURCE_CALLS = [
  "bible://buecher",
  "bible://uebersetzungen",
  "bible://editionen",
  "bible://quellen",
  "bible://kapitel/LUT/Psalter/23",
  "bible://vers/SCH/Johannes/3/16-17",
  "bible://vers/LUT/Joh/3/16",
  "bible://kapitel/LUT/1.%20Mose/1",
  "bible://kapitel/LUT/R%C3%B6mer/8",
  "bible://grundtext/wlc/1%20Mose/1/1",
  "bible://grundtext/byzantine/Johannes/3/16",
  // Negativfälle
  "spike://etwas",
  "bible://unbekannt",
  "bible://kapitel/LUT/Psalter",
  "bible://kapitel/LUT/Hesekiel-Zusatz/1",
  "bible://kapitel/LUT/Psalter/999",
  `bible://vers/LUT/Psalter/119/${VERSES_TOO_MANY}`,
  "bible://kapitel/XYZ/Psalter/23",
  "bible://grundtext/wlc/Johannes/3/16",
  // Zwei Bedingungen zugleich verletzt: Die Meldung muss die nennen, die auch
  // das Werkzeug nennt, sonst gilt „gleicher Wortlaut" nur für Einzelfehler.
  "bible://kapitel/LUT/Hesekiel-Zusatz/999",
] as const satisfies ReadonlyArray<string>;

const { tools, results, promptResults, resourceResults, resourceList, templateList, promptList } =
  await callTools(CALLS, PROMPT_CALLS, RESOURCE_CALLS);
const [wordStudy, wordStudyNoArg, variantCheck, variantTooLong, translationCompare] =
  promptResults as PromptResult[] & { length: 5 };
const [
  resBuecher,
  resUebersetzungen,
  resEditionen,
  resQuellen,
  resKapitel,
  resVersBereich,
  resVersEinzeln,
  resKapitelPunkt,
  resKapitelUmlaut,
  resGrundtextAt,
  resGrundtextNt,
  resFremdesSchema,
  resUnbekannt,
  resZuWenigSegmente,
  resBuchFehlt,
  resKapitelGrenze,
  resVerslisteZuLang,
  resUebersetzungUnbekannt,
  resEditionFalschesTestament,
  resZweiVerletzt,
] = resourceResults as ResourceResult[] & { length: 20 };
const [
  origVerse999,
  origChap999,
  xrefVerse999,
  cmpVerse999,
  lookupChap999,
  hesekiel,
  sirach,
  joh316,
  mengeVers,
  comma,
  mk1446,
  ps231,
  searchLieb,
  xrefJoh146,
  serverInfo,
  versesTooMany,
  versesSpanTooHigh,
  versesSpanWithComma,
  versesTooLong,
  versesNotAString,
  versesMaxValid,
  xrefLongBook,
  searchLongBook,
  concordanceLongLemma,
  searchOverLimit,
  cmpOhneBezeugung,
  origSblgnt,
  concordVollstaendig,
  mengeOhneKlammer,
  unbekanntesWerkzeug,
] = results as ToolResult[] & { length: 31 };

console.log("Grenzwertmeldungen");
for (const [label, r] of [
  ["bible_original verse", origVerse999],
  ["bible_crossrefs verse", xrefVerse999],
  ["bible_compare verse", cmpVerse999],
] as const) {
  eq(`${label}: Text`, r!.text, "Error: 'verse' must be an integer between 1 and 200");
  eq(`${label}: isError`, r!.isError, true);
}
eq("bible_original chapter", origChap999!.text, "Error: 'chapter' must be an integer between 1 and 150");
eq("bible_lookup chapter", lookupChap999!.text, "Error: 'chapter' must be an integer between 1 and 150");

console.log("Server-Auskunft");
{
  const j = serverInfo!.json as Json;
  // Gegen den einen Fehler, dessentwegen es dieses Werkzeug gibt: eine Version,
  // die an zweiter Stelle gepflegt wird. Verglichen wird gegen package.json,
  // nicht gegen ein Literal an dieser Stelle.
  eq("version == package.json", j?.version, packageJson.version);
  eq("kein Fehler", serverInfo!.isError, false);
  const geladen = j?.uebersetzungen as Array<{ code: string; name: string }> | undefined;
  check("Übersetzungen gelistet", Array.isArray(geladen) && geladen.length > 0);
  // Jeder Name muss seine Jahreszahl tragen: „Schlachter" allein bezeichnet
  // keinen Text, und 1951 weicht im Wortlaut von 2000 ab.
  for (const t of geladen ?? []) {
    check(`${t.code}: Jahreszahl im Namen`, /\d{4}/.test(t.name), `war "${t.name}"`);
  }
  const editionen = j?.urtext_editionen as Array<{ code: string; name: string }> | undefined;
  has("Urtext: Mehrheitstext", JSON.stringify(editionen), "byzantine");
  has("Urtext: AT (WLC)", JSON.stringify(editionen), "wlc");
  // Jede Edition muss einen aufgelösten Namen tragen: „tr" allein bezeichnet
  // keinen Text, und name === code heißt, der Rückfall in EDITION_META hat still
  // übernommen.
  for (const e of editionen ?? []) {
    check(
      `${e.code}: Name aufgeloest`,
      typeof e.name === "string" && e.name.length > 0 && e.name !== e.code,
      `war "${e.name}"`
    );
  }
  const zusatz = (j?.zusatzdaten ?? {}) as Record<string, unknown>;
  for (const key of [
    "strong_lexikon",
    "strong_lexikon_vollstaendig",
    "editionsbezeugung",
    "querverweise",
    "volltextsuche",
  ]) {
    check(`zusatzdaten.${key} ist bool`, typeof zusatz[key] === "boolean");
  }
  lacks("keine Verszahl", serverInfo!.text, "verse_gesamt");
  lacks("keine Host-Details: kein Pfad", serverInfo!.text, "/opt/");
  lacks("keine Host-Details: keine Laufzeit", serverInfo!.text, "uptime");
}

console.log("Werkzeug-Annotationen");
eq("sieben Werkzeuge gelistet", tools.length, 7);
for (const t of tools) {
  const a = t.annotations as Json | undefined;
  eq(`${String(t.name)}: readOnlyHint`, a?.readOnlyHint, true);
  eq(`${String(t.name)}: openWorldHint`, a?.openWorldHint, false);
  check(`${String(t.name)}: kein destructiveHint`, a !== undefined && !("destructiveHint" in a));
}

console.log("Buchauflösung");
has("Hesekiel-Zusatz: Vorschlag", hesekiel!.text, 'Am nächsten kommt "Hesekiel"');
has("Hesekiel-Zusatz: Kanonumfang", hesekiel!.text, "66 Bücher");
has("Sirach: als apokryph benannt", sirach!.text, "apokryphen/deuterokanonischen");
lacks("Sirach: kein Sacharja-Fehlvorschlag", sirach!.text, "Sacharja");

console.log("Klammerhinweise");
has("1Mo 15,3 (MB): Wortklammer im Text", mengeVers!.json?.text as string, "[darum wird einer");
has("1Mo 15,3 (MB): Klammerhinweis", hint(mengeVers!.json), "Wörter in eckigen Klammern");
eq("Joh 3,16 (LUT): kein Klammerhinweis", hint(joh316!.json), "");
eq("Joh 3,16 (LUT): Voreinstellung Luther", joh316!.json?.translation, "Luther 1912");

console.log("Editionsvergleich");
{
  const eds = (comma!.json?.editionen ?? []) as Array<{ texttyp: string; text: string }>;
  const byType = new Map(eds.map((e) => [e.texttyp, e.text]));
  eq("1Joh 5,7 byzantine", byType.get("byzantine"), "οτι τρεις εισιν οι μαρτυρουντες");
  eq("1Joh 5,7 sblgnt", byType.get("sblgnt"), "ὅτι τρεῖς εἰσιν οἱ μαρτυροῦντες");
  has("1Joh 5,7 tr trägt das Comma", byType.get("tr") ?? "", "ο πατηρ ο λογος και το αγιον πνευμα");
  check("1Joh 5,7 ohne Quellenkonflikt", !("warnung" in (comma!.json ?? {})));
  // Die Wortzahlen stehen da, damit niemand zählen muss: Das Comma wurde als 16
  // zusätzliche Wörter gemeldet, wo Vergleich und TAGNT-Bezeugung beide 17
  // sagen (25.07.2026).
  const woerter = new Map(
    ((comma!.json?.editionen ?? []) as Array<{ texttyp: string; woerter: number }>).map((e) => [
      e.texttyp,
      e.woerter,
    ])
  );
  eq("1Joh 5,7: Wortzahl tr", woerter.get("tr"), 22);
  eq("1Joh 5,7: Wortzahl byzantine", woerter.get("byzantine"), 5);
  const diffs = ((comma!.json?.vergleiche ?? []) as Array<{ unterschiede?: string[] }>).flatMap(
    (v) => v.unterschiede ?? []
  );
  check(
    "1Joh 5,7: Zusatz mit 17 Wörtern beziffert",
    diffs.some((d) => d.includes("(17 Wörter)"))
  );
}
{
  has("Mk 14,46: warnung oben", String(mk1446!.json?.warnung ?? ""), "widerspricht die TAGNT-Bezeugung");
  const qk = (mk1446!.json?.quellenkonflikte ?? []) as string[];
  eq("Mk 14,46: ein Quellenkonflikt", qk.length, 1);
  has("Mk 14,46: nennt Editionslesart zuerst", qk[0] ?? "", 'byzantine liest hier "ἐπέβαλον"');
}

console.log("Grundtext");
{
  const w = (ps231!.json?.woerter ?? []) as Array<Json>;
  eq("Ps 23,1: Wortzahl", w.length, 6);
  eq("Ps 23,1: texttyp", ps231!.json?.texttyp, "wlc");
  eq("Ps 23,1: Morphemtrenner erhalten", w[3]?.wort, "רֹ֝עִ֗/י");
  eq("Ps 23,1: Strong", w[3]?.strong, "H7462");
  eq("Ps 23,1: Code", w[3]?.code, "HVqrmsc/Sp1cs");
  has("Ps 23,1: Morphologie aufgelöst", String(w[3]?.morphologie ?? ""), "Partizip aktiv maskulin Singular konstrukt");
  eq("Ps 23,1: Nichtverb dekodiert", w[4]?.morphologie, "Partikel (Negation)");
}

console.log("Suche und Querverweise");
eq("lieb* in 1Joh: Verse", searchLieb!.json?.treffer, 30);
eq("lieb* in 1Joh: Vorkommen", searchLieb!.json?.vorkommen_gesamt, 48);
has("lieb* in 1Joh: Trennung benannt", String(searchLieb!.json?.hinweis ?? ""), "zählt Verse");
{
  const v = (xrefJoh146!.json?.verweise ?? []) as Array<Json>;
  eq("Joh 14,6: fünf Verweise", v.length, 5);
  eq("Joh 14,6: stärkster Verweis", v[0]?.stelle, "Apostelgeschichte 4,12");
  const multi = v.find((x) => String(x.stelle).includes("11,25-26"));
  check("Joh 14,6: Joh 11,25-26 enthalten", multi !== undefined);
  const einzeln = (multi?.verse_einzeln ?? []) as Array<Json>;
  eq("Joh 11,25-26: zwei Einzelverse", einzeln.length, 2);
  eq("Joh 11,25-26: erste Versnummer", einzeln[0]?.nr, 25);
  has("Joh 14,6: lesehinweis gesetzt", String(xrefJoh146!.json?.lesehinweis ?? ""), "vollständig übernehmen");
}

console.log("Verslisten-Grenzen");
{
  // Der Hausfehler dieses Servers ist das stille Kürzen: Eine Grenze greift, die
  // Antwort wird kürzer, nichts sagt es, und sie sieht trotzdem vollständig aus.
  // "1,2,…,35" auf Ps 119 kam wortlos als 1-30 zurück (26.07.2026).
  eq(
    "35 Segmente: abgewiesen statt gekürzt",
    versesTooMany!.text,
    "Error: 'verses' must list at most 30 comma-separated segments"
  );
  eq("35 Segmente: isError", versesTooMany!.isError, true);
  // Gleiche Bedeutung, zwei Wege: Der Schnellpfad für eine schlichte Spanne
  // übersprang die Grenze ganz, der Weg über parseVerses ließ das Segment fallen.
  // Beide müssen jetzt melden.
  const outOfBounds = "Error: every verse number in 'verses' must be between 1 and 200";
  eq("Spanne 1-500", versesSpanTooHigh!.text, outOfBounds);
  eq("Spanne 1-500,2 (gleiche Meldung)", versesSpanWithComma!.text, outOfBounds);
  eq(
    "241 Zeichen: Längenmeldung nennt die Länge",
    versesTooLong!.text,
    "Error: 'verses' must be at most 239 characters"
  );
  eq(
    "kein String: Formmeldung",
    versesNotAString!.text,
    `Error: 'verses' must be a string like "4", "16-17" or "1-3,7"`
  );
  // Das Gegenstück, und der Grund, warum die Zeichengrenze abgeleitet und nicht
  // gewählt ist: Bei 239 Zeichen ist alles gültig und muss durchgehen. Die alte,
  // freihändig gesetzte 200 wies genau diese Eingabe ab.
  eq("239 Zeichen gültig: kein Fehler", versesMaxValid!.isError, false);
  eq("239 Zeichen gültig: volle Spanne", versesMaxValid!.json?.reference, "Psalter 119,100-176");
}

console.log("Längenmeldungen");
{
  // Nannte früher die falsche Bedingung: bible_crossrefs sagte 'book' is
  // required, obwohl book gesetzt war, bible_search sagte, es müsse ein
  // deutscher Buchname sein, obwohl es einer war, nur zu lang (26.07.2026).
  const tooLong = "Error: 'book' must be at most 50 characters (e.g. 'Jesaja', '1. Mose', 'Römer')";
  eq("bible_crossrefs: langer Buchname", xrefLongBook!.text, tooLong);
  eq("bible_search: langer Buchname", searchLongBook!.text, tooLong);
  eq(
    "bible_concordance: langes lemma hat eigene Grenze",
    concordanceLongLemma!.text,
    "Error: 'lemma' must be at most 50 characters"
  );
}

console.log("Scan-Grenze der Suche");
{
  const j = searchOverLimit!.json;
  check("über 1000 Treffer", ((j?.treffer as number) ?? 0) > 1000);
  check("vorkommen_gesamt entfällt", !("vorkommen_gesamt" in (j ?? {})));
  check("verteilung entfällt", !("verteilung" in (j ?? {})));
  // Was fehlt, wird geschätzt und liest sich trotzdem wie gezählt; deshalb muss
  // die Auslassung dastehen, samt ihrem Grund und dem Ausweg.
  has("Auslassung benannt", hint(j), "Ab 1000 Treffern werden die Vorkommen nicht ausgezählt");
  has("Grund benannt", hint(j), "weil nicht gezählt wurde");
  has("Ausweg benannt", hint(j), "auf ein Buch ein");
  // Der gezählte Fall muss frei von dem Hinweis bleiben.
  lacks("kleine Suche ohne den Hinweis", hint(searchLieb!.json), "Ab 1000 Treffern");
}

console.log("Bedingte Ausgabefelder");
{
  // Jedes dieser Felder fehlt aus einem gemessenen Grund, und jedes zerbräche
  // einen prüfenden Client, wäre es als required deklariert.
  check("Joh 7,53: ohne bezeugung", !("bezeugung" in (cmpOhneBezeugung!.json ?? {})));
  eq("Joh 7,53: kein Fehler", cmpOhneBezeugung!.isError, false);
  const sblgnt = (origSblgnt!.json?.woerter ?? []) as Array<Json>;
  check("Joh 3,16 (sblgnt): Wörter vorhanden", sblgnt.length > 0);
  check("Joh 3,16 (sblgnt): ohne Strong-Nummern", sblgnt.every((w) => !("strong" in w)));
  check("G26 vollständig gelistet: ohne hinweis", !("hinweis" in (concordVollstaendig!.json ?? {})));
  eq("Hiob 32,1-4 (MB): kein Klammerhinweis", hint(mengeOhneKlammer!.json), "");
  eq("Hiob 32,1-4 (MB): kein Fehler", mengeOhneKlammer!.isError, false);
}

console.log("Strukturierte Ausgabe");
{
  const schemaOf = new Map(
    tools.map((t) => [String(t.name), isRecord(t.outputSchema) ? t.outputSchema : undefined])
  );

  // Der Prüfer wird geprüft, bevor ihm vertraut wird, und zwar gegen die echte
  // Antwort eines echten Aufrufs statt gegen eine Attrappe. Fünf Arten, wie ein
  // Handler von seinem Schema abweichen könnte; jede einzelne muss auffallen.
  {
    const schema = schemaOf.get("bible_search");
    const proben: ReadonlyArray<readonly [string, (o: Json) => void]> = [
      ["Pflichtfeld entfernt", (o) => { delete o.treffer; }],
      ["Zahl als Zeichenkette", (o) => { o.treffer = String(o.treffer); }],
      ["verschachteltes Pflichtfeld entfernt", (o) => {
        delete (o.verteilung as Json[])[0]!.vorkommen;
      }],
      ["null-fähiges Pflichtfeld entfernt", (o) => {
        delete (o.quellen as Json[])[0]!.nennung;
      }],
      ["Array-Element falscher Form", (o) => {
        o.verse = (o.verse as Json[]).map((v) => String(v.stelle));
      }],
    ];
    check("Validator: Schema für bible_search vorhanden", schema !== undefined);
    check("Validator: gültige Antwort besteht", schema !== undefined && schemaErrors(schema, searchLieb!.json).length === 0);
    for (const [name, kaputtmachen] of proben) {
      const kaputt = JSON.parse(JSON.stringify(searchLieb!.json)) as Json;
      kaputtmachen(kaputt);
      check(
        `Validator erkennt: ${name}`,
        schema !== undefined && schemaErrors(schema, kaputt).length > 0
      );
    }
  }

  // Jeder Fall, keine Auswahl von Hand: Ein selten genommener Rückgabepfad, der
  // structuredContent vergisst, ist ein harter Client-Fehler, kein fehlendes
  // Feld.
  let geprueft = 0;
  results.forEach((r, i) => {
    const name = CALLS[i]![0];
    if (r.isError) {
      check(`${name} #${i}: Fehlerantwort ohne structuredContent`, r.structured === null);
      return;
    }
    // Kein Schema: entweder ein Werkzeug, das noch keines deklariert, oder der
    // Aufruf eines Werkzeugs, das es nicht gibt, dessen Abweisung ein
    // JSON-RPC-Fehler ist und daher kein zu prüfendes Ergebnis trägt. Beides
    // wird an anderer Stelle geprüft.
    const schema = schemaOf.get(name);
    if (schema === undefined) return;
    check(`${name} #${i}: structuredContent vorhanden`, r.structured !== null);
    if (r.structured === null) return;
    check(
      `${name} #${i}: structuredContent gleich Textblock`,
      JSON.stringify(r.structured) === JSON.stringify(r.json)
    );
    const fehler = schemaErrors(schema, r.structured);
    check(`${name} #${i}: schemagültig`, fehler.length === 0, fehler.slice(0, 3).join("; "));
    geprueft++;
  });
  check("mindestens ein Fall schemageprüft", geprueft > 0, `geprüft: ${geprueft}`);
  // bible_setup steht hier nicht in der Liste (die Datenbank existiert), also
  // müssen alle sieben gelisteten Werkzeuge eines deklarieren. Ein Werkzeug, das
  // sein Schema still verlöre, fiele sonst einfach aus der Schleife oben heraus
  // und nähme seine Prüfungen mit.
  for (const t of tools) {
    check(`${String(t.name)}: outputSchema deklariert`, isRecord(t.outputSchema));
  }
}

console.log("Prompts");
{
  const info = serverInfo!.json ?? {};
  const codes = (info.uebersetzungen as Array<{ code: string }>).map((t) => t.code);
  const editions = (info.urtext_editionen as Array<{ code: string }>).map((e) => e.code);
  const extras = (info.zusatzdaten ?? {}) as Record<string, boolean>;

  // `title` ist der Anzeigename im Prompt-Menü eines Clients; ohne ihn liest der
  // Nutzer den Bezeichner. Im Schema ist er optional, es bricht also nichts,
  // wenn ein vierter Prompt ihn vergisst: Diese Zusicherung ist das Einzige, dem
  // es auffällt.
  eq("drei Prompts gelistet", promptList.length, 3);
  for (const p of promptList) {
    check(`${String(p.name)}: title gesetzt`, typeof p.title === "string" && p.title !== "");
    check(`${String(p.name)}: name bleibt englisch`, /^[a-z-]+$/.test(String(p.name)));
  }

  // Ein fehlendes Pflichtargument erzeugte früher eine Anweisung mit einem Loch
  // darin (`Wortstudie zu „`), und der Prompt kam trotzdem als Erfolg zurück.
  //
  // Beide Meldungen werden wörtlich verglichen, und das ist Absicht: Genau das
  // verhindert, dass ein späterer Wechsel auf `McpError` durchginge. Diese
  // Klasse stellt dem Text auf dem Weg nach draußen "MCP error <code>: " voran
  // (types.js:2031); der Code sähe also richtig aus, während jeder Wortlaut
  // verrutscht wäre. Die Codes selbst sichert der Abschnitt „Fehlercodes"
  // weiter unten.
  eq("word-study ohne Argument: kein Prompt", wordStudyNoArg!.text, "");
  eq(
    "word-study ohne Argument: Meldung nennt das Feld",
    wordStudyNoArg!.error,
    "Missing required argument 'word'"
  );
  eq(
    "variant-check: überlanges Argument nennt die Grenze",
    variantTooLong!.error,
    "Argument 'reference' must be at most 100 characters"
  );

  // Feldnamen, nicht die Begriffe dahinter: Die Antwort spricht von
  // 'kurzbedeutung', nie von „Gloss".
  has("word-study nennt 'gesamt'", wordStudy!.text, "'gesamt'");
  has("word-study nennt 'buecher'", wordStudy!.text, "'buecher'");
  lacks("word-study ohne Konzeptnamen", wordStudy!.text, "Gloss");

  // Der Bestand ist abgeleitet, jeder Prompt nennt also, was diese Datenbank
  // hat, und nichts sonst.
  for (const code of codes) {
    has(`translation-compare nennt ${code}`, translationCompare!.text, `"${code}"`);
  }
  const genannt = [...translationCompare!.text.matchAll(/"([A-Z]{2,4})"/g)].map((m) => m[1]!);
  check(
    "translation-compare nennt keine ungeladene Übersetzung",
    genannt.every((c) => codes.includes(c)),
    `genannt: ${genannt.join(", ")}; geladen: ${codes.join(", ")}`
  );
  for (const ed of ["byzantine", "tr", "sblgnt"]) {
    eq(
      `variant-check nennt ${ed} genau dann, wenn geladen`,
      variantCheck!.text.includes(`texttyp "${ed}"`),
      editions.includes(ed)
    );
  }
  // Nur NT: Die AT-Edition hat kein Gegenstück, gegen das sich vergleichen ließe.
  lacks("variant-check ohne wlc", variantCheck!.text, "wlc");
  // Die Vorbehaltsfelder sind gemessen die, die übergangen werden, wenn sie tief
  // in der Antwort liegen; der Prompt, der die Textkritik steuert, muss sie
  // deshalb benennen.
  eq(
    "variant-check nennt 'in_dieser_db' genau dann, wenn TAGNT geladen",
    variantCheck!.text.includes("'in_dieser_db'"),
    extras.editionsbezeugung === true
  );
  eq(
    "variant-check nennt 'quellenkonflikte' genau dann, wenn TAGNT geladen",
    variantCheck!.text.includes("'quellenkonflikte'"),
    extras.editionsbezeugung === true
  );
}

console.log("Ressourcen");
{
  const info = serverInfo!.json ?? {};
  const codes = (info.uebersetzungen as Array<{ code: string }>).map((t) => t.code);
  const editions = (info.urtext_editionen as Array<{ code: string }>).map((e) => e.code);

  // Der Katalog ist der ganze Sinn des Entwurfs: Die Vorlagen tragen den
  // parametrisierten Raum, damit die Liste kein Katalog von 31 102 Versen wird.
  // Ändert sich eine der beiden Zahlen, ändern sich die Kosten jedes
  // Sitzungsbeginns.
  eq("vier statische Ressourcen gelistet", resourceList.length, 4);
  eq("drei Vorlagen gelistet", templateList.length, 3);
  for (const r of resourceList) {
    check(`${String(r.uri)}: Name gesetzt`, typeof r.name === "string" && r.name !== "");
    check(
      `${String(r.uri)}: Beschreibung gesetzt`,
      typeof r.description === "string" && r.description !== ""
    );
    eq(`${String(r.uri)}: mimeType`, r.mimeType, "application/json");
    check(`${String(r.uri)}: URI im Schema`, String(r.uri).startsWith("bible://"));
  }
  for (const t of templateList) {
    const tpl = String(t.uriTemplate);
    check(`${tpl}: enthält eine Variable`, /\{[a-z]+\}/.test(tpl));
    check(
      `${tpl}: Beschreibung gesetzt`,
      typeof t.description === "string" && t.description !== ""
    );
    eq(`${tpl}: mimeType`, t.mimeType, "application/json");
  }

  // Rundlauf: Alles, was die Liste anbietet, muss tatsächlich lesbar sein, und
  // die Antwort muss die URI zurücktragen, nach der gefragt wurde.
  const gelistet = [resBuecher, resUebersetzungen, resEditionen, resQuellen];
  resourceList.forEach((r, i) => {
    const gelesen = gelistet[i];
    eq(`${String(r.uri)}: lesbar`, gelesen?.error, "");
    eq(`${String(r.uri)}: URI zurückgegeben`, gelesen?.uri, r.uri);
    eq(`${String(r.uri)}: mimeType der Antwort`, gelesen?.mimeType, "application/json");
    check(`${String(r.uri)}: Inhalt ist JSON`, gelesen?.json !== null);
  });

  eq("bible://buecher: 66 Bücher", (resBuecher!.json?.buecher as Json[]).length, 66);
  const buecher = resBuecher!.json?.buecher as Array<{ nummer: number; testament: string }>;
  eq("bible://buecher: Buch 39 ist AT", buecher.find((b) => b.nummer === 39)?.testament, "AT");
  eq("bible://buecher: Buch 40 ist NT", buecher.find((b) => b.nummer === 40)?.testament, "NT");

  // Aus dem Bestand abgeleitet, nie eine feste Liste: Eine Instanz, der ein
  // Download fehlt, darf nicht anbieten, was sie nicht liefern kann.
  const gelisteteCodes = (
    resUebersetzungen!.json?.uebersetzungen as Array<{ kuerzel: string }>
  ).map((u) => u.kuerzel);
  eq(
    "bible://uebersetzungen nennt genau die geladenen",
    [...gelisteteCodes].sort().join(","),
    [...codes].sort().join(",")
  );
  const gelisteteEditionen = (
    resEditionen!.json?.editionen as Array<{ kuerzel: string }>
  ).map((e) => e.kuerzel);
  eq(
    "bible://editionen nennt genau die geladenen",
    [...gelisteteEditionen].sort().join(","),
    [...editions].sort().join(",")
  );

  // Die Namensnennung reist mit der Antwort, sie muss also je Ressource stimmen:
  // Eine behauptete Nennung, die nicht einschlägig ist, ist derselbe Fehler wie
  // eine fehlende.
  const quellenVonVers = resVersBereich!.json?.quellen as Array<{ nennung: string | null }>;
  eq("Schlachter-Vers: genau eine Quelle", quellenVonVers.length, 1);
  has("Schlachter-Vers: Nennung mit Adresse", quellenVonVers[0]?.nennung ?? "", "ebible.org");
  const quellenVonLut = resVersEinzeln!.json?.quellen as Array<{ nennung: string | null }>;
  eq("Luther-Vers: Nennung ist null", quellenVonLut[0]?.nennung, null);
  const alleQuellen = resQuellen!.json?.quellen as Array<{ werk: string }>;
  const werke = alleQuellen.map((q) => q.werk).join(" | ");
  const namen = (info.uebersetzungen as Array<{ name: string }>).map((t) => t.name);
  for (const name of namen) {
    has(`bible://quellen nennt die Übersetzung ${name}`, werke, name);
  }
  // Eine nicht geladene Edition darf nicht erscheinen: Eine behauptete Nennung,
  // die nicht einschlägig ist, ist derselbe Fehler wie eine weggelassene.
  eq(
    "bible://quellen nennt SBLGNT genau dann, wenn geladen",
    werke.includes("SBL Greek New Testament"),
    editions.includes("sblgnt")
  );

  // Die zusammengesetzte Zeichenkette war es, die in bible_crossrefs an beiden
  // Enden abgeschnitten wurde; eine Ressource trägt die Verse deshalb einzeln
  // und kein zusammengefügtes `text`.
  const verse = resKapitel!.json?.verse_einzeln as Array<{ verse: number; text: string }>;
  eq("Psalm 23: sechs Verse", verse.length, 6);
  eq("Psalm 23: erster Vers ist 1", verse[0]?.verse, 1);
  check("Kapitel-Ressource ohne zusammengesetztes 'text'", !("text" in (resKapitel!.json ?? {})));
  eq(
    "Versbereich: zwei Verse",
    (resVersBereich!.json?.verse_einzeln as Json[]).length,
    2
  );
  eq(
    "Einzelvers: ein Vers",
    (resVersEinzeln!.json?.verse_einzeln as Json[]).length,
    1
  );

  // Prozentkodierte und abgekürzte Buchnamen laufen durch denselben Helfer wie
  // bei den Werkzeugen: Ein zweiter Auflösungsweg ist genau das, was es nicht
  // geben darf.
  has("Buchname mit Punkt und %20", String(resKapitelPunkt!.json?.reference), "1 Mose 1,");
  has("Buchname mit Umlaut", String(resKapitelUmlaut!.json?.reference), "Römer 8,");

  // Der Grundtext leitet nach Testament weiter, genau wie das Werkzeug.
  eq("Grundtext AT: Edition wlc", resGrundtextAt!.json?.texttyp, "wlc");
  eq("Grundtext NT: Edition byzantine", resGrundtextNt!.json?.texttyp, "byzantine");
  check(
    "Grundtext liefert Wörter",
    (resGrundtextAt!.json?.woerter as Json[]).length > 0
  );

  // Negativfälle. Jeder nennt die verletzte Bedingung, und die beiden mit den
  // Werkzeugen geteilten Grenzen müssen mit genau denselben Worten gemeldet
  // werden.
  has("fremdes Schema abgewiesen", resFremdesSchema!.error, 'beginnen mit "bible://"');
  has("unbekannte Ressource nennt die bekannten", resUnbekannt!.error, "bible://buecher");
  has(
    "fehlendes Segment nennt die erwartete Form",
    resZuWenigSegmente!.error,
    "bible://kapitel/{uebersetzung}/{buch}/{kapitel}"
  );
  has("unbekanntes Buch nennt das nächstliegende", resBuchFehlt!.error, '"Hesekiel"');
  has(
    "Kapitelgrenze zeichengleich mit dem Werkzeug",
    resKapitelGrenze!.error,
    "Error: 'chapter' must be an integer between 1 and 150"
  );
  has(
    "Versliste zeichengleich mit dem Werkzeug",
    resVerslisteZuLang!.error,
    "Error: 'verses' must list at most 30 comma-separated segments"
  );
  has(
    "unbekannte Übersetzung nennt die erlaubten",
    resUebersetzungUnbekannt!.error,
    'Unknown translation "XYZ"'
  );
  has(
    "AT-Edition am NT-Buch abgewiesen",
    resEditionFalschesTestament!.error,
    "fürs NT ungültiger texttyp"
  );
  // Falsches Buch und falsches Kapitel zugleich: Das Werkzeug meldet das
  // Kapitel, also muss die Ressource es auch. Verglichen wird gegen die Antwort
  // des Werkzeugs selbst, nicht gegen ein Literal.
  has(
    "zwei verletzte Bedingungen: dieselbe wie beim Werkzeug",
    resZweiVerletzt!.error,
    lookupChap999!.text
  );
  // Neu formulierte Meldungen beginnen mit der Aussage; ein Client stellt sein
  // eigenes "MCP error <code>: " ohnehin davor.
  for (const [label, r] of [
    ["Form", resZuWenigSegmente],
    ["unbekannte Ressource", resUnbekannt],
    ["fremdes Schema", resFremdesSchema],
  ] as const) {
    check(
      `${label}: Meldung ohne "Error:"-Präfix`,
      !r!.error.replace(/^MCP error -?\d+: /, "").startsWith("Error:"),
      r!.error.slice(0, 80)
    );
  }

  // Die Bestandsauskunft nennt die Ressourcen, denn ob ein Client je nach den
  // Vorlagen fragt, ist nicht belegt.
  const gemeldet = (serverInfo!.json?.ressourcen ?? {}) as {
    statisch?: string[];
    vorlagen?: string[];
  };
  eq(
    "bible_server_info nennt dieselben Ressourcen wie resources/list",
    (gemeldet.statisch ?? []).join(","),
    resourceList.map((r) => String(r.uri)).join(",")
  );
  eq(
    "bible_server_info nennt dieselben Vorlagen wie resources/templates/list",
    (gemeldet.vorlagen ?? []).join(","),
    templateList.map((t) => String(t.uriTemplate)).join(",")
  );

  // Der Endpunkt ist öffentlich und authlos: Keine Ressource meldet Host-Details.
  const allerText = resourceResults.map((r) => r.text).join("\n");
  for (const verboten of ["/home/", "/Users/", "process", "uptime", "hostname"]) {
    lacks(`keine Host-Angabe: ${verboten}`, allerText, verboten);
  }
}

// --- Fehlercodes -------------------------------------------------------------
// Wessen Fehler vorliegt. Bis 0.5.10 sagte jede Abweisung, die durch den
// JSON-RPC-Kanal ging, `-32603 InternalError`, auch die vom Aufrufer
// verschuldeten; die Spezifikation verlangt für Prompts ausdrücklich `-32602`,
// und der McpServer des SDK antwortet damit auf ein unbekanntes Werkzeug wie
// auf eine unbekannte Ressource. Geprüft allein über stdio: Die Codes entstehen
// in den geteilten Handlern und nicht in einem Transport, HTTP liefe also durch
// dieselben Zeilen.
//
// Die Meldung wird neben dem Code zugesichert, wo oben schon eine steht. Dieses
// Paar ist die Sicherung gegen `McpError`, das den Code richtig setzte und dem
// Text auf dem Weg nach draußen "MCP error -32602: " voranstellte.
{
  console.log("Fehlercodes");
  const INVALID_PARAMS = -32602;
  for (const [label, r] of [
    ["unbekannter Prompt", wordStudyNoArg],
    ["überlanges Prompt-Argument", variantTooLong],
  ] as const) {
    eq(`${label}: InvalidParams`, r!.code, INVALID_PARAMS);
  }
  for (const [label, r] of [
    ["fremdes Schema", resFremdesSchema],
    ["unbekannte Ressource", resUnbekannt],
    ["falsche URI-Form", resZuWenigSegmente],
    ["unbekanntes Buch", resBuchFehlt],
    ["Kapitel außerhalb", resKapitelGrenze],
    ["unbekannte Übersetzung", resUebersetzungUnbekannt],
  ] as const) {
    eq(`Ressource, ${label}: InvalidParams`, r!.code, INVALID_PARAMS);
  }
  // Ein Werkzeug, das es nicht gibt, hat keinen `isError`-Kanal, durch den es antworten könnte.
  eq("unbekanntes Werkzeug: InvalidParams", unbekanntesWerkzeug!.code, INVALID_PARAMS);
  eq(
    "unbekanntes Werkzeug: Meldung nennt den Namen",
    unbekanntesWerkzeug!.error,
    "Unknown tool: bible_nichtvorhanden"
  );
  // Die Gegenprobe, die mehr wiegt als die sechs oben: Ein falsches Argument an
  // ein Werkzeug, das es gibt, bleibt ein Werkzeugergebnis. Daraus
  // JSON-RPC-Fehler zu machen verbärge sie vor dem Modell, und genau deshalb
  // sind sie Prosa.
  for (const [label, r] of [
    ["unbekanntes Buch", hesekiel],
    ["Kapitel außerhalb", lookupChap999],
    ["Versliste zu lang", versesTooLong],
  ] as const) {
    eq(`Werkzeug, ${label}: bleibt isError`, r!.isError, true);
    eq(`Werkzeug, ${label}: kein JSON-RPC-Fehler`, r!.code, NO_ERROR);
  }
}

// --- der Fehler des Servers selbst -------------------------------------------
// Die eine Abweisung, die `InternalError` behält, und der Grund, warum hier ein
// zweiter Server läuft: Eine Instanz ohne Datenbank ist ein Zustand des Servers
// und kein Fehler der Anfrage. Sie ist zugleich der Fall, den ein späterer
// Durchgang über die Wurfstellen am ehesten mit umstellte, und deshalb ist er
// hier festgenagelt.
{
  console.log("Instanz ohne Datenbank");
  const INTERNAL_ERROR = -32603;
  const ohneDb = await callTools(
    [["bible_lookup", { book: "Johannes", chapter: 3, verses: "16" }]],
    [],
    ["bible://buecher"],
    { BIBLE_DB_PATH: resolve(dirname(import.meta.dirname), "tmp/gibt-es-nicht.db") }
  );
  const [leerLookup] = ohneDb.results as ToolResult[] & { length: 1 };
  const [leerRessource] = ohneDb.resourceResults as ResourceResult[] & { length: 1 };

  eq("Ressource ohne Datenbank: InternalError", leerRessource!.code, INTERNAL_ERROR);
  has(
    "Ressource ohne Datenbank: nennt bible_setup (stdio)",
    leerRessource!.error,
    "bible_setup"
  );
  // Die Werkzeugsperre antwortet über `isError`, wie sie es mit Datenbank auch tut.
  eq("Werkzeug ohne Datenbank: bleibt isError", leerLookup!.isError, true);
  eq("Werkzeug ohne Datenbank: kein JSON-RPC-Fehler", leerLookup!.code, NO_ERROR);
  // Beide Listen sind leer, es wird also nichts angeboten, was sich nicht lesen lässt.
  eq("resources/list ohne Datenbank: leer", ohneDb.resourceList.length, 0);
  eq("resources/templates/list ohne Datenbank: leer", ohneDb.templateList.length, 0);
}

console.log(
  `\n${failures === 0 ? "OK" : "FEHLER"}: ${checks - failures}/${checks} Prüfungen bestanden`
);
process.exit(failures === 0 ? 0 : 1);
