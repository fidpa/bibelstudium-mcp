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
export function gekuerztFeld(
  b: VerseBudget,
  weitere?: { noten?: VerseBudget; parallelen?: VerseBudget }
): Record<string, unknown> {
  const noten = weitere?.noten;
  const parallelen = weitere?.parallelen;
  const notenGekuerzt = noten !== undefined && noten.gekuerzt;
  // Ein Teilbudget kann greifen, ohne dass das Hauptbudget es merkt: Es lehnt
  // aus eigener Obergrenze ab und belastet das Hauptbudget dabei nicht. Ohne
  // diese Abfrage bliebe eine Kürzung, die allein die Parallelstellen trifft,
  // ohne jede Meldung.
  const parallelenGekuerzt = parallelen !== undefined && parallelen.gekuerzt;
  if (b.verseMax === null || (!b.gekuerzt && !notenGekuerzt && !parallelenGekuerzt)) return {};
  return {
    gekuerzt: {
      verse_max: b.verseMax,
      im_wortlaut: b.imWortlaut,
      ohne_wortlaut: b.ohneWortlaut,
      ...(notenGekuerzt
        ? { fussnoten_gezeigt: noten.imWortlaut, fussnoten_entfallen: noten.ohneWortlaut }
        : {}),
      ...(parallelenGekuerzt
        ? {
            parallelen_max: parallelen.verseMax,
            parallelen_gezeigt: parallelen.imWortlaut,
            parallelen_entfallen: parallelen.ohneWortlaut,
          }
        : {}),
    },
  };
}

/**
 * Ein Teilbudget, das aus einem Hauptbudget schöpft, aber höchstens `hoechstens`
 * Verse nimmt.
 *
 * Gebraucht für die Parallelstellen in `bible_crossrefs`. Sie werden **vor** den
 * Verweisen bedient, weil `nimmGanz` nach der ersten Ablehnung sperrt: Wer sie
 * hinten anstellt, bekommt sie bei der Schlachter 2000 in 6,2 % der Abrufe mit
 * dem Vorgabelimit und in 29,2 % mit dem Höchstlimit ohne Wortlaut (gemessen
 * 22.08.2026). Umgekehrt dürfen sie das Budget nicht leerräumen, deshalb die
 * eigene Obergrenze.
 *
 * Die Sperre des Teilbudgets greift **nicht** auf das Hauptbudget durch. Das ist
 * der Kern: Eine Ablehnung aus eigener Obergrenze fragt das Hauptbudget gar
 * nicht erst, sonst setzte sie dort `gesperrt` und die Verweise gingen
 * sämtlich ohne Text hinaus. Verbraucht ein Mitglied dagegen echtes Budget,
 * wird das Hauptbudget belastet, und die Zusage „höchstens `verseMax` Verse je
 * Abruf" gilt über beide Teile zusammen.
 */
export function teilBudget(eltern: VerseBudget, hoechstens: number): VerseBudget {
  if (eltern.verseMax === null) return eltern;
  const grenze = Math.min(hoechstens, eltern.verseMax);
  let imWortlaut = 0;
  let ohneWortlaut = 0;
  let gesperrt = false;
  return {
    verseMax: grenze,
    ausgabe: eltern.ausgabe,
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
      const frei = Math.min(grenze - imWortlaut, (eltern.verseMax ?? 0) - eltern.imWortlaut);
      const bewilligt = Math.max(Math.min(anzahl, frei), 0);
      // Rein defensiv, kein Fall herstellbar (kein Aufrufer ruft `nimm` auf einem
      // Teilbudget): Lehnt das Elternbudget ab, obwohl `frei` es zuließ, dürfen
      // die Verse nicht hier als geliefert und dort als entfallen stehen.
      if (bewilligt > 0 && !eltern.nimmGanz(bewilligt)) {
        ohneWortlaut += anzahl;
        return 0;
      }
      imWortlaut += bewilligt;
      ohneWortlaut += anzahl - bewilligt;
      return bewilligt;
    },
    nimmGanz(anzahl) {
      const passt =
        !gesperrt &&
        imWortlaut + anzahl <= grenze &&
        eltern.imWortlaut + anzahl <= (eltern.verseMax ?? 0);
      if (passt && eltern.nimmGanz(anzahl)) {
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
 * Der Satz für den `hinweis`, oder null, wenn nichts zu melden ist. Er nennt die
 * Ausgabe und die Grenze, und er fordert nicht dazu auf, den Rest in einem
 * zweiten Aufruf zu holen: Die Zusage gilt je Abruf, und eine Anleitung zum
 * Umgehen gehört nicht in die Antwort, die sie einhält.
 */
export function verseMaxHinweis(
  b: VerseBudget,
  lage:
    | { art: "verse"; gefunden: number }
    | {
        art: "verweise";
        mitText: number;
        gesamt: number;
        /** Die Parallelstellen derselben Antwort, wenn sie welche trägt. Sie
         *  teilen sich das Budget mit den Verweisen und werden vor ihnen
         *  bedient; ohne diese beiden Zahlen nennte der Satz nur die eine
         *  Hälfte der Kürzung und läse sich, als sei die andere vollständig. */
        parallelenMitText?: number;
        parallelenGesamt?: number;
      }
    | { art: "treffer"; mitText: number; gesamt: number }
): string | null {
  // Auch dann melden, wenn allein die Parallelstellen gekürzt wurden: Sie
  // schöpfen aus einem Teilbudget, das ablehnen kann, ohne das Hauptbudget zu
  // belasten. Ohne diese Bedingung stand die Kürzung im Feld `gekuerzt` und in
  // keinem Satz (gemessen 22.08.2026 an Hesekiel 12,1 mit der Schlachter 2000:
  // 29 von 37 Stellen ohne Wortlaut, `hinweis` schwieg).
  const parallelenGekuerzt =
    lage.art === "verweise" &&
    lage.parallelenGesamt !== undefined &&
    lage.parallelenGesamt > (lage.parallelenMitText ?? 0);
  if (b.verseMax === null || (!b.gekuerzt && !parallelenGekuerzt)) return null;
  const kopf =
    `Für die ${b.ausgabe} gibt dieser Server je Abruf höchstens ` +
    `${b.verseMax} Verse im Wortlaut aus.`;
  switch (lage.art) {
    case "verse":
      return (
        `${kopf} Gefunden wurden ${lage.gefunden} Verse; enthalten sind die ` +
        `ersten ${b.imWortlaut}. Welche enthalten sind, sagt 'reference'.`
      );
    case "verweise": {
      // Beide Teile werden nur benannt, wenn sie wirklich gekürzt wurden. Ein
      // Satz über die Verweise, von denen keiner Text verloren hat, lenkte auf
      // die falsche Hälfte.
      const teile = [
        b.gekuerzt
          ? `${lage.mitText} der ${lage.gesamt} Verweise tragen deshalb ihren ` +
            `Text, die übrigen allein 'stelle' und 'votes'.`
          : null,
        parallelenGekuerzt
          ? `Von den ${lage.parallelenGesamt} Parallelstellen tragen ` +
            `${lage.parallelenMitText ?? 0} ihren Text; für sie gilt zusätzlich ` +
            `eine eigene Obergrenze innerhalb dieser Zahl, und sie werden vor ` +
            `den Verweisen bedient.`
          : null,
      ].filter((t): t is string => t !== null);
      const unberuehrt = parallelenGekuerzt
        ? "Die Zahl der Verweise und der Parallelstellen ist davon nicht berührt."
        : "Die Zahl der Verweise ist davon nicht berührt.";
      return `${kopf} ${teile.join(" ")} ${unberuehrt}`;
    }
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
