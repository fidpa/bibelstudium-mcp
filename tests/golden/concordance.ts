/**
 * `bible_concordance`: alle Stellen zu einer Strong-Nummer oder einem Lemma.
 *
 * Zwei Zusicherungen, und beide betreffen eine Grenze: `lemma` hat eine eigene
 * Längengrenze, weil es ein eigenes Feld ist, und eine vollständig gelistete
 * Ausgabe darf keinen Kürzungshinweis tragen.
 *
 * Einzeln lauffähig: `bun run tests/golden/concordance.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, abschluss } from "../lib/zusicherungen.ts";

export const concordanceBuendel = buendel({
  name: "concordance",
  calls: {
    concordanceLongLemma: ["bible_concordance", { lemma: "α".repeat(60) }],
    // Alles aufgelistet: kein Kürzungshinweis.
    concordVollstaendig: ["bible_concordance", { strong: "G26", limit: 200 }],
  },
  pruefe({ res }) {
    const { concordanceLongLemma, concordVollstaendig } = res;
    eq(
      "bible_concordance: langes lemma hat eigene Grenze",
      concordanceLongLemma.text,
      "Error: 'lemma' must be at most 50 characters"
    );
    check("G26 vollständig gelistet: ohne hinweis", !("hinweis" in (concordVollstaendig.json ?? {})));
  },
});

if (import.meta.main) {
  await fahre([concordanceBuendel]);
  abschluss();
}
