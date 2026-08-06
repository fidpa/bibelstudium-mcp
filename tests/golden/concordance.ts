/**
 * `bible_concordance`: alle Stellen zu einer Strong-Nummer oder einem Lemma.
 *
 * Zwei Themen: die Grenzen und die Abweisungen. `lemma` hat eine eigene
 * Längengrenze, weil es ein eigenes Feld ist; eine vollständig gelistete Ausgabe
 * darf keinen Kürzungshinweis tragen, eine gekürzte muss einen tragen. Seit
 * 0.6.13 trägt `hinweis` zwei Sätze, die einander nicht ausschließen: die
 * Kürzung und die Herkunft von `kjv_woerter`. Geprüft wird deshalb der
 * Kürzungssatz für sich, nicht das ganze Feld. Die fünf
 * Abweisungen stehen dabei, weil sie je einen eigenen Ausweg nennen: Bis zum
 * 06.08.2026 hatte dieses Werkzeug zwölf Verzweigungen und zwei Zusicherungen,
 * und keine davon berührte eine Fehlermeldung.
 *
 * Einzeln lauffähig: `bun run tests/golden/concordance.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, lacks, abschluss } from "../lib/zusicherungen.ts";

export const concordanceBuendel = buendel({
  name: "concordance",
  calls: {
    concordanceLongLemma: ["bible_concordance", { lemma: "α".repeat(60) }],
    // Alles aufgelistet: kein Kürzungshinweis.
    concordVollstaendig: ["bible_concordance", { strong: "G26", limit: 200 }],
    // Das Gegenstück dazu, und der wichtigere Fall: Wo gekürzt wird, MUSS es
    // dastehen. Die Abwesenheit des Hinweises allein zu prüfen, deckt gerade den
    // Hausfehler nicht ab, gegen den sie gerichtet ist: Eine Bedingung, die nie
    // zutrifft, kürzt still und bleibt dabei grün.
    concordGekuerzt: ["bible_concordance", { strong: "G26", limit: 5 }],
    concordFormat: ["bible_concordance", { strong: "26" }],
    concordOhneAngabe: ["bible_concordance", {}],
    concordLemmaLatein: ["bible_concordance", { lemma: "Liebe" }],
    concordTexttyp: ["bible_concordance", { strong: "G26", texttyp: "quatsch" }],
    concordOhneTreffer: ["bible_concordance", { strong: "G99999" }],
    // `sblgnt` führt in 0 von 137 554 Wörtern eine Strong-Nummer, eine Suche
    // danach kann dort also nie etwas finden. Bis zum 06.08.2026 kam dieselbe
    // Meldung wie bei einer ergebnislosen Suche, und die riet, „im Zweifel
    // Strong-Nummer verwenden", also zu genau dem, was gerade gescheitert war.
    // Die Lemma-Suche funktioniert dort und muss unberührt bleiben.
    concordStrongOhneDaten: ["bible_concordance", { strong: "G26", texttyp: "sblgnt" }],
    concordLemmaSblgnt: ["bible_concordance", { lemma: "ἀγάπη", texttyp: "sblgnt", limit: 2 }],
    concordStrongMitDaten: ["bible_concordance", { strong: "G26", texttyp: "tr", limit: 2 }],
  },
  pruefe({ res }) {
    const { concordanceLongLemma, concordVollstaendig, concordGekuerzt } = res;
    const { concordFormat, concordOhneAngabe, concordLemmaLatein } = res;
    const { concordTexttyp, concordOhneTreffer } = res;
    const { concordStrongOhneDaten, concordLemmaSblgnt, concordStrongMitDaten } = res;

    // Die verletzte Bedingung wird benannt, und der Ausweg ist einer, den der
    // Aufrufer gehen kann.
    eq("Strong gegen sblgnt: isError", concordStrongOhneDaten.isError, true);
    has("Strong gegen sblgnt: nennt die Bedingung",
      concordStrongOhneDaten.text, 'Die Edition "sblgnt" führt keine Strong-Nummern');
    has("Strong gegen sblgnt: nennt Editionen mit Strong-Nummern",
      concordStrongOhneDaten.text, "byzantine");
    has("Strong gegen sblgnt: nennt den gangbaren Weg",
      concordStrongOhneDaten.text, "'lemma'");
    // Der alte Rat darf gerade hier nicht mehr stehen, er führte im Kreis.
    check("Strong gegen sblgnt: rät nicht zur Strong-Nummer",
      !concordStrongOhneDaten.text.includes("im Zweifel Strong-Nummer verwenden"));
    // Zwei Gegenproben, damit die neue Sperre nicht zu weit greift.
    eq("Lemma gegen sblgnt: unberührt", concordLemmaSblgnt.isError, false);
    eq("Strong gegen tr: unberührt", concordStrongMitDaten.isError, false);
    eq(
      "bible_concordance: langes lemma hat eigene Grenze",
      concordanceLongLemma.text,
      "Error: 'lemma' must be at most 50 characters"
    );
    // Nicht mehr „kein hinweis": Das Feld trägt jetzt auch den Satz zum englischen
    // Lexikon. Gemeint war immer die Kürzung, und genau die darf hier fehlen.
    lacks(
      "G26 vollständig gelistet: kein Kürzungshinweis",
      String(concordVollstaendig.json?.hinweis ?? ""),
      "Nur die ersten"
    );
    // Die Wiedergabe der King James ist keine Bedeutungsangabe, und das Feld sagt
    // es nicht von selbst: „charity" für ἀγάπη färbt das Wort im Deutschen falsch.
    check(
      "G26: kjv_woerter vorhanden",
      typeof concordVollstaendig.json?.kjv_woerter === "string"
    );
    has(
      "G26: kjv_woerter wird als KJV-Wiedergabe gekennzeichnet",
      String(concordVollstaendig.json?.hinweis ?? ""),
      "King James Version"
    );

    // Gekürzt wird gemeldet, und zwar mit beiden Zahlen. Zeichengleich, weil der
    // gesamte Informationsgehalt des Satzes in ihnen liegt: „die ersten 5 von
    // 116" hält sowohl die Klemmung als auch die Gesamtzahl fest, und eine
    // vertauschte Zahl läse sich unverdächtig.
    check(
      "G26 mit limit=5: Kürzung wird gemeldet",
      String(concordGekuerzt.json?.hinweis ?? "").startsWith(
        "Nur die ersten 5 von 116 Vorkommen gelistet; 'buecher' zeigt die vollständige Verteilung."
      ),
      `war "${String(concordGekuerzt.json?.hinweis ?? "")}"`
    );
    check(
      "G26 mit limit=5: genau fünf Vorkommen",
      Array.isArray(concordGekuerzt.json?.vorkommen) && concordGekuerzt.json.vorkommen.length === 5
    );
    // Die Verteilung bleibt vollständig, auch wenn die Liste es nicht ist: Sie
    // ist der Ausweg, auf den der Hinweis verweist.
    check(
      "G26 mit limit=5: 'buecher' bleibt vollständig",
      Array.isArray(concordGekuerzt.json?.buecher) && concordGekuerzt.json.buecher.length > 5
    );
    // Die Lizenznennung folgt den tatsächlich benutzten Feldern. Eine behauptete
    // Attribution ist derselbe Fehler wie eine weggelassene, und beide Lexika
    // stehen unter Bedingungen, die eine Nennung verlangen.
    const werke = ((concordGekuerzt.json?.quellen ?? []) as Array<{ werk: string }>).map((q) => q.werk);
    check("G26: Strong-Wörterbuch genannt", werke.some((w) => w.includes("Strong-Wörterbücher")));
    check("G26: STEPBible-Glossen genannt", werke.some((w) => w.includes("STEPBible TBESG/TBESH")));

    // Die fünf Abweisungen. Zeichengleich, weil jede von ihnen einen anderen
    // Ausweg nennt und die Meldung genau deshalb dasteht.
    eq(
      "bible_concordance: Strong ohne Präfix",
      concordFormat.text,
      'Error: \'strong\' muss eine Strong-Nummer mit Präfix sein, z. B. "G26" (NT) oder "H7225" (AT).'
    );
    eq(
      "bible_concordance: weder strong noch lemma",
      concordOhneAngabe.text,
      'Error: entweder \'strong\' (z. B. "G26") oder \'lemma\' angeben.'
    );
    has(
      "bible_concordance: lateinisch geschriebenes lemma",
      concordLemmaLatein.text,
      "'lemma' muss griechisch oder hebräisch geschrieben sein"
    );
    has(
      "bible_concordance: ungültiger texttyp",
      concordTexttyp.text,
      'Unbekannter oder fürs NT ungültiger texttyp "quatsch"'
    );
    // Kein Treffer ist ein Ergebnis und keine Panne: Die Meldung sagt, was zu
    // tun ist, statt nur „nichts gefunden".
    eq("bible_concordance: keine Vorkommen ist isError", concordOhneTreffer.isError, true);
    has(
      "bible_concordance: keine Vorkommen nennt Edition und Ausweg",
      concordOhneTreffer.text,
      'Keine Vorkommen für "G99999" in Edition "byzantine" gefunden.'
    );
  },
});

if (import.meta.main) {
  await fahre([concordanceBuendel]);
  abschluss();
}
