/**
 * Das Werkzeug `bible_lookup_many`: mehrere Stellen im Wortlaut, in einem Abruf.
 *
 * Warum es das gibt, ist gemessen: In einer Nutzungsreihe standen 1291 von 1353
 * Aufrufen in Parallelstapeln, bis zu 19 `bible_lookup` in einer Nachricht, und
 * 152 der 184 Stapel umfassten zusammen höchstens 20 Verse (17.11.2026). Jeder
 * dieser Aufrufe trug Quellenangabe und Hinweise ein eigenes Mal, und ein
 * dichter Stapel lief am gehosteten Endpunkt in dessen Ratenbegrenzung.
 *
 * Ein eigenes Werkzeug und kein Modus von `bible_lookup`, weil dessen
 * Ausgabeschema `reference` und `text` verlangt: Eine Antwort über viele
 * Stellen hat beides je Eintrag und nicht oben, die Pflichtfelder hätten also
 * weichen müssen. Die Kosten dieses Wegs stehen in `docs/ENTSCHEIDUNGEN.md`.
 *
 * Drei Dinge unterscheiden die Antwort von vielen Einzelantworten:
 *
 * - **Die Wortlaut-Grenze gilt über den ganzen Abruf**, je Ausgabe einmal. Ein
 *   Abruf ist ein Abruf, auch wenn er zwanzig Stellen nennt; vergeben wird in
 *   der Reihenfolge der Anfrage, und was nicht mehr hineinpasst, trägt
 *   `ohne_wortlaut` statt eines leeren Textes.
 * - **Ein Eintrag, der scheitert, reißt die anderen nicht mit.** Er trägt
 *   `fehler` mit derselben Meldung, die `bible_lookup` gäbe. Erst wenn kein
 *   einziger Eintrag Wortlaut liefert und mindestens einer gescheitert ist, ist
 *   der ganze Abruf ein Fehler.
 * - **Was für mehrere Einträge gilt, steht einmal oben:** die Quellen, die
 *   Nennungspflicht, und gleiche Hinweise zusammengefasst unter den Stellen,
 *   die sie betreffen.
 */

import type { FehlerKlasse } from "../metriken.ts";
import { quellen, translationQuelle } from "../editions.ts";
import { TRANSLATIONS, type TranslationCode } from "../translations.ts";
import { noteMaxHinweis, verseBudget, type VerseBudget } from "../verse-budget.ts";
import {
  bracketHints,
  errorResult,
  jsonResult,
  keineVerseGefunden,
  lookupTeile,
  markiereTeilfehler,
  nennungHinweis,
  pruefeStelle,
  versText,
} from "../werkzeug-helfer.ts";

/** Obergrenze der Einträge je Abruf. Über dem größten gemessenen Stapel (19)
 *  und klein genug, dass eine Antwort aus Einzelversen überschaubar bleibt. */
export const MAX_STELLEN = 30;

const stellenRequired =
  `Error: 'stellen' is required: an array of 1 to ${MAX_STELLEN} passages, each ` +
  `{ book, chapter, verses?, translation? }`;
const stellenTooMany = `Error: 'stellen' must list at most ${MAX_STELLEN} passages per call`;
const eintragKeinObjekt =
  "Error: each entry in 'stellen' must be an object { book, chapter, verses?, translation? }";

/** Wie der Aufrufer die Stelle geschrieben hat, für Einträge ohne `reference`. */
function anfrageText(eintrag: unknown): string {
  if (typeof eintrag !== "object" || eintrag === null || Array.isArray(eintrag)) {
    return JSON.stringify(eintrag ?? null).slice(0, 80);
  }
  const e = eintrag as Record<string, unknown>;
  const vers = e["verses"] ?? e["verse"];
  const teile = [
    typeof e["book"] === "string" ? e["book"].slice(0, 50) : JSON.stringify(e["book"] ?? null).slice(0, 50),
    e["chapter"] === undefined ? "" : ` ${String(e["chapter"]).slice(0, 10)}`,
    vers === undefined || vers === null || vers === "" ? "" : `,${String(vers).slice(0, 40)}`,
    typeof e["translation"] === "string" ? ` (${e["translation"].slice(0, 20)})` : "",
  ];
  return teile.join("");
}

