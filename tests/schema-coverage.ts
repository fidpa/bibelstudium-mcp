/**
 * Breitenprüfung der Ausgabeschemata: viele echte Antworten, jede gegen das
 * Schema geprüft, das der Server selbst in `tools/list` deklariert.
 *
 * Warum es das neben `test-golden.ts` gibt. Seit 0.5.8 ist eine
 * Erfolgsantwort ohne `structuredContent`, oder mit einem Feld, das das Schema
 * nicht zulässt, kein unvollständiges Ergebnis mehr: Ein Client des 1.x-SDK
 * wirft, statt sie anzuzeigen. Der Golden-Test deckt die Fälle seiner
 * `CALLS`-Liste ab, und diese Liste ist das Einzige, was zwischen einem selten
 * genommenen Rückgabepfad und einem Fehler auf der Client-Seite steht, den
 * niemand sieht, bis ein Nutzer hineinläuft.
 *
 * Die beiden Prüfungen finden Verschiedenes und ersetzen einander nicht. Ein
 * Durchgang über einige hundert Aufrufe findet falsche Typen und vergessene
 * Rückgabepfade; das seltene bedingte Feld findet er nie. Gemessen am
 * 02.08.2026: 419 Antworten sauber geprüft, und der Klammerhinweis von
 * `bible_lookup` (137 von 31 166 Menge-Versen) erschien in keiner einzigen.
 * `test-golden.ts` benennt diesen Fall ausdrücklich.
 *
 * Zwei bedingte Felder werden deshalb gezielt angesteuert statt der Schrittweite
 * überlassen: `bezeugung` über die neun NT-Verse ohne TAGNT-Zeile, `fussnoten`
 * über Verse, die eine Fußnote tragen (1134 von 31 171, bei Schrittweite 700
 * sonst im Regelfall kein einziger). Stand 05.08.2026: 582 Aufrufe,
 * 578 sauber geprüft, 0 Schemafehler, 4 sachliche Fehlerantworten (drei Verse
 * ohne Querverweis, eine Suche ohne Treffer).
 *
 * Ausgaben mit eigener Versifikation bekommen ihre eigene Stichprobe. Die
 * Luther-Stichprobe trifft bei ihnen reihenweise daneben (gemessen 05.08.2026:
 * 136 Kapitel mit abweichender Verszahl, zwei Bücher mit abweichender
 * Kapitelzahl), und die Breite prüfte dann Fehlermeldungen statt Nutzlasten.
 *
 * Nicht Teil von `bun run test`: Die Prüfung braucht die gebaute Datenbank,
 * dauert rund eine Minute und ist von Hand auszuführen, nachdem ein Schema oder
 * eine Nutzlast angefasst wurde:
 *
 *   bun run test:schemas
 *
 * Die Stichprobe steht fest (feste Schrittweite, nichts Zufälliges); zwei Läufe
 * auf derselben Datenbank sind deshalb unmittelbar vergleichbar.
 */
import { Database } from "bun:sqlite";
import { resolve, dirname } from "node:path";
import { DB_PATH } from "../db-path.ts";
import { isRecord, schemaErrors, type Json } from "./schema-validator.ts";

const SERVER = resolve(dirname(import.meta.dirname), "server.ts");
const STRIDE = 700; // jeder n-te Luther-Vers: rund 45 Verse, rund 430 Aufrufe, rund eine Minute

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

// Welche Übersetzungen die Datenbank überhaupt führt. Fest verdrahtet wäre die
// Liste genau auf der Instanz falsch, der eine fehlt.
const geladeneUebersetzungen = (
  db.query("SELECT DISTINCT translation FROM verses ORDER BY translation").all() as Array<{
    translation: string;
  }>
).map((r) => r.translation);

// Ausgaben mit abweichender Versifikation bekommen ihre eigene Stichprobe. Die
// Ausgaben mit deutscher Zählung weichen von Luther in 136 Kapiteln in der
// Verszahl ab und in zwei Büchern in der Kapitelzahl (gemessen 05.08.2026); mit
// der Luther-Stichprobe abgefragt lieferten sie reihenweise „nicht gefunden",
// und die Breite prüfte dann Fehlermeldungen statt Nutzlasten.
const eigeneStichprobe = new Map<string, Ref[]>();
for (const translation of geladeneUebersetzungen) {
  if (translation === "LUT") continue;
  const fremd = db
    .query(
      "SELECT COUNT(*) AS n FROM (SELECT book_id, chapter, verse FROM verses WHERE translation=? " +
        "EXCEPT SELECT book_id, chapter, verse FROM verses WHERE translation='LUT')"
    )
    .get(translation) as { n: number };
  if (fremd.n === 0) continue;
  eigeneStichprobe.set(
    translation,
    db
      .query(
        "SELECT book_id, chapter, verse FROM (SELECT book_id, chapter, verse, " +
          "ROW_NUMBER() OVER (ORDER BY book_id, chapter, verse) rn FROM verses WHERE translation=?) " +
          `WHERE rn % ${STRIDE} = 1`
      )
      .all(translation) as Ref[]
  );
}

