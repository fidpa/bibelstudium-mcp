/**
 * Die vier geführten Grundtext-Editionen: wie sie heißen, was beim Zitieren zu
 * beachten ist, unter welcher Lizenz sie stehen, und wie eine Eingabe auf eine
 * von ihnen auflöst.
 *
 * Eine reine Datentabelle: kein Zugriff auf die Datenbank, kein Protokollbezug,
 * gelesen wird allein die Übersetzungs-Registry. Deshalb steht das hier und
 * nicht im Server, obwohl es breiter benutzt wird als alles andere, was auf
 * dieser Seite liegt.
 *
 * Die Lizenzangabe liegt bei den Daten, die sie betrifft: `quelle` steht neben
 * `label` in derselben Eintragung. Getrennt gepflegt liefen Text und Lizenz
 * auseinander. Und genannt wird nur, was eine Antwort tatsächlich benutzt hat,
 * denn eine behauptete Nennung, die nicht einschlägig ist, ist derselbe Fehler
 * wie eine weggelassene; dafür gibt es `quellen()` statt eines festen Blocks
 * über allen Werkzeugen.
 *
 * Was hier nicht steht: welche Editionen tatsächlich geladen sind. Das ist eine
 * Frage an die Datenbank und wird dort beantwortet. Diese Datei beschreibt die
 * geführten Editionen, nicht den vorhandenen Bestand.
 */
import { TRANSLATIONS, type TranslationCode } from "./translations.ts";

/**
 * Eine Quellenangabe, wie sie im Feld `quellen` einer Antwort erscheint.
 *
 * `nennung` trägt nur, was die Lizenz beim Weitergeben verlangt, und ist sonst
 * `null`. Public-Domain-Quellen brauchen keine, CC-BY-Quellen schon: Ein
 * gehosteter Endpunkt macht die Daten öffentlich verfügbar, und das ist nach
 * CC 4.0 ein „Share". Wer nur über MCP zugreift, sieht weder das Repository
 * noch die Website, also muss die Nennung an der Antwort hängen. Vorbild ist
 * orthotomeo, das dasselbe tut.
 */
interface Quelle {
  readonly werk: string;
  readonly lizenz: string;
  readonly nennung: string | null;
}

export const EDITION_META: Record<
  string,
  {
    label: string;
    hinweis: string;
    sprache: string;
    decoder: "robinson" | "morphgnt" | "hebrew";
    // Neben `label`, damit Text und Lizenz einer Edition nicht getrennt
    // gepflegt werden und auseinanderlaufen können.
    quelle: Quelle;
  }
