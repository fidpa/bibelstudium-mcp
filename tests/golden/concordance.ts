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
    // Die hebräische Hälfte des Werkzeugs. Sie fährt einen eigenen Zweig: Edition
    // 'wlc' statt einer NT-Edition, Strong-Präfix 'H', und den vollständigen
    // Abbott-Smith-Artikel gibt es nur fürs Griechische. Bis zum 07.08.2026 fuhr
    // kein Golden-Fall eine hebräische Nummer, geprüft war allein die griechische
    // Seite; ein Einbau, der die Edition dieses Zweigs auf 'byzantine' umstellte,
    // blieb grün (gemessen 07.08.2026).
    concordHebraeisch: ["bible_concordance", { strong: "H7225", limit: 3 }],
    // Eine NT-Edition zu einer hebräischen Nummer ist kein Fehler, sondern
    // gegenstandslos: Gesucht wird im WLC, und seit dem 07.08.2026 sagt die
    // Antwort das. Bis dahin wurde die Angabe stillschweigend übergangen,
    // während `bible_original` im gleichgelagerten Fall seit je darauf hinweist.
    concordHebTexttyp: ["bible_concordance", { strong: "H7225", texttyp: "sblgnt", limit: 2 }],
    // Die Gegenprobe: Wer den zutreffenden Texttyp schickt, hat nichts
    // übergangen bekommen und darf den Satz nicht lesen.
    concordHebTexttypWlc: ["bible_concordance", { strong: "H7225", texttyp: "wlc", limit: 2 }],
  },
  pruefe({ res }) {
    const { concordanceLongLemma, concordVollstaendig, concordGekuerzt } = res;
    const { concordFormat, concordOhneAngabe, concordLemmaLatein } = res;
    const { concordTexttyp, concordOhneTreffer } = res;
    const { concordStrongOhneDaten, concordLemmaSblgnt, concordStrongMitDaten } = res;
    const { concordHebraeisch, concordHebTexttyp, concordHebTexttypWlc } = res;

    // Der übergangene Texttyp, beide Richtungen. Die zweite ist die eigentliche:
    // Ein Satz, der immer erschiene, sagte über den einzelnen Abruf nichts.
    eq("H7225 mit NT-Texttyp: kein Fehler", concordHebTexttyp.isError, false);
    eq("H7225 mit NT-Texttyp: durchsucht wird dennoch der WLC",
      concordHebTexttyp.json?.texttyp, "wlc");
    has("H7225 mit NT-Texttyp: der Hinweis benennt die übergangene Angabe",
      String(concordHebTexttyp.json?.hinweis ?? ""),
      'Der Texttyp "sblgnt" gilt nur fürs NT; fürs AT wird der hebräische WLC durchsucht.');
    lacks("H7225 mit texttyp=wlc: kein Satz über eine übergangene Angabe",
      String(concordHebTexttypWlc.json?.hinweis ?? ""), "gilt nur fürs NT");
    lacks("H7225 ohne texttyp: kein Satz über eine übergangene Angabe",
      String(concordHebraeisch.json?.hinweis ?? ""), "gilt nur fürs NT");
    // Die Suche selbst bleibt von der übergangenen Angabe unberührt.
    eq("H7225 mit NT-Texttyp: dieselbe Gesamtzahl wie ohne",
      concordHebTexttyp.json?.gesamt, concordHebraeisch.json?.gesamt);

    // Der hebräische Zweig, an den Stellen, an denen er sich vom griechischen
    // unterscheidet. Die Umschrift wird auf beiden Seiten geprüft: Sie ist ein
    // bedingtes Feld, das nur aus dem Lexikoneintrag entsteht, und ihr Wegfall
    // blieb bis zum 07.08.2026 auf beiden Seiten grün (gemessen).
    eq("H7225: kein Fehler", concordHebraeisch.isError, false);
    eq("H7225: Edition ist der WLC, nicht eine NT-Edition", concordHebraeisch.json?.texttyp, "wlc");
    eq("H7225: Strong-Nummer mit hebräischem Präfix", concordHebraeisch.json?.strong, "H7225");
    eq("H7225: Umschrift", concordHebraeisch.json?.umschrift, "rêʼshîyth");
    eq("G26: Umschrift", concordVollstaendig.json?.umschrift, "agápē");
    // Der Abbott-Smith-Artikel ist griechisch und hat kein hebräisches
    // Gegenstück: Stünde er hier, käme er aus dem falschen Lexikon.
    check("H7225: kein griechischer Lexikonartikel", !("lexikon" in (concordHebraeisch.json ?? {})));
    check("G26: griechischer Lexikonartikel vorhanden", "lexikon" in (concordVollstaendig.json ?? {}));
    // Die Vorkommen liegen im Alten Testament. Ohne diese Prüfung bliebe offen,
    // ob die Edition bloß richtig heißt oder auch durchsucht wurde.
    const hebBuecher = (concordHebraeisch.json?.buecher ?? []) as Array<{ buch: string; anzahl: number }>;
    check("H7225: Verteilung besetzt", hebBuecher.length > 0);
    eq("H7225: erstes Buch der Verteilung", hebBuecher[0]?.buch, "1 Mose");
    eq("H7225: Gesamtzahl der Vorkommen", concordHebraeisch.json?.gesamt, 51);
    const hebVor = (concordHebraeisch.json?.vorkommen ?? []) as Array<{ stelle: string }>;
    eq("H7225: gelistet bis zur Grenze", hebVor.length, 3);
    eq("H7225: erste Stelle", hebVor[0]?.stelle, "1 Mose 1,1");
    // Die Quellennennung folgt der benutzten Edition, nicht der griechischen.
    const hebWerke = ((concordHebraeisch.json?.quellen ?? []) as Array<{ werk: string }>).map((q) => q.werk);
    check("H7225: der WLC ist als Quelle genannt",
      hebWerke.some((w) => w.includes("Westminster Leningrad Codex")),
      hebWerke.join(" | "));

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
