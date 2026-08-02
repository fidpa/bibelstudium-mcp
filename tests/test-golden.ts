/**
 * Regression check for server correctness.
 *
 * Talks to a FRESH `server.ts` over stdio, so it never measures the possibly
 * stale MCP instance of a running editor session.
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
import packageJson from "../package.json";

const SERVER = resolve(dirname(import.meta.dirname), "server.ts");

type Json = Record<string, unknown>;
type ToolResult = { text: string; json: Json | null; isError: boolean };
/**
 * A `prompts/get` answer. Prompts have no `isError` channel, so a rejected
 * argument arrives as a JSON-RPC error rather than as a result — `error` holds
 * its message, `text` the rendered prompt of a successful call.
 */
type PromptResult = { text: string; error: string };

// --- minimal stdio MCP client ----------------------------------------------

async function callTools(
  calls: ReadonlyArray<readonly [string, Json]>,
  prompts: ReadonlyArray<readonly [string, Json]> = []
): Promise<{ tools: Json[]; results: ToolResult[]; promptResults: PromptResult[] }> {
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
  prompts.forEach(([name, args], i) =>
    send({
      jsonrpc: "2.0",
      id: 2 + calls.length + i,
      method: "prompts/get",
      params: { name, arguments: args },
    })
  );
  await w.flush();

  const expected = calls.length + prompts.length + 1;
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

  const promptResults = prompts.map((_, i) => {
    const m = seen.get(2 + calls.length + i) as {
      result?: { messages?: Array<{ content?: { text?: string } }> };
      error?: { message?: string };
    };
    return {
      text: m.result?.messages?.[0]?.content?.text ?? "",
      error: m.error?.message ?? "",
    };
  });

  return { tools: listed.result?.tools ?? [], results, promptResults };
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

// Input at and just past the derived bounds of `verses` (MAX_VERSE_PARTS = 30
// segments, MAX_VERSE = 200, hence 30 × "176-176" + 29 commas = 239 characters).
// Built here rather than pasted so the length stays evident.
const VERSES_MAX_VALID = Array(30).fill("100-176").join(","); // 239 chars, all legal
const VERSES_TOO_LONG = `${VERSES_MAX_VALID},1`; // 241 chars
const VERSES_TOO_MANY = Array.from({ length: 35 }, (_, i) => String(i + 1)).join(",");
const OVERLONG_NAME = "J".repeat(60);

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
  // server identity — the version must be the packaged one, not a second place
  ["bible_server_info", {}],
  // `verses`: one case per error class, plus the largest valid input. Every
  // message must name the condition that is actually violated, and none of the
  // four bounds may shorten an answer in silence.
  ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_TOO_MANY }],
  ["bible_lookup", { book: "Ps", chapter: 117, verses: "1-500" }],
  ["bible_lookup", { book: "Ps", chapter: 117, verses: "1-500,2" }],
  ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_TOO_LONG }],
  ["bible_lookup", { book: "Ps", chapter: 119, verses: { kein: "string" } }],
  ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_MAX_VALID }],
  // an overlong book name is a length problem, not a missing or unknown field
  ["bible_crossrefs", { book: OVERLONG_NAME, chapter: 1, verse: 1 }],
  ["bible_search", { query: "Gnade", book: OVERLONG_NAME }],
  ["bible_concordance", { lemma: "α".repeat(60) }],
  // above the scan limit the two counted fields drop out — say so
  ["bible_search", { query: "der", limit: 2 }],
] as const satisfies ReadonlyArray<readonly [string, Json]>;

// Prompts name the loaded inventory and the fields of the answers they steer,
// so they are checked against `bible_server_info` rather than against a fixed
// wording: a hard-coded translation or edition list would go stale exactly on
// the instance that lacks one of them.
const PROMPT_CALLS = [
  ["word-study", { word: "Liebe" }],
  ["word-study", {}],
  ["variant-check", { reference: "1. Johannes 5,7" }],
  ["variant-check", { reference: OVERLONG_NAME.repeat(2) }],
  ["translation-compare", { reference: "Römer 8,1" }],
] as const satisfies ReadonlyArray<readonly [string, Json]>;

