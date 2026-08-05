/**
 * Registry der deutschen Bibelübersetzungen, die dieser Server führt.
 *
 * Das Feld `license` erscheint in THIRD_PARTY_LICENSES.md und im README;
 * Schlachter 1951 verlangt eine Nennung (CC BY 4.0, Genfer Bibelgesellschaft,
 * Lizenzangabe unter https://ebible.org/deu1951/copyright.htm).
 */

/**
 * `attribution` ist die Nennung, die die Lizenz beim Weitergeben verlangt, und
 * `null` dort, wo sie keine verlangt (Public Domain). Sie steht hier und nicht
 * nur in THIRD_PARTY_LICENSES.md, weil ein gehosteter Server die Texte
 * öffentlich verfügbar macht: CC BY zählt genau das als „Share", und wer den
 * Server nur über MCP benutzt, sieht keine Repository-Datei und keine Website.
 * Der Server hängt die Nennung deshalb an jede betroffene Antwort (Feld
 * `quellen`). Beim Ergänzen einer Übersetzung: `null` ist eine Aussage, kein
 * vergessener Wert.
 *
 * `quelle` sagt, woher der Text kommt, und das ist keine Beschreibung, sondern
 * eine Weiche: `scripts/download.ts` leitet seine Arbeitsliste aus dieser
 * Registry ab, und `scripts/setup.ts` führt diesen Schritt als `required`, bricht
 * also den ganzen Erstaufbau ab, wenn eine Übersetzung nicht lädt. Ein Eintrag
 * mit `quelle: "lokal"` liegt nicht bei bolls.life; stünde er ohne dieses Feld
 * hier, versuchte jeder `bun run setup` und jedes `bible_setup` einen Abruf, der
 * mit 404 endet, und die sieben folgenden Datensätze fielen mit aus.
 *
 * `verseMax` ist die Höchstzahl Verse, die eine Antwort aus dieser Ausgabe im
 * Wortlaut tragen darf, und `null` dort, wo es keine Grenze gibt. Sie steht hier
 * aus demselben Grund wie `license` und `attribution`: Es ist eine Bedingung,
 * die am Text hängt und nicht am Server, und ein globaler Schalter beschnitte
 * die gemeinfreien Ausgaben mit. Auch hier ist `null` eine Aussage und kein
 * vergessener Wert; `satisfies` unten erzwingt sie bei jedem neuen Eintrag.
 */

/**
 * Verse im Wortlaut je Abruf, für beide Schlachter-Ausgaben zugesagt. Eine
 * einzige Zahl, weil es im Code dieselbe Regel ist; die Rechtsgründe der beiden
 * Ausgaben unterscheiden sich, ihr Verhalten nicht. Wer die Grenze ändern oder
 * aufheben will, ändert diese Zeile und die Registry-Einträge darunter: Kein
 * Handler kennt den Wert, alle fragen `verseBudget()` in `verse-budget.ts`.
 */
const VERSE_MAX_GBG = 20;

export const TRANSLATIONS = {
  LUT: {
    name: "Luther 1912",
    license: "Public Domain",
    attribution: null,
    quelle: "bolls",
    verseMax: null,
  },
  SCH: {
    name: "Schlachter 1951",
    license: "CC BY 4.0 (Genfer Bibelgesellschaft / ebible.org)",
    attribution:
      "Die Heilige Schrift, Schlachter 1951, © 1951 Genfer Bibelgesellschaft " +
      "(Geneva Bible Society), bereitgestellt unter CC BY 4.0, " +
      "https://ebible.org/deu1951/copyright.htm",
    quelle: "bolls",
    verseMax: VERSE_MAX_GBG,
  },
  ELB: {
    name: "Elberfelder 1871",
    license: "Public Domain",
    attribution: null,
    quelle: "bolls",
    verseMax: null,
  },
  MB: {
    name: "Menge 1939",
    license: "Public Domain",
    attribution: null,
    quelle: "bolls",
    verseMax: null,
  },
  SLT: {
    name: "Schlachter 2000",
    license: "Abkommen mit der Genfer Bibelgesellschaft (nur der gehostete Dienst)",
    attribution: "© 2000 Genfer Bibelgesellschaft",
    quelle: "lokal",
    verseMax: VERSE_MAX_GBG,
  },
} as const satisfies Record<string, TranslationMeta>;

/**
 * Der Bauplan eines Registry-Eintrags. Er steht hier, damit `satisfies` oben
 * jeden neuen Eintrag auf Vollständigkeit prüft: `attribution` und `quelle`
 * lassen sich sonst vergessen, und beide fallen erst im Betrieb auf.
 */
interface TranslationMeta {
  readonly name: string;
  readonly license: string;
  readonly attribution: string | null;
  readonly quelle: "bolls" | "lokal";
  readonly verseMax: number | null;
}

export type TranslationCode = keyof typeof TRANSLATIONS;

export const DEFAULT_TRANSLATION: TranslationCode = "LUT";

/** Kleingeschriebene Eingabe → kanonisches Kürzel (die Kürzel selbst gelten auch). */
const TRANSLATION_ALIASES: Record<string, TranslationCode> = {
  lut: "LUT", luther: "LUT", luther1912: "LUT",
  sch: "SCH", schlachter: "SCH", schlachter1951: "SCH",
  elb: "ELB", elberfelder: "ELB", elberfelder1871: "ELB",
  mb: "MB", menge: "MB", menge1939: "MB",
  // „schlachter" allein bleibt bei der 1951er: Das Kürzel SCH und dieser Alias
  // sind seit 0.1 veröffentlicht, und eine stillschweigende Umleitung auf eine
  // andere Ausgabe wäre eine Breaking Change im Gewand einer Ergänzung.
  slt: "SLT", sch2000: "SLT", schlachter2000: "SLT",
};

/**
 * Löst ein Werkzeugargument zu einem Übersetzungskürzel auf. Fehlende oder
 * leere Eingabe fällt auf die Voreinstellung zurück; unbekannte Eingabe liefert
 * null, die Meldung gibt der Aufrufer aus.
 */
export function resolveTranslation(input: unknown): TranslationCode | null {
  if (input === undefined || input === null || input === "") return DEFAULT_TRANSLATION;
  if (typeof input !== "string") return null;
  return TRANSLATION_ALIASES[input.trim().toLowerCase()] ?? null;
}