// Verse mit Fußnote: `fussnoten` hängt an 1134 von 31 171 Versen und erschiene
// bei Schrittweite 700 im Regelfall kein einziges Mal. Wie bei den TAGNT-Versen
// unten wird das bedingte Feld deshalb gezielt angesteuert, sonst prüft die
// Breite ein Schema, dessen bedingten Zweig sie nie sieht.
const mitFussnote = db
  .query("SELECT name FROM sqlite_master WHERE type='table' AND name='verse_notes'")
  .get()
  ? (db
      .query(
        "SELECT DISTINCT translation, book_id, chapter, verse FROM verse_notes " +
          "ORDER BY translation, book_id, chapter, verse LIMIT 25"
      )
      .all() as Array<Ref & { translation: string }>)
  : [];

// Die neun NT-Verse ohne TAGNT-Zeile: Dort fehlt `bezeugung`, und genau solch
// ein bedingtes Feld übersähe eine Stichprobe mit fester Schrittweite.
const ohneTagnt = db.query(
  "SELECT DISTINCT book_id, chapter, verse FROM original_words WHERE edition='byzantine' AND book_id>=40 " +
    "EXCEPT SELECT DISTINCT book_id, chapter, verse FROM tagnt_words"
).all() as Ref[];

type Call = readonly [string, Json];
const calls: Call[] = [["bible_server_info", {}]];

for (const s of sample) {
  const book = books.get(s.book_id)!;
  for (const translation of geladeneUebersetzungen) {
    if (eigeneStichprobe.has(translation)) continue; // kommt unten mit eigener Stichprobe
    calls.push(["bible_lookup", { book, chapter: s.chapter, verses: String(s.verse), translation }]);
  }
  calls.push(["bible_lookup", { book, chapter: s.chapter }]); // ganzes Kapitel
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
for (const [translation, refs] of eigeneStichprobe) {
  for (const s of refs) {
    const book = books.get(s.book_id)!;
    calls.push(["bible_lookup", { book, chapter: s.chapter, verses: String(s.verse), translation }]);
    calls.push(["bible_lookup", { book, chapter: s.chapter, translation }]);
  }
  // Einmal je Ausgabe, ohne Buchgrenze: Eine Suche je Stichprobenvers fragte
  // dasselbe Schema immer wieder ab und lieferte überwiegend „keine Treffer",
  // weil ein einzelnes Buch das gesuchte Wort meist nicht führt.
  calls.push(["bible_search", { query: "Gnade", translation, limit: 5 }]);
}
for (const v of mitFussnote) {
  const book = books.get(v.book_id)!;
  calls.push([
    "bible_lookup",
    { book, chapter: v.chapter, verses: String(v.verse), translation: v.translation },
  ]);
}
for (const v of ohneTagnt) {
  const book = books.get(v.book_id)!;
  calls.push(["bible_compare", { book, chapter: v.chapter, verse: v.verse }]);
}
// Griechisch und Hebräisch, Lemma und Strong-Nummer, mit und ohne
// Lexikoneintrag, ober- und unterhalb der Auflistungsgrenze.
for (const args of [
  { strong: "G26" }, { strong: "G26", limit: 200 }, { strong: "H430" },
  { strong: "G2316", limit: 5 }, { lemma: "ἀγάπη" }, { lemma: "λόγος", texttyp: "sblgnt" },
  { strong: "G5547", texttyp: "tr" }, { strong: "H7225" }, { strong: "G3056", limit: 1 },
] as Json[]) calls.push(["bible_concordance", args]);
// Unter und über OCCURRENCE_SCAN_LIMIT, eingeschränkt und uneingeschränkt, ohne Treffer.
for (const args of [
  { query: "Hirte" }, { query: "der", limit: 2 }, { query: "Gnade", book: "Römer" },
  { query: '"Gnade um Gnade"' }, { query: "lieb*", translation: "MB" },
  { query: "Zebaoth", book: "Amos" }, { query: "xyzabc" },
  { query: "Hirte", book: "Johannes", limit: 50 },
] as Json[]) calls.push(["bible_search", args]);
// Die Wortlaut-Grenze der Ausgaben, je Übersetzung. Die Stichprobe oben trifft
// sie kaum: Sie fragt überwiegend einzelne Verse ab, und ihre Kapitel sind
// meistens kurz genug. Ohne diese drei Zeilen sähe der Breitentest die drei
// bedingt gewordenen Felder (`gekuerzt`, `verse[].text`, `verweise[].text`)
// nie, und genau für sie wurde `required` gelockert.
for (const translation of geladeneUebersetzungen) {
  calls.push(["bible_lookup", { book: "Psalm", chapter: 119, translation }]);
  calls.push(["bible_search", { query: "Gnade", translation, limit: 50 }]);
  calls.push([
    "bible_crossrefs",
    { book: "Johannes", chapter: 3, verse: 16, limit: 30, translation },
  ]);
}

// --- mit einem frischen Server über stdio sprechen --------------------------

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

// --- prüfen ------------------------------------------------------------------

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
    // Fehlerergebnisse bleiben absichtlich reiner Text, und ein Client des
    // 1.x-SDK nimmt sie von der Prüfung aus. Struktur dürfen sie ebenfalls nicht
    // tragen.
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

// Was der Durchgang tatsächlich berührt hat. Ein Feld, das hier nie auftaucht,
// deckt diese Prüfung nicht ab und braucht einen benannten Fall in
// `test-golden.ts`.
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
