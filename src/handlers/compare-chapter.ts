/**
 * Das Werkzeug `bible_compare_chapter`: welche Verse eines NT-Kapitels zwischen
 * den geladenen griechischen Editionen abweichen.
 *
 * Eine Übersicht und kein zweiter Vergleich. Sie beantwortet die Frage, die vor
 * dem Einzelvergleich steht (wo lohnt es sich hinzusehen), und verweist für
 * alles Weitere auf `bible_compare`: Bezeugung je Wort, Art der Variante,
 * Abgleich der Apparatnotiz gegen den Editionstext. Gemessen an der Nutzung
 * wurde dafür bisher Vers um Vers verglichen, bis zu sechs Verse je Kapitel in
 * einer Sitzung, ohne zu wissen, welche es wert sind (17.11.2026).
 *
 * „Weicht ab" allein trennt kaum: 5311 der 7961 NT-Verse weichen in mindestens
 * einem Editionspaar ab, weil der kritische Text fast überall anders schreibt
 * (byzantine↔tr 1489 Verse, byzantine↔sblgnt 4957, tr↔sblgnt 5188; gemessen
 * 17.11.2026). Deshalb zwei Auskünfte, die die Menge ordnen: die Zahl je
 * Editionspaar, und an jedem Vers die Marke, ob der Apparat dort eine
 * Bedeutungsvariante notiert (2635 Verse). Die Marke stammt aus der
 * TAGNT-Bezeugung und nicht aus den verglichenen Editionen; das sagt der
 * `hinweis` in jeder Antwort, weil die Verwechslung der beiden der Fehlgriff
 * ist, den `bible_compare` schon kennt.
 *
 * Eine Größengrenze braucht es nicht: Die Liste misst je Kapitel im Median 4817
 * und höchstens 15 899 Zeichen (Markus 14; über alle 260 Kapitel ausgezählt am
 * 17.11.2026).
 */

import { availableEditions, stmtOriginal, stmtOriginalVerse, stmtTagnt } from "../db.ts";
import { DATASET_QUELLEN, EDITION_META, NT_EDITION_ORDER, quellen } from "../editions.ts";
import {
  MAX_CHAPTER,
  bookNotFound,
  chapterOutOfRange,
  errorResult,
  formatVerseReference,
  getBookDisplayName,
  jsonResult,
  parseVerses,
  pruefeVersliste,
  requireBookName,
  resolveBook,
  stellenangabe,
  toInt,
} from "../werkzeug-helfer.ts";
import { PAAR_IDENTISCH, paarVergleiche, type PaarVergleich } from "./compare.ts";

