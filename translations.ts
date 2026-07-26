/**
 * Registry of the German Bible translations this server supports. All four
 * are freely licensed and available via the bolls.life API under the same
 * codes used here.
 *
 * The license field is surfaced in THIRD_PARTY_LICENSES.md and the README;
 * Schlachter 1951 requires attribution (CC BY 4.0, Genfer Bibelgesellschaft,
 * license statement at https://ebible.org/deu1951/copyright.htm).
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

/** Lower-cased user input → canonical code (codes themselves also accepted). */
const TRANSLATION_ALIASES: Record<string, TranslationCode> = {
  lut: "LUT", luther: "LUT", luther1912: "LUT",
  sch: "SCH", schlachter: "SCH", schlachter1951: "SCH",
  elb: "ELB", elberfelder: "ELB", elberfelder1871: "ELB",
  mb: "MB", menge: "MB", menge1939: "MB",
};

/**
 * Resolve a tool argument to a translation code. Absent/empty input falls
 * back to the default; unknown input returns null (callers report the error).
 */
export function resolveTranslation(input: unknown): TranslationCode | null {
  if (input === undefined || input === null || input === "") return DEFAULT_TRANSLATION;
  if (typeof input !== "string") return null;
  return TRANSLATION_ALIASES[input.trim().toLowerCase()] ?? null;
}