export function handleLookupMany(rawArgs: unknown) {
  const args = rawArgs as { stellen?: unknown; translation?: unknown };

  if (!Array.isArray(args.stellen) || args.stellen.length === 0) {
    return errorResult(stellenRequired, "eingabe");
  }
  if (args.stellen.length > MAX_STELLEN) {
    return errorResult(stellenTooMany, "eingabe");
  }

  // Ein Vers- und ein Notenbudget je Ausgabe, für den ganzen Abruf.
  const budgets = new Map<TranslationCode, { verse: VerseBudget; noten: VerseBudget }>();
  const budgetFuer = (code: TranslationCode) => {
    let b = budgets.get(code);
    if (b === undefined) {
      b = { verse: verseBudget(code), noten: verseBudget(code) };
      budgets.set(code, b);
    }
    return b;
  };

  const stellen: Array<Record<string, unknown>> = [];
  const fehlerKlassen: FehlerKlasse[] = [];
  const fehlerTexte: string[] = [];
  const gelieferteTexte: string[] = [];
  const gelieferteAusgaben: TranslationCode[] = [];
  // Gleiche Sätze zur Verszählung gelten oft mehreren Einträgen desselben
  // Kapitels; gesammelt wird je Satz, wen er betrifft.
  const zaehlungen = new Map<string, string[]>();
  let geliefert = 0;
  let ohneWortlaut = 0;

  args.stellen.forEach((roh, index) => {
    const nr = index + 1;
    const scheitert = (meldung: string, klasse: FehlerKlasse) => {
      stellen.push({ nr, anfrage: anfrageText(roh), fehler: meldung });
      fehlerKlassen.push(klasse);
      fehlerTexte.push(`(${nr}) ${meldung}`);
    };

    if (typeof roh !== "object" || roh === null || Array.isArray(roh)) {
      scheitert(eintragKeinObjekt, "eingabe");
      return;
    }
    const eintrag = roh as {
      book?: unknown;
      chapter?: unknown;
      verses?: unknown;
      verse?: unknown;
      translation?: unknown;
    };
    const stelle = pruefeStelle(
      {
        ...eintrag,
        // Die Ausgabe des Eintrags geht vor, sonst gilt die des Abrufs.
        translation:
          eintrag.translation === undefined || eintrag.translation === null || eintrag.translation === ""
            ? args.translation
            : eintrag.translation,
      },
      "Error: 'book' is required in every entry (e.g. 'Jesaja', '1. Mose', 'Römer')."
    );
    if ("error" in stelle) {
      scheitert(stelle.error, stelle.klasse);
      return;
    }

    const b = budgetFuer(stelle.code);
    const teile = lookupTeile(stelle.code, stelle.bookId, stelle.chapter, stelle.verses, b.verse, b.noten);
    if (teile.art === "nicht_gefunden") {
      scheitert(keineVerseGefunden(stelle), "stelle");
      return;
    }
    const translation = TRANSLATIONS[stelle.code].name;
    if (teile.art === "ohne_wortlaut") {
      ohneWortlaut += 1;
      stellen.push({ nr, anfrage: anfrageText(roh), translation, ohne_wortlaut: true });
      return;
    }

    geliefert += 1;
    gelieferteAusgaben.push(stelle.code);
    for (const v of teile.verse) gelieferteTexte.push(v.text);
    const gekuerzt = teile.verse.length < teile.gefunden;
    if (teile.zaehlung !== null) {
      zaehlungen.set(teile.zaehlung, [...(zaehlungen.get(teile.zaehlung) ?? []), teile.stelle.kurzref]);
    }
    stellen.push({
      nr,
      ...teile.stelle,
      translation,
      text: versText(teile.verse),
      ...(teile.fussnoten.length > 0 ? { fussnoten: teile.fussnoten } : {}),
      ...(gekuerzt ? { gekuerzt: { verse_gefunden: teile.gefunden, verse_enthalten: teile.verse.length } } : {}),
    });
  });

  // Kein Eintrag mit Wortlaut, und mindestens einer gescheitert: Dann ist der
  // Abruf als Ganzes ein Fehler, wie es jeder einzelne `bible_lookup` gewesen
  // wäre. Die erste Klasse zählt mit dem Fehler, die übrigen als Teilfehler.
  // (Ohne Wortlaut bleiben kann hier keiner: Das setzt einen gelieferten
  // Eintrag derselben Ausgabe voraus, der das Budget verbraucht hat.)
  if (geliefert === 0) {
    const ergebnis = errorResult(
      `Keine der ${args.stellen.length} Stellen ließ sich nachschlagen. ${fehlerTexte.join(" ")}`,
      fehlerKlassen[0] ?? "eingabe"
    );
    markiereTeilfehler(ergebnis, fehlerKlassen.slice(1));
    return ergebnis;
  }

  // Vorbehalte nach oben: erst was fehlt, dann was die gelieferten Texte
  // einschränkt.
  const hinweise: string[] = [];
  if (fehlerKlassen.length > 0) {
    hinweise.push(
      `${fehlerKlassen.length} der ${args.stellen.length} Stellen ließen sich nicht nachschlagen; ` +
        "der Grund steht je Eintrag in 'fehler'."
    );
  }
  const gekuerzt: Array<Record<string, unknown>> = [];
  for (const [code, b] of budgets) {
    if (b.verse.verseMax === null || (!b.verse.gekuerzt && !b.noten.gekuerzt)) continue;
    if (b.verse.gekuerzt) {
      // Die Grenze je Abruf, als Tatsache. Kein Satz darüber, wie der Rest zu
      // holen wäre: Die Zusage gilt je Abruf, und eine Anleitung zum Umgehen
      // gehört nicht in die Antwort, die sie einhält.
      hinweise.push(
        `Für die ${b.verse.ausgabe} gibt dieser Server je Abruf höchstens ${b.verse.verseMax} ` +
          `Verse im Wortlaut aus, über alle Stellen eines Abrufs zusammen. Enthalten sind ` +
          `${b.verse.imWortlaut} Verse, ${b.verse.ohneWortlaut} weitere nicht: Einträge mit ` +
          `'ohne_wortlaut' tragen keinen Text, und wo 'gekuerzt' steht, nennt 'reference', ` +
          `was enthalten ist.`
      );
    }
    const noten = noteMaxHinweis(b.noten);
    if (noten !== null) hinweise.push(noten);
    gekuerzt.push({
      translation: TRANSLATIONS[code].name,
      verse_max: b.verse.verseMax,
      im_wortlaut: b.verse.imWortlaut,
      ohne_wortlaut: b.verse.ohneWortlaut,
      ...(b.noten.gekuerzt
        ? { fussnoten_gezeigt: b.noten.imWortlaut, fussnoten_entfallen: b.noten.ohneWortlaut }
        : {}),
    });
  }
  for (const [satz, kurzrefs] of zaehlungen) {
    hinweise.push(`Zu ${kurzrefs.join("; ")}: ${satz}`);
  }
  // Die Nennungspflicht einmal, gleich wie viele Einträge sie trifft: Der Satz
  // verweist auf 'quellen', und dort steht jede Ausgabe genau einmal.
  const nennung = gelieferteAusgaben.map(nennungHinweis).find((h) => h !== null);
  if (nennung !== undefined && nennung !== null) hinweise.push(nennung);
  hinweise.push(...bracketHints(gelieferteTexte));

  const ergebnis = jsonResult({
    stellen,
    angefragt: args.stellen.length,
    geliefert,
    ohne_wortlaut: ohneWortlaut,
    fehlgeschlagen: fehlerKlassen.length,
    ...(hinweise.length > 0 ? { hinweis: hinweise.join(" ") } : {}),
    ...(gekuerzt.length > 0 ? { gekuerzt } : {}),
    quellen: quellen(...gelieferteAusgaben.map(translationQuelle)),
  });
  // Ein gescheiterter Eintrag in einer geglückten Antwort ist kein `isError`,
  // soll in der Zählung der Fehlerklassen aber nicht verschwinden.
  markiereTeilfehler(ergebnis, fehlerKlassen);
  return ergebnis;
}