> = {
  byzantine: {
    label: "Byzantinischer Mehrheitstext (Robinson-Pierpont 2005)",
    sprache: "Griechisch (Koine)",
    decoder: "robinson",
    quelle: {
      werk: "Byzantinischer Mehrheitstext (Robinson-Pierpont 2005), Text und Robinson-Parsing",
      lizenz: "Public Domain",
      nennung: null,
    },
    hinweis:
      "Mehrheitstext (Textus-Receptus-Familie, aber breiter bezeugt); enthält z. B. " +
      "kein Comma Johanneum (1Joh 5,7). Von der Mehrheitstext-Position (u. a. R. Liebi) " +
      "als zuverlässiger Grundtext vertreten. " +
      "Das Feld 'wort' ist unakzentuiert gespeichert (so liegt die Quelle vor): " +
      "beim Zitieren nicht um Akzente oder Interpunktion ergänzen; akzentuiert steht " +
      "der Text nur im SBLGNT (texttyp 'sblgnt').",
  },
  sblgnt: {
    label: "SBL Greek New Testament (kritische Edition)",
    sprache: "Griechisch (Koine)",
    decoder: "morphgnt",
    quelle: {
      werk: "SBL Greek New Testament (Text) mit MorphGNT-Morphologie",
      lizenz: "Text: CC BY 4.0; Morphologie: CC BY-SA 3.0",
      nennung:
        "SBL Greek New Testament, © Society of Biblical Literature und Logos Bible " +
        "Software, CC BY 4.0, https://sblgnt.com/license/. Morphologie: MorphGNT, " +
        "CC BY-SA 3.0, https://github.com/morphgnt/sblgnt. Die Morphologiecodes " +
        "werden hier aufgeloest, also bearbeitet: Wer diese Ausgabe " +
        "weiterveroeffentlicht, gibt sie unter CC BY-SA weiter.",
    },
    hinweis:
      "Kritische (eklektische) Edition, Nestle-Aland-nah, nicht Mehrheitstext. " +
      "Bei Lesarten-Fragen den Texttyp beachten; die Morphologie ist davon unberührt.",
  },
  tr: {
    label: "Textus Receptus (Robinson, Scrivener/Stephens-Tradition)",
    sprache: "Griechisch (Koine)",
    decoder: "robinson",
    quelle: {
      werk: "Textus Receptus (Scrivener-/Stephanus-Tradition), Text und Robinson-Parsing",
      lizenz: "Public Domain",
      nennung: null,
    },
    hinweis:
      "Textus Receptus, die einzige der drei Editionen mit dem Comma Johanneum " +
      "(1Joh 5,7 Langform) und weiteren TR-Sonderlesarten. Zum direkten Lesarten-" +
      "vergleich; die Mehrheitstext-Position sieht den TR als enge Reformationsform " +
      "des Mehrheitstextes, nicht als Grundtext. " +
      "Das Feld 'wort' ist unakzentuiert gespeichert (so liegt die Quelle vor): " +
      "beim Zitieren nicht um Akzente oder Interpunktion ergänzen.",
  },
  wlc: {
    label: "Westminster Leningrad Codex (masoretisch, OSHB-Morphologie)",
    sprache: "Hebräisch/Aramäisch",
    decoder: "hebrew",
    quelle: {
      werk: "Westminster Leningrad Codex mit OSHB-Morphologie",
      lizenz: "Text: Public Domain; Morphologie und Lemmata: CC BY 4.0",
      nennung:
        "Morphologie und Lemmata: Open Scriptures Hebrew Bible Project, CC BY 4.0, " +
        "https://github.com/openscriptures/morphhb",
    },
    hinweis:
      "Masoretischer Text (Ben Ascher, Leningrad-Codex). Geschriebener Text = Ketiv " +
      "(die Qere-Lesart der Randmasora ist nicht enthalten). Für das AT die von der " +
      "masoretischen Position (u. a. R. Liebi) getragene Textbasis. " +
      "Das Feld 'wort' enthält Vokal- und Akzentzeichen (Teamim) sowie den " +
      "OSHB-Morphemtrenner '/' zwischen Präfix und Wort (z. B. 'בְּ/רֵאשִׁ֖ית'): beim " +
      "Zitieren weder Zeichen entfernen noch ergänzen.",
  },
};

/**
 * Quellen, die keine Edition sind: Querverweise, Bezeugung, Lexika.
 *
 * Konkrete Schlüssel statt `Record<string, Quelle>`, und Zugriff per Punkt statt
 * per Klammer: Unter `noUncheckedIndexedAccess` liefert ein verschriebener
 * Klammerzugriff `Quelle | undefined`, und genau dieser Typ ist in `quellen()`
 * der legitime Kanal für „bedingt unbenutzt". Ein Tippfehler würde also
 * kompilieren, alle Tests grün lassen und eine lizenzpflichtige Nennung
 * stillschweigend weglassen: genau der Fehler, den dieses Feld verhindern soll.
 * So ist ein falscher Name ein Typfehler.
 */
