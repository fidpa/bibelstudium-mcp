/**
 * Breadth check for the output schemas: many real answers, each validated
 * against the schema the server itself declares in `tools/list`.
 *
 * Why this exists next to `test-golden.ts`. Since 0.5.8 a success answer that
 * misses `structuredContent`, or carries a field the schema does not allow, is
 * no longer an incomplete result — a client of the 1.x SDK throws instead of
 * showing it. The golden test covers the cases in its `CALLS` list, and that
 * list is the only thing standing between a rarely taken return path and a
 * client-side error nobody sees until a user hits it.
 *
 * The two checks find different defects and do not replace each other. A sweep
 * of a few hundred calls finds wrong types and forgotten return paths; it never
 * finds the rare conditional field. Measured 02.08.2026: 419 answers validated
 * clean, and the bracket hint of `bible_lookup` (137 of 31 166 Menge verses)
 * appeared in none of them — `test-golden.ts` names that case explicitly.
 *
 * Not part of `bun run test`: it needs the built database, takes about a minute
 * and is a check to run by hand after touching a schema or a payload:
 *
 *   bun run test:schemas
 *
 * The sample is deterministic (fixed stride, no randomness), so two runs on the
 * same database compare directly.
 */
import { Database } from "bun:sqlite";
import { resolve, dirname } from "node:path";
import { DB_PATH } from "../db-path.ts";
import { isRecord, schemaErrors, type Json } from "./schema-validator.ts";

const SERVER = resolve(dirname(import.meta.dirname), "server.ts");
const STRIDE = 700; // every nth Luther verse — ~45 verses, ~430 calls, ~1 minute

const db = new Database(DB_PATH, { readonly: true });
const books = new Map(
  (db.query("SELECT book_id, name FROM books").all() as Array<{ book_id: number; name: string }>)
    .map((b) => [b.book_id, b.name])
);
if (books.size === 0) {
  console.error(`Keine Bücher in ${DB_PATH}. Erst 'bun run setup' laufen lassen.`);
  process.exit(1);
}

type Ref = { book_id: number; chapter: number; verse: number };

const sample = db.query(
  "SELECT book_id, chapter, verse FROM (SELECT book_id, chapter, verse, " +
    "ROW_NUMBER() OVER (ORDER BY book_id, chapter, verse) rn FROM verses WHERE translation='LUT') " +
    `WHERE rn % ${STRIDE} = 1`
).all() as Ref[];

// The nine NT verses without a TAGNT row: `bezeugung` is absent there, and that
// is exactly the kind of conditional field a stride sample would miss.
const ohneTagnt = db.query(
  "SELECT DISTINCT book_id, chapter, verse FROM original_words WHERE edition='byzantine' AND book_id>=40 " +
    "EXCEPT SELECT DISTINCT book_id, chapter, verse FROM tagnt_words"
).all() as Ref[];

type Call = readonly [string, Json];
const calls: Call[] = [["bible_server_info", {}]];

for (const s of sample) {
  const book = books.get(s.book_id)!;
  for (const translation of ["LUT", "SCH", "ELB", "MB"]) {
    calls.push(["bible_lookup", { book, chapter: s.chapter, verses: String(s.verse), translation }]);
  }
  calls.push(["bible_lookup", { book, chapter: s.chapter }]); // whole chapter
  calls.push(["bible_lookup", { book, chapter: s.chapter, verses: `${s.verse}-${s.verse + 2}` }]);
  calls.push(["bible_crossrefs", { book, chapter: s.chapter, verse: s.verse }]);
  if (s.book_id >= 40) {
    for (const texttyp of ["byzantine", "tr", "sblgnt"]) {
      calls.push(["bible_original", { book, chapter: s.chapter, verse: s.verse, texttyp }]);
    }
    calls.push(["bible_compare", { book, chapter: s.chapter, verse: s.verse }]);
  } else {
    calls.push(["bible_original", { book, chapter: s.chapter, verse: s.verse }]);
  }
}
for (const v of ohneTagnt) {
  const book = books.get(v.book_id)!;
  calls.push(["bible_compare", { book, chapter: v.chapter, verse: v.verse }]);
}
// Greek and Hebrew, lemma and Strong's, with and without a lexicon entry, above
// and below the listing limit.
for (const args of [
  { strong: "G26" }, { strong: "G26", limit: 200 }, { strong: "H430" },
  { strong: "G2316", limit: 5 }, { lemma: "ἀγάπη" }, { lemma: "λόγος", texttyp: "sblgnt" },
  { strong: "G5547", texttyp: "tr" }, { strong: "H7225" }, { strong: "G3056", limit: 1 },
] as Json[]) calls.push(["bible_concordance", args]);
// Below and above OCCURRENCE_SCAN_LIMIT, restricted and unrestricted, no hit.
for (const args of [
  { query: "Hirte" }, { query: "der", limit: 2 }, { query: "Gnade", book: "Römer" },
  { query: '"Gnade um Gnade"' }, { query: "lieb*", translation: "MB" },
  { query: "Zebaoth", book: "Amos" }, { query: "xyzabc" },
  { query: "Hirte", book: "Johannes", limit: 50 },
] as Json[]) calls.push(["bible_search", args]);

