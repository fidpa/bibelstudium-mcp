/**
 * Die Wortlaut-Grenze: wie viele Verse eine Antwort aus einer Ausgabe im
 * Wortlaut trägt, und wie das Kürzen gemeldet wird.
 *
 * Hängt allein an der Übersetzungs-Registry und sonst an nichts: keine
 * Datenbank, kein Protokollbezug. Die Zahl selbst steht in `translations.ts` je
 * Ausgabe und nirgends sonst; hier steht allein, wie sie angewandt wird.
 *
 * Anders als die Grenzen der Eingabe schützt diese nicht vor unsinnigen
 * Anfragen. Sie ist eine Zusage über die Ausgabe, und deshalb gilt für sie die
 * Regel dieses Servers in beide Richtungen: Wo gekürzt wird, steht das Kürzen
 * im Ergebnis, mit Zahl und Grund. Eine Antwort, die stillschweigend kürzer
 * ausfällt, sieht vollständig aus.
 */
import { TRANSLATIONS, type TranslationCode } from "./translations.ts";

// Ein Budget gilt für eine ganze Antwort und wird durch sie hindurchgereicht,
// weil zwei der drei Werkzeuge nicht an einer einzigen Stelle kürzen:
// `bible_crossrefs` schreibt die Zahl über bis zu 30 Verweise fort, und
// `bible_search` kürzt gar nicht, sondern lässt ein Feld weg. Wer stattdessen
// je Aufrufstelle rechnete, hätte drei Zählungen und irgendwann drei Grenzen.
export interface VerseBudget {
  /** Die Grenze der Ausgabe, oder null: dann gibt es keine. */
  readonly verseMax: number | null;
  /** Der Name der Ausgabe, für die Meldung. */
  readonly ausgabe: string;
  /**
   * Bewilligt bis zu `anzahl` Verse und liefert, wie viele davon Wortlaut
   * tragen dürfen. Für Listen, die sich an beliebiger Stelle abschneiden
   * lassen, weil jeder Eintrag für sich steht (Verse eines Kapitels, Treffer
   * einer Suche).
   */
  nimm(anzahl: number): number;
  /**
   * Bewilligt `anzahl` Verse ganz oder gar nicht, und sperrt nach der ersten
   * Ablehnung jede weitere Anfrage. Für Einheiten, die nur vollständig
   * ausgegeben werden dürfen: Ein zur Hälfte gelieferter Querverweis behielte
   * seine Stellenangabe über den ganzen Abschnitt und sähe vollständig aus.
   * Die Sperre verhindert, dass danach noch ein kürzerer Verweis durchrutscht
   * und in der Antwort ein Loch entsteht.
   */
  nimmGanz(anzahl: number): boolean;
  /** Verse, die mit Wortlaut hinausgehen. */
  readonly imWortlaut: number;
  /** Verse, die wegen der Grenze ohne Wortlaut blieben. */
  readonly ohneWortlaut: number;
  /** Hat die Grenze in dieser Antwort gegriffen? */
  readonly gekuerzt: boolean;
}

export function verseBudget(code: TranslationCode): VerseBudget {
  const verseMax = TRANSLATIONS[code].verseMax;
  let imWortlaut = 0;
  let ohneWortlaut = 0;
  let gesperrt = false;
  return {
    verseMax,
    ausgabe: TRANSLATIONS[code].name,
    get imWortlaut() {
      return imWortlaut;
    },
    get ohneWortlaut() {
      return ohneWortlaut;
    },
    get gekuerzt() {
      return ohneWortlaut > 0;
    },
    nimm(anzahl) {
      if (verseMax === null) {
        imWortlaut += anzahl;
        return anzahl;
      }
      const bewilligt = Math.min(anzahl, Math.max(verseMax - imWortlaut, 0));
      imWortlaut += bewilligt;
      ohneWortlaut += anzahl - bewilligt;
      return bewilligt;
    },
    nimmGanz(anzahl) {
      if (verseMax === null) {
        imWortlaut += anzahl;
        return true;
      }
      if (!gesperrt && imWortlaut + anzahl <= verseMax) {
        imWortlaut += anzahl;
        return true;
      }
      gesperrt = true;
      ohneWortlaut += anzahl;
      return false;
    },
  };
}

/**
 * Das Feld `gekuerzt`, oder nichts, wenn die Grenze nicht gegriffen hat. Es
 * steht neben dem Satz im `hinweis` und nicht an seiner Stelle: Der Satz ist für
 * das Modell geschrieben, die drei Zahlen sind für den, der nachrechnet.
 */
export function gekuerztFeld(b: VerseBudget, noten?: VerseBudget): Record<string, unknown> {
  const notenGekuerzt = noten !== undefined && noten.gekuerzt;
  if (b.verseMax === null || (!b.gekuerzt && !notenGekuerzt)) return {};
  return {
    gekuerzt: {
      verse_max: b.verseMax,
      im_wortlaut: b.imWortlaut,
      ohne_wortlaut: b.ohneWortlaut,
      ...(notenGekuerzt
        ? { fussnoten_gezeigt: noten.imWortlaut, fussnoten_entfallen: noten.ohneWortlaut }
        : {}),
    },
  };
}

/**
 * Der Satz für den `hinweis`, oder null, wenn nichts zu melden ist. Er nennt die
 * Ausgabe und die Grenze, und er fordert nicht dazu auf, den Rest in einem
 * zweiten Aufruf zu holen: Die Zusage gilt je Abruf, und eine Anleitung zum
 * Umgehen gehört nicht in die Antwort, die sie einhält.
 */
export function verseMaxHinweis(
  b: VerseBudget,
  lage:
    | { art: "verse"; gefunden: number }
    | { art: "verweise"; mitText: number; gesamt: number }
    | { art: "treffer"; mitText: number; gesamt: number }
): string | null {
  if (b.verseMax === null || !b.gekuerzt) return null;
  const kopf =
    `Für die ${b.ausgabe} gibt dieser Server je Abruf höchstens ` +
    `${b.verseMax} Verse im Wortlaut aus.`;
  switch (lage.art) {
    case "verse":
      return (
        `${kopf} Gefunden wurden ${lage.gefunden} Verse; enthalten sind die ` +
        `ersten ${b.imWortlaut}. Welche enthalten sind, sagt 'reference'.`
      );
    case "verweise":
      return (
        `${kopf} ${lage.mitText} der ${lage.gesamt} Verweise tragen deshalb ` +
        `ihren Text, die übrigen allein 'stelle' und 'votes'. Die Zahl der ` +
        `Verweise ist davon nicht berührt.`
      );
    case "treffer":
      return (
        `${kopf} Die ersten ${lage.mitText} gelisteten Treffer tragen deshalb ` +
        `'text', die übrigen ${lage.gesamt - lage.mitText} allein 'stelle'. Die ` +
        `Trefferzahl und die Auszählungen sind davon nicht berührt.`
      );
  }
}

/**
 * Der Satz zum Anmerkungsapparat, oder null. Eigene Meldung, weil es eine eigene
 * Grenze ist: Der Nutzer soll nicht raten, welche der beiden gegriffen hat.
 */
export function noteMaxHinweis(noten: VerseBudget): string | null {
  if (noten.verseMax === null || !noten.gekuerzt) return null;
  return (
    `Der Anmerkungsapparat dieser Ausgabe ist an derselben Grenze gekürzt: ` +
    `enthalten sind ${noten.imWortlaut} Anmerkungen, ${noten.ohneWortlaut} ` +
    `weitere zu denselben Versen nicht.`
  );
}
