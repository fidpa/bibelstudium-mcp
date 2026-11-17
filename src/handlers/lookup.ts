/**
 * Das Werkzeug `bible_lookup`: der wortgetreue deutsche Text einer Stelle.
 *
 * Bis 0.6.3 lag dieser Rumpf ohne eigenen Namen im Dispatch, als dessen
 * Rest-Fall. Am Verhalten ändert der Name nichts: Die Reihenfolge der Prüfungen
 * ist dieselbe.
 *
 * Die Meldung „No verses found" wurde dabei lange von Hand zusammengesetzt statt
 * über `errorResult`. Das war Herkunft und kein Grund: Beide Formen sind
 * gemessen austauschbar, gleiche Gestalt, gleicher Typ, byteweise gleiche
 * Antwort (05.08.2026). Sie geht jetzt denselben Weg wie jeder andere
 * Werkzeugfehler, aus demselben Grund, aus dem ein Erfolgsergebnis nur über
 * `jsonResult` entsteht: Eine handgebaute Kopie ist die Stelle, an der ein Feld
 * fehlt, sobald sich die Form ändert.
 *
 * Die Argumentprüfung liegt seit 0.7.0 in `pruefeStelle` (werkzeug-helfer.ts),
 * samt der Begründung ihrer Reihenfolge; dieses Werkzeug und der Mehrfachabruf
 * teilen sie sich.
 */

import {
  errorResult,
  jsonResult,
  keineVerseGefunden,
  lookupPayload,
  pruefeStelle,
} from "../werkzeug-helfer.ts";

export function handleLookup(rawArgs: unknown) {
  // Die Prüfkette (Buchname, Kapitel, Versangabe, Buchauflösung, Übersetzung)
  // liegt in `pruefeStelle`, weil `bible_lookup_many` sie je Eintrag zeichengleich
  // braucht. Die „is required"-Meldung bleibt hier: Sie trägt die Beispiele
  // dieses Werkzeugs.
  const stelle = pruefeStelle(
    rawArgs as {
      book?: unknown;
      chapter?: unknown;
      verses?: unknown;
      verse?: unknown;
      translation?: unknown;
    },
    "Error: 'book' is required (e.g. 'Jesaja', '1. Mose', 'Römer')."
  );
  if ("error" in stelle) {
    return errorResult(stelle.error, stelle.klasse);
  }

  // Verse nachschlagen. Die Nutzlast teilt sich dieses Werkzeug mit den
  // Textressourcen; `text` ist die Gestalt, die es seit je liefert (siehe
  // lookupPayload).
  const response = lookupPayload(stelle.code, stelle.bookId, stelle.chapter, stelle.verses, "text");
  if (response === null) {
    return errorResult(keineVerseGefunden(stelle), "stelle");
  }

  return jsonResult(response);
}