export function handleCompareChapter(args: {
  book?: unknown;
  chapter?: unknown;
  verses?: unknown;
}) {
  // In lokale Konstanten, damit die Prüfung auch in den Schleifen weiter unten
  // gilt: Über eine Funktionsgrenze hinweg vergisst der Compiler sie.
  const woerterStmt = stmtOriginal;
  const verseStmt = stmtOriginalVerse;
  if (!woerterStmt || !verseStmt || availableEditions.size === 0) {
    return errorResult(
      "Urtext-Daten nicht geladen. Bitte zuerst 'bun run download:byz' ausführen.",
      "bestand"
    );
  }

  const geprueft = requireBookName(args.book, "Error: 'book' is required (e.g. 'Römer', '1Joh').");
  if ("error" in geprueft) {
    return errorResult(geprueft.error, "eingabe");
  }
  const { book } = geprueft;

  const chapter = toInt(args.chapter);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    return errorResult(chapterOutOfRange, "eingabe");
  }
  const versliste = pruefeVersliste(args.verses);
  if ("error" in versliste) {
    return errorResult(versliste.error, "eingabe");
  }
  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }
  if (bookId < 40) {
    return errorResult(
      "Der Editionsvergleich gilt nur fürs NT; fürs AT gibt es nur eine Edition (hebräischer WLC).",
      "eingabe"
    );
  }

  const editions = NT_EDITION_ORDER.filter((e) => availableEditions.has(e));
  if (editions.length < 2) {
    return errorResult(
      `Mindestens zwei NT-Editionen nötig; geladen: ${editions.join(", ") || "keine"}. ` +
        "Bitte die Download-Skripte (download-byz.ts, download-tr.ts, download-morph.ts) ausführen.",
      "bestand"
    );
  }

  // Welche Verse das Kapitel hat, sagt die Vereinigung über die Editionen: Ein
  // Vers, den nur eine führt, ist gerade ein Befund und darf nicht daran
  // scheitern, dass eine andere ihn nicht kennt.
  const imKapitel = new Set<number>();
  for (const ed of editions) {
    for (const r of verseStmt.all(ed, bookId, chapter)) imKapitel.add(r.verse);
  }
  const buchName = getBookDisplayName(bookId);
  if (imKapitel.size === 0) {
    return errorResult(`Keine Urtext-Daten für ${buchName} ${chapter}.`, "stelle");
  }
  const gewuenscht = versliste.verses === "" ? null : parseVerses(versliste.verses);
  const verse = (gewuenscht ?? [...imKapitel]).filter((v) => imKapitel.has(v)).sort((a, b) => a - b);
  const ohneDaten = (gewuenscht ?? []).filter((v) => !imKapitel.has(v));
  if (verse.length === 0) {
    return errorResult(
      `Keine Urtext-Daten für ${buchName} ${chapter},${formatVerseReference(ohneDaten)}.`,
      "stelle"
    );
  }

  const jePaar = new Map<string, number>();
  const abweichend: Array<Record<string, unknown>> = [];
  const identisch: number[] = [];
  const mitBedeutungsvariante: number[] = [];
  for (const v of verse) {
    const texts = editions.map((ed) => ({
      ed,
      words: woerterStmt.all(ed, bookId, chapter, v).map((r) => r.surface),
    }));
    // Ein Vers, der in einer Edition fehlt, ist eine Abweichung und kein
    // „identisch": Genau solche Verse sucht, wer diese Übersicht aufruft. Fehlt
    // er dagegen in beiden Editionen eines Paars, sind die beiden sich einig;
    // der Einzelvergleich meldet dort „Vers fehlt in Edition …", und als
    // Unterschied gezählt stünde 3. Johannes 15 unter byzantine ↔ tr, obwohl
    // keine der beiden den Vers führt.
    const ohneVers = new Set(texts.filter((x) => x.words.length === 0).map((x) => x.ed as string));
    const unterschiede: PaarVergleich[] = paarVergleiche(texts).filter((p) => {
      if (p.ergebnis === PAAR_IDENTISCH) return false;
      const [a, b] = p.paar.split(" ↔ ");
      return !(ohneVers.has(a ?? "") && ohneVers.has(b ?? ""));
    });
    const notiert = stmtTagnt
      ? stmtTagnt.all(bookId, chapter, v).some((r) => r.meaning_variant !== "")
      : false;
    if (notiert) mitBedeutungsvariante.push(v);
    if (unterschiede.length === 0) {
      identisch.push(v);
      continue;
    }
    for (const p of unterschiede) jePaar.set(p.paar, (jePaar.get(p.paar) ?? 0) + 1);
    abweichend.push({
      vers: v,
      ...(notiert ? { tagnt_bedeutungsvariante: true } : {}),
      vergleiche: unterschiede,
    });
  }

  // Jedes Paar steht da, auch mit null: Eine fehlende Zeile läse sich wie
  // „nicht verglichen".
  const paare: Array<{ paar: string; verse_mit_unterschied: number }> = [];
  for (let i = 0; i < editions.length; i++) {
    for (let j = i + 1; j < editions.length; j++) {
      const paar = `${editions[i]!} ↔ ${editions[j]!}`;
      paare.push({ paar, verse_mit_unterschied: jePaar.get(paar) ?? 0 });
    }
  }

  const hinweise = [
    "Übersicht, kein Einzelvergleich: Sie nennt, welche Verse zwischen den geladenen Editionen " +
      "abweichen und worin. Der Vergleich ignoriert Akzente, Groß-/Kleinschreibung und " +
      "Schlusssigma (byzantine/tr sind unakzentuiert gespeichert); was bleibt, sind echte " +
      "Textvarianten oder Schreibvarianten. Welche Art vorliegt, sagt diese Übersicht nicht: " +
      "Das steht je Vers in bible_compare ('bezeugung'), ebenso die Zeugen je Wort.",
    stmtTagnt
      ? "'tagnt_bedeutungsvariante' und 'tagnt_bedeutungsvarianten' stammen aus dem Apparat " +
        "(STEPBible TAGNT), nicht aus den hier verglichenen Editionen: Die Marke sagt, dass der " +
        "Apparat an diesem Vers eine Bedeutungsvariante notiert, nicht, dass die geladenen " +
        "Editionen dort auseinandergehen. Ein markierter Vers kann deshalb unter 'identisch' stehen."
      : null,
    ohneDaten.length > 0
      ? `Für ${ohneDaten.length === 1 ? "Vers" : "die Verse"} ${formatVerseReference(ohneDaten)} ` +
        "führt keine geladene Edition Daten ('verse_ohne_daten'); 'reference' nennt die geprüften Verse."
      : null,
    "Die Zahlen stehen im Ergebnis ('verse_geprueft', 'verse_mit_unterschied', je Paar in 'paare'): " +
      "übernehmen, nicht aus der Liste nachzählen.",
  ].filter((h): h is string => h !== null);

  return jsonResult({
    ...stellenangabe(bookId, chapter, formatVerseReference(verse)),
    sprache: "Griechisch (Koine)",
    editionen: editions.map((ed) => ({ texttyp: ed, edition: EDITION_META[ed]!.label })),
    verse_geprueft: verse.length,
    verse_mit_unterschied: abweichend.length,
    paare,
    verse: abweichend,
    ...(identisch.length > 0 ? { identisch: formatVerseReference(identisch) } : {}),
    ...(mitBedeutungsvariante.length > 0
      ? { tagnt_bedeutungsvarianten: formatVerseReference(mitBedeutungsvariante) }
      : {}),
    ...(ohneDaten.length > 0 ? { verse_ohne_daten: ohneDaten } : {}),
    hinweis: hinweise.join(" "),
    quellen: quellen(
      ...editions.map((ed) => EDITION_META[ed]!.quelle),
      stmtTagnt ? DATASET_QUELLEN.tagnt : undefined
    ),
  });
}