export const DATASET_QUELLEN = {
  crossrefs: {
    werk: "Querverweise: Treasury of Scripture Knowledge (erweitert, mit Community-Stimmen)",
    lizenz: "CC BY 4.0",
    nennung: "OpenBible.info, CC BY 4.0, https://www.openbible.info/labs/cross-references/",
  },
  tagnt: {
    werk: "Bezeugung über acht griechische Editionen (STEPBible TAGNT)",
    lizenz: "CC BY 4.0",
    nennung:
      "STEPBible-Data (TAGNT), © Tyndale House, Cambridge, CC BY 4.0, " +
      "https://github.com/STEPBible/STEPBible-Data",
  },
  lexikon_strongs: {
    werk: "Strong-Wörterbücher 1890 (Grundformen, Umschriften, Definitionen)",
    lizenz: "CC BY-SA (Version von der Quelle nicht angegeben)",
    nennung:
      "Open Scriptures, https://github.com/openscriptures/strongs. Das Werk von " +
      "James Strong (1890) ist gemeinfrei; die Share-Alike-Pflicht betrifft die " +
      "digitale Aufbereitung von 2009, die hier in ein eigenes Schema überführt ist.",
  },
  lexikon_step: {
    werk: "Tyndale-Glossen und Abbott-Smith-Lexikon (STEPBible TBESG/TBESH)",
    lizenz: "CC BY 4.0",
    nennung:
      "STEPBible-Data (TBESG/TBESH), © Tyndale House, Cambridge, CC BY 4.0, " +
      "https://github.com/STEPBible/STEPBible-Data",
  },
} as const satisfies Record<string, Quelle>;

/**
 * Baut das Feld `quellen` aus genau den Quellen, die die Antwort benutzt hat.
 *
 * Bewusst kein konstanter Block über allen Werkzeugen: Eine Antwort aus
 * `bible_lookup` mit Luther 1912 berührt keine CC-BY-Quelle, und eine
 * Attribution zu behaupten, die gar nicht einschlägig ist, ist derselbe Fehler
 * wie eine weggelassene. `null`-Einträge fallen weg, damit die Liste kurz
 * bleibt.
 */
export function quellen(...verwendet: ReadonlyArray<Quelle | undefined>): Quelle[] {
  const seen = new Set<string>();
  const out: Quelle[] = [];
  for (const q of verwendet) {
    if (q === undefined || seen.has(q.werk)) continue;
    seen.add(q.werk);
    out.push(q);
  }
  return out;
}

/** Quellenangabe einer Übersetzung, aus der Registry in translations.ts. */
export function translationQuelle(code: TranslationCode): Quelle {
  const meta = TRANSLATIONS[code];
  return { werk: meta.name, lizenz: meta.license, nennung: meta.attribution };
}

const EDITION_ALIASES: Record<string, string> = {
  byzantine: "byzantine", byz: "byzantine", mehrheitstext: "byzantine",
  mehrheit: "byzantine", majority: "byzantine", mt: "byzantine",
  sblgnt: "sblgnt", sbl: "sblgnt", kritisch: "sblgnt", "nestle-aland": "sblgnt", na: "sblgnt",
  tr: "tr", textusreceptus: "tr", "textus-receptus": "tr", receptus: "tr", scrivener: "tr",
  wlc: "wlc", masoretisch: "wlc", hebräisch: "wlc", hebraeisch: "wlc", hebrew: "wlc", masoretic: "wlc",
};

// Welche Editionen für welches Testament gelten (book_id 1 bis 39 = AT, 40 bis 66 = NT).
const OT_EDITIONS = new Set(["wlc"]);
export const NT_EDITIONS = new Set(["byzantine", "sblgnt", "tr"]);

// Die NT-Editionen in der Reihenfolge des Vergleichs, und die einzige Stelle,
// die sie aufzählt: `bible_compare` gibt sie in dieser Folge aus, und der Prompt
// `variant-check` nennt die davon geladenen. NT_EDITIONS oben ist die
// Zugehörigkeitsprüfung, dies hier die Reihenfolge; eine zweite wörtliche Liste
// liefe davon weg.
export const NT_EDITION_ORDER = ["byzantine", "tr", "sblgnt"] as const;

/** Fehlende oder leere Eingabe löst auf byzantine auf, ein unbekannter Alias auf null. */
export function resolveEdition(input: unknown): string | null {
  if (input === undefined || input === null || input === "") return EDITION_ALIASES["byzantine"]!;
  if (typeof input !== "string") return null;
  return EDITION_ALIASES[input.trim().toLowerCase()] ?? null;
}