// --- talk to a fresh server over stdio --------------------------------------

const proc = Bun.spawn(["bun", "run", SERVER], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
const send = (m: unknown) => proc.stdin.write(JSON.stringify(m) + "\n");
send({
  jsonrpc: "2.0", id: 0, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "schema-coverage", version: "1" } },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
calls.forEach(([name, args], i) =>
  send({ jsonrpc: "2.0", id: 2 + i, method: "tools/call", params: { name, arguments: args } })
);
await proc.stdin.flush();

const seen = new Map<number, Json>();
const dec = new TextDecoder();
const reader = proc.stdout.getReader();
const deadline = Date.now() + 600_000;
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
  console.error(
    `Server antwortete nur auf ${seen.size} von ${calls.length + 1} Anfragen. ` +
      "Läuft 'bun install', und existiert die Datenbank?"
  );
  process.exit(1);
}

// --- validate ----------------------------------------------------------------

const tools = ((seen.get(1) as { result?: { tools?: Json[] } }).result?.tools ?? []);
const schemas = new Map<string, Json>();
for (const t of tools) if (isRecord(t.outputSchema)) schemas.set(String(t.name), t.outputSchema);

const befunde: string[] = [];
const felder = new Map<string, Set<string>>();
let gueltig = 0, fehlerhaft = 0, ohneStruktur = 0, ungleich = 0, fehlerantworten = 0, ohneSchema = 0;

for (let i = 0; i < calls.length; i++) {
  const [name, args] = calls[i]!;
  const m = seen.get(2 + i) as {
    result?: { content?: Array<{ text?: string }>; structuredContent?: Json; isError?: boolean };
  };
  const result = m.result;
  if (!result) continue;
  const wo = `${name} ${JSON.stringify(args)}`;
  if (result.isError === true) {
    // Error results stay plain text on purpose, and a client of the 1.x SDK
    // exempts them from validation. They must not carry structure either.
    if (result.structuredContent !== undefined) befunde.push(`${wo}: isError, trägt aber structuredContent`);
    fehlerantworten++;
    continue;
  }
  const struktur = result.structuredContent;
  if (struktur === undefined) {
    ohneStruktur++;
    befunde.push(`${wo}: Erfolgsantwort ohne structuredContent (Client wirft InvalidRequest)`);
    continue;
  }
  const text = result.content?.[0]?.text ?? "";
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(struktur)) {
    ungleich++;
    befunde.push(`${wo}: Textblock und structuredContent sind nicht gleich`);
  }
  const gesehen = felder.get(name) ?? new Set<string>();
  Object.keys(struktur).forEach((k) => gesehen.add(k));
  felder.set(name, gesehen);

  const schema = schemas.get(name);
  if (schema === undefined) { ohneSchema++; continue; }
  const fehler = schemaErrors(schema, struktur);
  if (fehler.length === 0) gueltig++;
  else {
    fehlerhaft++;
    if (befunde.length < 15) befunde.push(`${wo}\n     ${fehler.join("\n     ")}`);
  }
}

console.log(`Aufrufe: ${calls.length} (Stichprobe: jeder ${STRIDE}. Vers)`);
console.log(`Werkzeuge mit outputSchema: ${schemas.size} von ${tools.length}`);
console.log(
  `\ngültig: ${gueltig} | Schemafehler: ${fehlerhaft} | ohne structuredContent: ${ohneStruktur} | ` +
    `Text ungleich Struktur: ${ungleich} | Fehlerantworten: ${fehlerantworten} | ohne Schema: ${ohneSchema}`
);

// What the sweep actually touched. A field that never shows up here is not
// covered by this check and needs a named case in `test-golden.ts`.
console.log("\nGesehene Felder je Werkzeug:");
for (const [name, gesehen] of [...felder].sort()) {
  console.log(`  ${name}: ${[...gesehen].sort().join(", ")}`);
}

if (befunde.length > 0) {
  console.log("\nBefunde:\n - " + befunde.join("\n - "));
  console.log(`\nFEHLER: ${fehlerhaft + ohneStruktur + ungleich} Antworten beanstandet`);
  process.exit(1);
}
console.log(`\nOK: ${gueltig} Antworten entsprechen ihrem Schema`);
