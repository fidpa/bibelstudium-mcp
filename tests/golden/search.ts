/**
 * `bible_search`: Volltextsuche über die deutschen Ausgaben.
 *
 * Drei Dinge stehen hier auf dem Spiel. Dass `treffer` Verse zählt und
 * `vorkommen_gesamt` Vorkommen, denn ohne diese Trennung wird die eine Zahl aus
 * der anderen geschätzt. Dass eine ausgelassene Zählung dasteht, statt einfach
 * zu fehlen. Und dass der Klammerhinweis aus den ausgelieferten Versen entsteht
 * und nicht aus allen Treffern.
 *
 * Hier liegt außerdem der Selbsttest des Schemaprüfers: Er braucht eine echte
 * Antwort, an der er fünf Arten von Abweichung erkennen muss, und die stellt
 * dieses Bündel ohnehin.
 *
 * Einzeln lauffähig: `bun run tests/golden/search.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, hint, lacks, abschluss, type Json } from "../lib/zusicherungen.ts";
import { BUCH_ZU_LANG } from "../lib/meldungen.ts";
import { isRecord, schemaErrors } from "../schema-validator.ts";

const OVERLONG_NAME = "J".repeat(60);

export const searchBuendel = buendel({
  name: "search",
  calls: {
    searchLieb: ["bible_search", { query: "lieb*", book: "1Joh" }],
    searchLongBook: ["bible_search", { query: "Gnade", book: OVERLONG_NAME }],
    // Oberhalb der Scan-Grenze entfallen die beiden gezählten Felder: das gehört gesagt
    searchOverLimit: ["bible_search", { query: "der", limit: 2 }],
    // Der Klammerhinweis der Suche, beide Richtungen. Er entsteht aus den
    // Versen, die die Antwort ausliefert, nicht aus allen Treffern: Wo die
    // Wortlaut-Grenze greift, tragen die übrigen Zeilen ihren Text weiterhin, und
    // ein Hinweis daraus warnte vor Klammern in Versen, die niemand zu sehen
    // bekommt. Die 2000er ist die einzige geführte Ausgabe mit beidem, Klammern
    // und Grenze (1925 Verse mit Klammerwort gegen 137 in der Menge-Bibel, die
    // keine Grenze hat); der Fall ist deshalb nur mit ihr zu stellen. Bei "Bund"
    // trägt keiner der ersten zwanzig Treffer Klammern, ein späterer schon.
    klammerSucheGrenze: ["bible_search", { query: "Bund", translation: "SLT", limit: 50 }],
    klammerSucheMb: ["bible_search", { query: "Bethlehem", book: "1. Mose", translation: "MB", limit: 30 }],
  },
  pruefe({ res }, ctx) {
    const { searchLieb, searchLongBook, searchOverLimit, klammerSucheGrenze, klammerSucheMb } = res;

    eq("lieb* in 1Joh: Verse", searchLieb.json?.treffer, 30);
    eq("lieb* in 1Joh: Vorkommen", searchLieb.json?.vorkommen_gesamt, 48);
    has("lieb* in 1Joh: Trennung benannt", String(searchLieb.json?.hinweis ?? ""), "zählt Verse");

    // Die drei Zahlen oben stammen sämtlich aus den Zähl- und Scan-Abfragen. Die
    // ausgelieferte Trefferliste kommt aus einer anderen Abfrage und war bis zum
    // 05.08.2026 von keiner Zusicherung gedeckt: Eine Verfälschung ihres
    // Buchfilters oder ihrer Hervorhebung blieb grün. Geprüft werden deshalb
    // beide Wege, mit Buchfilter (`searchLieb`) und ohne (`searchOverLimit`).
    {
      const liste = (searchLieb.json?.verse ?? []) as Array<Json>;
      eq("lieb* in 1Joh: gelistet bis zur Grenze", liste.length, 10);
      check("lieb* in 1Joh: jeder gelistete Vers steht im gesuchten Buch",
        liste.length > 0 && liste.every((v) => String(v.stelle).startsWith("1 Johannes ")));
      check("lieb* in 1Joh: jeder gelistete Vers trägt den Treffermarker",
        liste.length > 0 && liste.every((v) => String(v.text).includes("⟦")));
      const ohneBuch = (searchOverLimit.json?.verse ?? []) as Array<Json>;
      check("Suche ohne Buchfilter: jeder gelistete Vers trägt den Treffermarker",
        ohneBuch.length > 0 && ohneBuch.every((v) => String(v.text).includes("⟦")));
    }
    // Nannte früher die falsche Bedingung: sagte, es müsse ein deutscher
    // Buchname sein, obwohl es einer war, nur zu lang (26.07.2026).
    eq("bible_search: langer Buchname", searchLongBook.text, BUCH_ZU_LANG);

    {
      const j = searchOverLimit.json;
      check("über 1000 Treffer", ((j?.treffer as number) ?? 0) > 1000);
      check("vorkommen_gesamt entfällt", !("vorkommen_gesamt" in (j ?? {})));
      check("verteilung entfällt", !("verteilung" in (j ?? {})));
      // Was fehlt, wird geschätzt und liest sich trotzdem wie gezählt; deshalb muss
      // die Auslassung dastehen, samt ihrem Grund und dem Ausweg.
      has("Auslassung benannt", hint(j), "Ab 1000 Treffern werden die Vorkommen nicht ausgezählt");
      has("Grund benannt", hint(j), "weil nicht gezählt wurde");
      has("Ausweg benannt", hint(j), "auf ein Buch ein");
      // Der gezählte Fall muss frei von dem Hinweis bleiben.
      lacks("kleine Suche ohne den Hinweis", hint(searchLieb.json), "Ab 1000 Treffern");
    }

    // Dieselbe Frage wie beim Nachschlagen, hier für die Suche. Die zweite ist
    // die eigentliche: Ein Hinweis, der aus allen Treffern statt aus den
    // ausgelieferten Versen entsteht, sieht in der positiven Probe genauso
    // richtig aus.
    has("Suche (MB): Klammerhinweis am gelisteten Vers", hint(klammerSucheMb.json), "Wörter in eckigen Klammern");
    lacks("Suche über der Grenze: kein Klammerhinweis aus ungelisteten Versen",
      hint(klammerSucheGrenze.json), "Wörter in eckigen Klammern");

    // Der Prüfer wird geprüft, bevor ihm vertraut wird, und zwar gegen die echte
    // Antwort eines echten Aufrufs statt gegen eine Attrappe. Fünf Arten, wie ein
    // Handler von seinem Schema abweichen könnte; jede einzelne muss auffallen.
    {
      const eintrag = ctx.tools.find((t) => t.name === "bible_search");
      const schema = isRecord(eintrag?.outputSchema) ? eintrag.outputSchema : undefined;
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
      check("Validator: gültige Antwort besteht", schema !== undefined && schemaErrors(schema, searchLieb.json).length === 0);
      for (const [name, kaputtmachen] of proben) {
        const kaputt = JSON.parse(JSON.stringify(searchLieb.json)) as Json;
        kaputtmachen(kaputt);
        check(
          `Validator erkennt: ${name}`,
          schema !== undefined && schemaErrors(schema, kaputt).length > 0
        );
      }
    }
  },
});

if (import.meta.main) {
  await fahre([searchBuendel]);
  abschluss();
}
