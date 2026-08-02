/**
 * Registry der deutschen Bibelübersetzungen, die dieser Server führt. Alle vier
 * sind frei lizenziert und über die bolls.life-API unter denselben Kürzeln
 * abrufbar, die hier stehen.
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
 */
export const TRANSLATIONS = {
  LUT: { name: "Luther 1912", license: "Public Domain", attribution: null },
  SCH: {
    name: "Schlachter 1951",
    license: "CC BY 4.0 (Genfer Bibelgesellschaft / ebible.org)",
    attribution:
      "Die Heilige Schrift, Schlachter 1951, © 1951 Genfer Bibelgesellschaft " +
      "(Geneva Bible Society), bereitgestellt unter CC BY 4.0, " +
      "https://ebible.org/deu1951/copyright.htm",
  },
  ELB: { name: "Elberfelder 1871", license: "Public Domain", attribution: null },
  MB: { name: "Menge 1939", license: "Public Domain", attribution: null },
} as const;

export type TranslationCode = keyof typeof TRANSLATIONS;

export const DEFAULT_TRANSLATION: TranslationCode = "LUT";

/** Kleingeschriebene Eingabe → kanonisches Kürzel (die Kürzel selbst gelten auch). */
const TRANSLATION_ALIASES: Record<string, TranslationCode> = {
  lut: "LUT", luther: "LUT", luther1912: "LUT",
  sch: "SCH", schlachter: "SCH", schlachter1951: "SCH",
  elb: "ELB", elberfelder: "ELB", elberfelder1871: "ELB",
  mb: "MB", menge: "MB", menge1939: "MB",
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
