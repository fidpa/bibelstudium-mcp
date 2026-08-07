/**
 * Die drei geführten Prompts: `word-study`, `variant-check`, `translation-compare`.
 *
 * Ein Prompt nennt den geladenen Bestand und die Felder der Antworten, die er
 * steuert. Geprüft wird deshalb gegen die Selbstauskunft und nicht gegen einen
 * festen Wortlaut: Eine fest verdrahtete Liste von Übersetzungen oder Editionen
 * veraltete genau auf der Instanz, der eine davon fehlt.
 *
 * Einzeln lauffähig: `bun run tests/golden/prompts.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, lacks, abschluss } from "../lib/zusicherungen.ts";
import { INVALID_PARAMS } from "../lib/mcp-client.ts";
import { serverInfoBuendel } from "./server-info.ts";

const OVERLONG_NAME = "J".repeat(60);

export const promptsBuendel = buendel({
  name: "prompts",
  calls: {},
  prompts: {
    wordStudy: ["word-study", { word: "Liebe" }],
    wordStudyNoArg: ["word-study", {}],
    // Der Prompt, den es nicht gibt. Bis zum 06.08.2026 trug der Fall darunter
    // dieses Etikett, ohne den Zweig je zu betreten: `word-study` ohne Argument
    // ist ein fehlendes Argument, kein unbekannter Name.
    promptUnbekannt: ["gibt-es-nicht", {}],
    variantCheck: ["variant-check", { reference: "1. Johannes 5,7" }],
    variantTooLong: ["variant-check", { reference: OVERLONG_NAME.repeat(2) }],
    translationCompare: ["translation-compare", { reference: "Römer 8,1" }],
  },
  pruefe({ prompts }, ctx) {
    const { wordStudy, wordStudyNoArg, variantCheck, variantTooLong, translationCompare, promptUnbekannt } =
      prompts;

  const info = ctx.fremd("server-info.serverInfo").json ?? {};
  const codes = (info.uebersetzungen as Array<{ code: string }>).map((t) => t.code);
  const editions = (info.urtext_editionen as Array<{ code: string }>).map((e) => e.code);
  const extras = (info.zusatzdaten ?? {}) as Record<string, boolean>;

  // `title` ist der Anzeigename im Prompt-Menü eines Clients; ohne ihn liest der
  // Nutzer den Bezeichner. Im Schema ist er optional, es bricht also nichts,
  // wenn ein vierter Prompt ihn vergisst: Diese Zusicherung ist das Einzige, dem
  // es auffällt.
  eq("drei Prompts gelistet", ctx.promptList.length, 3);
  for (const p of ctx.promptList) {
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

    // Ein Prompt hat keinen `isError`-Kanal: Ein abgewiesenes Argument kommt als
    // JSON-RPC-Fehler an, und der Code gehört zur Aussage.
    for (const [label, r] of [
      ["fehlendes Prompt-Argument", wordStudyNoArg],
      ["überlanges Prompt-Argument", variantTooLong],
      ["unbekannter Prompt", promptUnbekannt],
    ] as const) {
      eq(`${label}: InvalidParams`, r.code, INVALID_PARAMS);
    }
    // Und dass es der Zweig für den Namen ist, nicht der für das Argument:
    // Beide melden `-32602`, der Code allein unterscheidet sie nicht.
    has("unbekannter Prompt: nennt den Namen", promptUnbekannt.error, "Unknown prompt: gibt-es-nicht");
    has("fehlendes Argument: nennt das Argument", wordStudyNoArg.error, "word");
  },
});

if (import.meta.main) {
  // Die Prompts werden gegen die Selbstauskunft geprüft, nicht gegen Literale.
  await fahre([serverInfoBuendel, promptsBuendel]);
  abschluss();
}
