/**
 * Die Ressourcen unter `bible://`: vier statische und drei URI-Vorlagen.
 *
 * Zwei Dinge stehen auf dem Spiel. Der Katalog, denn die Vorlagen tragen den
 * parametrisierten Raum, damit die Liste kein Verzeichnis von 31 102 Versen
 * wird. Und die Meldungen: Eine Ressource ist derselbe Ausgabepfad wie das
 * Werkzeug, also muss sie zeichengleich melden, sonst laufen zwei
 * Formulierungen derselben Grenze auseinander.
 *
 * Einzeln lauffähig: `bun run tests/golden/ressourcen.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, abschluss, type Json } from "../lib/zusicherungen.ts";
import { KAPITEL_AUSSERHALB, VERSLISTE_ZU_LANG } from "../lib/meldungen.ts";
import { serverInfoBuendel } from "./server-info.ts";
import { lookupBuendel } from "./lookup.ts";

const INVALID_PARAMS = -32602;
const VERSES_TOO_MANY = Array.from({ length: 35 }, (_, i) => String(i + 1)).join(",");

export const ressourcenBuendel = buendel({
  name: "ressourcen",
  calls: {},
  resources: {
    resBuecher: "bible://buecher",
    resUebersetzungen: "bible://uebersetzungen",
    resEditionen: "bible://editionen",
    resQuellen: "bible://quellen",
    resKapitel: "bible://kapitel/LUT/Psalter/23",
    resVersBereich: "bible://vers/SCH/Johannes/3/16-17",
    resVersEinzeln: "bible://vers/LUT/Joh/3/16",
    resKapitelPunkt: "bible://kapitel/LUT/1.%20Mose/1",
    resKapitelUmlaut: "bible://kapitel/LUT/R%C3%B6mer/8",
    resGrundtextAt: "bible://grundtext/wlc/1%20Mose/1/1",
    resGrundtextNt: "bible://grundtext/byzantine/Johannes/3/16",
    // Negativfälle
    resFremdesSchema: "spike://etwas",
    resUnbekannt: "bible://unbekannt",
    resZuWenigSegmente: "bible://kapitel/LUT/Psalter",
    resBuchFehlt: "bible://kapitel/LUT/Hesekiel-Zusatz/1",
    resKapitelGrenze: "bible://kapitel/LUT/Psalter/999",
    resVerslisteZuLang: `bible://vers/LUT/Psalter/119/${VERSES_TOO_MANY}`,
    resUebersetzungUnbekannt: "bible://kapitel/XYZ/Psalter/23",
    resEditionFalschesTestament: "bible://grundtext/wlc/Johannes/3/16",
    // Zwei Bedingungen zugleich verletzt: Die Meldung muss die nennen, die auch
    // das Werkzeug nennt, sonst gilt „gleicher Wortlaut" nur für Einzelfehler.
    resZweiVerletzt: "bible://kapitel/LUT/Hesekiel-Zusatz/999",
  },
  pruefe({ ressourcen }, ctx) {
    const {
      resBuecher, resUebersetzungen, resEditionen, resQuellen, resKapitel,
      resVersBereich, resVersEinzeln, resKapitelPunkt, resKapitelUmlaut,
      resGrundtextAt, resGrundtextNt, resFremdesSchema, resUnbekannt,
      resZuWenigSegmente, resBuchFehlt, resKapitelGrenze, resVerslisteZuLang,
      resUebersetzungUnbekannt, resEditionFalschesTestament, resZweiVerletzt,
    } = ressourcen;

  const info = ctx.fremd("server-info.serverInfo").json ?? {};
  const codes = (info.uebersetzungen as Array<{ code: string }>).map((t) => t.code);
  const editions = (info.urtext_editionen as Array<{ code: string }>).map((e) => e.code);

  // Der Katalog ist der ganze Sinn des Entwurfs: Die Vorlagen tragen den
  // parametrisierten Raum, damit die Liste kein Katalog von 31 102 Versen wird.
  // Ändert sich eine der beiden Zahlen, ändern sich die Kosten jedes
  // Sitzungsbeginns.
  eq("vier statische Ressourcen gelistet", ctx.resourceList.length, 4);
  eq("drei Vorlagen gelistet", ctx.templateList.length, 3);
  for (const r of ctx.resourceList) {
    check(`${String(r.uri)}: Name gesetzt`, typeof r.name === "string" && r.name !== "");
    check(
      `${String(r.uri)}: Beschreibung gesetzt`,
      typeof r.description === "string" && r.description !== ""
    );
    eq(`${String(r.uri)}: mimeType`, r.mimeType, "application/json");
    check(`${String(r.uri)}: URI im Schema`, String(r.uri).startsWith("bible://"));
  }
  for (const t of ctx.templateList) {
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
  ctx.resourceList.forEach((r, i) => {
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
    KAPITEL_AUSSERHALB
  );
  has(
    "Versliste zeichengleich mit dem Werkzeug",
    resVerslisteZuLang!.error,
    VERSLISTE_ZU_LANG
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
    ctx.fremd("lookup.lookupChap999").text
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
  const gemeldet = (ctx.fremd("server-info.serverInfo").json?.ressourcen ?? {}) as {
    statisch?: string[];
    vorlagen?: string[];
  };
  eq(
    "bible_server_info nennt dieselben Ressourcen wie resources/list",
    (gemeldet.statisch ?? []).join(","),
    ctx.resourceList.map((r) => String(r.uri)).join(",")
  );
  eq(
    "bible_server_info nennt dieselben Vorlagen wie resources/templates/list",
    (gemeldet.vorlagen ?? []).join(","),
    ctx.templateList.map((t) => String(t.uriTemplate)).join(",")
  );


    // Eine Ressource hat wie ein Prompt keinen `isError`-Kanal.
    for (const [label, r] of [
      ["fremdes Schema", resFremdesSchema],
      ["unbekannte Ressource", resUnbekannt],
      ["falsche URI-Form", resZuWenigSegmente],
      ["unbekanntes Buch", resBuchFehlt],
      ["Kapitel außerhalb", resKapitelGrenze],
      ["unbekannte Übersetzung", resUebersetzungUnbekannt],
    ] as const) {
      eq(`Ressource, ${label}: InvalidParams`, r.code, INVALID_PARAMS);
    }
  },
});

if (import.meta.main) {
  // Die Bestandsabgleiche lesen die Selbstauskunft, ein Negativfall die Antwort
  // des Werkzeugs, gegen die er zeichengleich sein muss.
  await fahre([serverInfoBuendel, lookupBuendel, ressourcenBuendel]);
  abschluss();
}
