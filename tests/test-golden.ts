/**
 * Regression check for server correctness.
 *
 * Talks to a FRESH `server.ts` over stdio, so it never measures the possibly
 * stale MCP instance of a running editor session (see AGENTS.md).
 *
 * Assertion-based rather than a stored snapshot: the expectations stay readable
 * as statements about the data ("Psalm 23:1 has six words", "the Comma is TR
 * only") instead of a wall of text nobody diffs by hand.
 *
 * Needs a built database, so CI cannot run it (the workflow has no data). Run
 * it locally after changing server.ts:
 *
 *   bun run test
 */
import { resolve, dirname } from "node:path";

const SERVER = resolve(dirname(import.meta.dirname), "server.ts");

type Json = Record<string, unknown>;
type ToolResult = { text: string; json: Json | null; isError: boolean };

// --- minimal stdio MCP client ----------------------------------------------

async function callTools(
  calls: ReadonlyArray<readonly [string, Json]>
): Promise<{ tools: Json[]; results: ToolResult[] }> {
  const proc = Bun.spawn(["bun", "run", SERVER], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
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
  await w.flush();

  const seen = new Map<number, Json>();
  const dec = new TextDecoder();
  const reader = proc.stdout.getReader();
  const deadline = Date.now() + 120_000;
  let buf = "";
  while (seen.size < calls.length + 1 && Date.now() < deadline) {
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

  if (seen.size < calls.length + 1) {
    throw new Error(
      `Server antwortete nur auf ${seen.size} von ${calls.length + 1} Anfragen. ` +
        `Läuft 'bun install', und existiert data/bible.db?`
    );
  }

  const listed = seen.get(1) as { result?: { tools?: Json[] } };
  const results = calls.map((_, i) => {
    const m = seen.get(2 + i) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };
    const text = m.result?.content?.[0]?.text ?? "";
    let json: Json | null = null;
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = null; // error results are plain text, not JSON
    }
    return { text, json, isError: m.result?.isError === true };
  });

  return { tools: listed.result?.tools ?? [], results };
}

// --- assertions -------------------------------------------------------------

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
 * Substring check over NFC-normalised text.
 *
 * Necessary, not cosmetic: `tagnt_words` carries the Oxia codepoints (U+1F73 …)
 * for 46 095 of its 141 720 surfaces, while `original_words` is uniformly NFC
 * (Tonos, U+03AD …). Both render identically, and `ἐπέβαλον` from one source
 * does not equal `ἐπέβαλον` from the other bytewise. Without normalising here,
 * an assertion would fail over a difference nobody can see.
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

// --- cases ------------------------------------------------------------------

const CALLS = [
  // bounds — the message must name the real limit, not "positive integer"
  ["bible_original", { book: "Ps", chapter: 23, verse: 999 }],
  ["bible_original", { book: "Ps", chapter: 999, verse: 1 }],
  ["bible_crossrefs", { book: "Joh", chapter: 3, verse: 999 }],
  ["bible_compare", { book: "1Joh", chapter: 5, verse: 999 }],
  ["bible_lookup", { book: "Ps", chapter: 999 }],
  // book resolution
  ["bible_lookup", { book: "Hesekiel-Zusatz", chapter: 1, verses: "1" }],
  ["bible_lookup", { book: "Sirach", chapter: 1, verses: "1" }],
  // brackets: Menge sets bracketed additions, the other three do not
  ["bible_lookup", { book: "Joh", chapter: 3, verses: "16" }],
  ["bible_lookup", { book: "1. Mose", chapter: 15, verses: "3", translation: "MB" }],
  // data correctness
  ["bible_compare", { book: "1Joh", chapter: 5, verse: 7 }],
  ["bible_compare", { book: "Mk", chapter: 14, verse: 46 }],
  ["bible_original", { book: "Psalm", chapter: 23, verse: 1 }],
  ["bible_search", { query: "lieb*", book: "1Joh" }],
  ["bible_crossrefs", { book: "Joh", chapter: 14, verse: 6, limit: 5 }],
] as const satisfies ReadonlyArray<readonly [string, Json]>;

const { tools, results } = await callTools(CALLS);
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
] = results as ToolResult[] & { length: 15 };

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

console.log("Werkzeug-Annotationen");
eq("sechs Werkzeuge gelistet", tools.length, 6);
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
  // Word counts are stated so nobody has to count: the Comma was reported as 16
  // additional words where diff and TAGNT attestation both say 17 (25.07.2026).
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

console.log(
  `\n${failures === 0 ? "OK" : "FEHLER"}: ${checks - failures}/${checks} Prüfungen bestanden`
);
process.exit(failures === 0 ? 0 : 1);