const { tools, results, promptResults } = await callTools(CALLS, PROMPT_CALLS);
const [wordStudy, wordStudyNoArg, variantCheck, variantTooLong, translationCompare] =
  promptResults as PromptResult[] & { length: 5 };
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
] = results as ToolResult[] & { length: 26 };

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
  // Against the one failure this tool exists to prevent: a version maintained in
  // a second place. Compares against package.json, not against a literal here.
  eq("version == package.json", j?.version, packageJson.version);
  eq("kein Fehler", serverInfo!.isError, false);
  const geladen = j?.uebersetzungen as Array<{ code: string; name: string }> | undefined;
  check("Übersetzungen gelistet", Array.isArray(geladen) && geladen.length > 0);
  // Each name must carry its edition year: "Schlachter" alone does not identify a
  // text, and 1951 differs from 2000 in wording.
  for (const t of geladen ?? []) {
    check(`${t.code}: Jahreszahl im Namen`, /\d{4}/.test(t.name), `war "${t.name}"`);
  }
  const editionen = j?.urtext_editionen as Array<{ code: string; name: string }> | undefined;
  has("Urtext: Mehrheitstext", JSON.stringify(editionen), "byzantine");
  has("Urtext: AT (WLC)", JSON.stringify(editionen), "wlc");
  // Every edition must carry a resolved name: "tr" alone identifies no text, and
  // name === code means the EDITION_META fallback silently took over.
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

console.log("Verslisten-Grenzen");
{
  // The house error of this server is the silent cut: a bound bites, the answer
  // gets shorter, nothing says so, and it still looks complete. "1,2,…,35" on
  // Ps 119 came back as 1-30 without a word (26.07.2026).
  eq(
    "35 Segmente: abgewiesen statt gekürzt",
    versesTooMany!.text,
    "Error: 'verses' must list at most 30 comma-separated segments"
  );
  eq("35 Segmente: isError", versesTooMany!.isError, true);
  // Same meaning, two paths: the fast path for a plain span skipped the bound
  // entirely, the parseVerses path dropped the segment. Both must report now.
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
  // The counterpart, and the reason the character bound is derived rather than
  // chosen: at 239 characters everything is legal and must pass. The old,
  // hand-picked 200 rejected exactly this input.
  eq("239 Zeichen gültig: kein Fehler", versesMaxValid!.isError, false);
  eq("239 Zeichen gültig: volle Spanne", versesMaxValid!.json?.reference, "Psalter 119,100-176");
}

console.log("Längenmeldungen");
{
  // Named the wrong condition before: bible_crossrefs said 'book' is required
  // while book was set, bible_search said it must be a German book name while
  // it was one, only too long (26.07.2026).
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
  // What is missing gets estimated and still reads as counted, so the omission
  // has to be stated along with its reason and the way out.
  has("Auslassung benannt", hint(j), "Ab 1000 Treffern werden die Vorkommen nicht ausgezählt");
  has("Grund benannt", hint(j), "weil nicht gezählt wurde");
  has("Ausweg benannt", hint(j), "auf ein Buch ein");
  // The counted case must stay free of the note.
  lacks("kleine Suche ohne den Hinweis", hint(searchLieb!.json), "Ab 1000 Treffern");
}

console.log("Prompts");
{
  const info = serverInfo!.json ?? {};
  const codes = (info.uebersetzungen as Array<{ code: string }>).map((t) => t.code);
  const editions = (info.urtext_editionen as Array<{ code: string }>).map((e) => e.code);
  const extras = (info.zusatzdaten ?? {}) as Record<string, boolean>;

  // A missing required argument used to produce an instruction with a hole in
  // it ("Wortstudie zu „"), and the prompt still came back as a success.
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

  // Field names, not the concepts behind them: the answer speaks of
  // 'kurzbedeutung', never of "Gloss".
  has("word-study nennt 'gesamt'", wordStudy!.text, "'gesamt'");
  has("word-study nennt 'buecher'", wordStudy!.text, "'buecher'");
  lacks("word-study ohne Konzeptnamen", wordStudy!.text, "Gloss");

  // Inventory is derived, so every prompt names what this database has and
  // nothing else.
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
  // NT only — the OT edition has no counterpart to compare against.
  lacks("variant-check ohne wlc", variantCheck!.text, "wlc");
  // The caveat fields are the ones measured to be skipped when they sit deep in
  // the answer, so the prompt that steers text criticism must name them.
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

console.log(
  `\n${failures === 0 ? "OK" : "FEHLER"}: ${checks - failures}/${checks} Prüfungen bestanden`
);
process.exit(failures === 0 ? 0 : 1);
