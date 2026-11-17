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
 * Die Wertprüfung von `verses` steht vor beiden Nachschlagepfaden, nicht in
 * einem von ihnen. Sie waren einmal uneins, und dieselbe Angabe bekam je nach
 * Komma zwei verschiedene Antworten.
 */

import {
  MAX_CHAPTER,
  MAX_VERSE,
  MAX_VERSES_LENGTH,
  MAX_VERSE_PARTS,
  bookNotFound,
  chapterOutOfRange,
  errorResult,
  jsonResult,
  lookupPayload,
  requireBookName,
  requireTranslation,
  resolveBook,
  toInt,
  reversedVerseRange,
  unparsableVersePart,
  versesReversedRange,
  versesNotAString,
  versesNotParsable,
  versesOutOfBounds,
  versesTooLong,
  versesTooManyParts,
} from "../werkzeug-helfer.ts";

export function handleLookup(rawArgs: unknown) {
  const args = rawArgs as {
    book?: unknown;
    chapter?: unknown;
    verses?: unknown;
    verse?: unknown;
    translation?: unknown;
  };

  const { translation } = args;

  // Pflichteingaben prüfen. Anwesenheit, Typ und Länge sind getrennte Prüfungen,
  // damit jede Meldung die tatsächlich verletzte Bedingung nennt; sie liegen in
  // `requireBookName`, weil vier Werkzeuge sie zeichengleich brauchen.
  const geprueft = requireBookName(
    args.book,
    "Error: 'book' is required (e.g. 'Jesaja', '1. Mose', 'Römer')."
  );
  if ("error" in geprueft) {
    return errorResult(geprueft.error, "eingabe");
  }
  const { book } = geprueft;

  const chapter = toInt(args.chapter);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    return errorResult(chapterOutOfRange, "eingabe");
  }

  // `verses` als Zeichenkette oder als einzelne Zahl annehmen (nachsichtig
  // gegenüber MCP-Clients). Fehlt es, gilt ersatzweise `verse`: So heißt das
  // Argument bei den drei Einzelvers-Werkzeugen, und wer von dort kommt,
  // bekäme sonst das ganze Kapitel statt des einen Verses, ohne jede Meldung
  // (siehe `einzelVers` in werkzeug-helfer.ts für die Gegenrichtung).
  const versAngabe =
    args.verses === undefined || args.verses === null ? args.verse : args.verses;
  const verses =
    versAngabe === undefined || versAngabe === null
      ? ""
      : typeof versAngabe === "string"
        ? versAngabe
        : typeof versAngabe === "number" && Number.isInteger(versAngabe)
          ? String(versAngabe)
          : null;
  // Die billigste Prüfung zuerst: Typ, Länge, Anzahl der Segmente, Werte.
  if (verses === null) {
    return errorResult(versesNotAString, "eingabe");
  }
  if (verses.length > MAX_VERSES_LENGTH) {
    return errorResult(versesTooLong, "eingabe");
  }
  if (verses.split(",").length > MAX_VERSE_PARTS) {
    return errorResult(versesTooManyParts, "eingabe");
  }
  // Form vor Wert: Ein Segment ohne Ziffern fällt der Wertprüfung unten nicht
  // auf (sie greift auf `\d+`), und `parseVerses` ließe es stillschweigend
  // fallen. Die leere Angabe bleibt zulässig, sie meint das ganze Kapitel.
  if (verses !== "" && unparsableVersePart(verses) !== null) {
    return errorResult(versesNotParsable, "eingabe");
  }
  // Eine umgekehrte Spanne („10-5") besteht Form und Wert und fiel in
  // parseVerses still weg; ihre Meldung steht vor beiden Nachschlagepfaden.
  if (verses !== "" && reversedVerseRange(verses) !== null) {
    return errorResult(versesReversedRange, "eingabe");
  }
  // Vor beiden Nachschlagepfaden, denn sie waren einmal uneins: Der Schnellpfad
  // für eine schlichte Spanne prüfte MAX_VERSE gar nicht („1-500" wurde wie
  // gültige Eingabe beantwortet), während der Weg über parseVerses das
  // beanstandete Segment stillschweigend fallen ließ („1-500,2" wurde mit Vers 2
  // allein beantwortet). Gleiche Bedeutung, zwei Ergebnisse, entschieden durch
  // ein Komma (gemessen 26.07.2026).
  if ([...verses.matchAll(/\d+/g)].some(([n]) => {
    const value = parseInt(n, 10);
    return value < 1 || value > MAX_VERSE;
  })) {
    return errorResult(versesOutOfBounds, "eingabe");
  }

  // Buchnamen zur Nummer auflösen
  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }

  // Übersetzung auflösen (streng: unbekannte oder nicht geladene Kürzel sind Fehler)
  const resolved = requireTranslation(translation);
  if ("error" in resolved) {
    return errorResult(resolved.error, resolved.klasse);
  }

  // Verse nachschlagen. Die Nutzlast teilt sich dieses Werkzeug mit den
  // Textressourcen; `text` ist die Gestalt, die es seit je liefert (siehe
  // lookupPayload).
  const response = lookupPayload(resolved.code, bookId, chapter, verses, "text");
  if (response === null) {
    return errorResult(
      `No verses found for ${book} ${chapter}${verses ? "," + verses : ""}. Check chapter and verse numbers.`,
      "stelle"
    );
  }

  return jsonResult(response);
}
