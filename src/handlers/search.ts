/**
 * Das Werkzeug `bible_search`: Volltextsuche über die Verse einer Übersetzung.
 *
 * Zwei Zahlen, die nicht verwechselt werden dürfen: `treffer` zählt Verse,
 * `vorkommen_gesamt` zählt Vorkommen, und beide gelten je Übersetzung. Ohne
 * diese Trennung leitet ein Konsument die eine aus der anderen ab und schätzt.
 * Oberhalb der Scan-Grenze entfallen Vorkommenszahl und Verteilung; dass sie
 * fehlen, weil nicht gezählt wurde, sagt dann der Hinweis.
 *
 * Die Umformung der freien Eingabe in einen FTS5-Ausdruck steht unten und hat
 * nur diesen einen Aufrufer.
 */

import {
  HIT_OPEN,
  OCCURRENCE_SCAN_LIMIT,
  stmtSearch,
  stmtSearchAll,
  stmtSearchAllBook,
  stmtSearchBook,
  stmtSearchCount,
  stmtSearchCountBook,
} from "../db.ts";
import { quellen, translationQuelle } from "../editions.ts";
import { TRANSLATIONS } from "../translations.ts";
import { gekuerztFeld, verseBudget, verseMaxHinweis } from "../verse-budget.ts";
import {
  MAX_BOOK_LENGTH,
  MAX_QUERY_LENGTH,
  bookNotFound,
  bookTooLong,
  bracketHints,
  errorResult,
  getBookDisplayName,
  jsonResult,
  nennungHinweis,
  queryNotAString,
  queryTooLong,
  requireTranslation,
  resolveBook,
  toInt,
} from "../werkzeug-helfer.ts";

/**
 * Obergrenze für `limit`. Ein größerer Wert wird darauf geklemmt, und der
 * Hinweis unten darf dann nicht mehr zum Erhöhen auffordern: Am 06.08.2026 gab
 * der Dienst auf `limit: 1000` fünfzig Treffer aus und schrieb dazu „limit
 * erhöhen", eine Handlung, die der Aufrufer bereits vorgenommen hatte und die
 * nichts ändert. Die Zahl steht deshalb einmal hier und wird nicht erneut
 * hingeschrieben.
 */
const MAX_SEARCH_LIMIT = 50;

/**
 * Formt freie Eingabe in einen unbedenklichen FTS5-MATCH-Ausdruck um.
 * Zitierte Abschnitte werden zu Phrasen, nackte Wörter mit UND verknüpft, und
 * ein angehängtes `*` macht aus einem Wort eine Präfixsuche. Liefert null, wenn
 * kein durchsuchbares Token übrig bleibt.
 */
function buildFtsQuery(input: string): string | null {
  const terms: string[] = [];
  const parts = input.split('"');
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if (i % 2 === 1) {
      // innerhalb von Anführungszeichen: eine Phrase
      const words = seg.match(/[\p{L}\p{N}]+/gu) ?? [];
      if (words.length > 0) terms.push(`"${words.join(" ")}"`);
    } else {
      for (const m of seg.matchAll(/([\p{L}\p{N}]+)(\*)?/gu)) {
        terms.push(m[2] ? `"${m[1]}" *` : `"${m[1]}"`);
      }
    }
  }
  return terms.length > 0 ? terms.join(" ") : null;
}

/**
 * Bedient das Werkzeug `bible_search`: Volltextsuche über die Verse einer
 * Übersetzung.
 */
export function handleSearch(args: {
  query?: unknown;
  book?: unknown;
  limit?: unknown;
  translation?: unknown;
}) {
  if (!stmtSearch || !stmtSearchBook || !stmtSearchCount || !stmtSearchCountBook) {
    return errorResult(
      "Volltext-Index nicht gebaut. Bitte 'bun run build:fts' ausführen."
    );
  }
  const resolved = requireTranslation(args.translation);
  if ("error" in resolved) {
    return errorResult(resolved.error);
  }
  const translation = resolved.code;

  // Drei Bedingungen, drei Meldungen. Gefaltet meldete auch ein 150 Zeichen
  // langer Suchausdruck "'query' is required (max 100 characters)", obwohl er
  // gesetzt und eine Zeichenkette war und allein die Länge verletzte.
  const { query } = args;
  if (query === undefined || query === null || query === "") {
    return errorResult(
      "Error: 'query' is required, e.g. 'Hirte mangeln' or '\"Gnade um Gnade\"'."
    );
  }
  if (typeof query !== "string") {
    return errorResult(queryNotAString);
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return errorResult(queryTooLong);
  }
  const match = buildFtsQuery(query);
  if (match === null) {
    return errorResult("Error: 'query' enthält kein durchsuchbares Wort.");
  }
  const limit = Math.min(Math.max(toInt(args.limit) ?? 10, 1), MAX_SEARCH_LIMIT);
  const budget = verseBudget(translation);

  let bookId: number | null = null;
  if (args.book !== undefined && args.book !== null && args.book !== "") {
    if (typeof args.book !== "string") {
      return errorResult("Error: 'book' must be a German book name.");
    }
    if (args.book.length > MAX_BOOK_LENGTH) {
      return errorResult(bookTooLong);
    }
    bookId = resolveBook(args.book);
    if (bookId === null) {
      return bookNotFound(args.book);
    }
  }

  const total =
    bookId === null
      ? stmtSearchCount.get(match, translation)!.n
      : stmtSearchCountBook.get(match, translation, bookId)!.n;
  if (total === 0) {
    return errorResult(
      `Keine Treffer für "${query}"${bookId !== null ? ` in ${getBookDisplayName(bookId)}` : ""} ` +
        `(${TRANSLATIONS[translation].name}). ` +
        "Gesucht wird nach exakten Wortformen: Beugungen mitdenken oder Präfixsuche " +
        'nutzen (z. B. "lieb*").'
    );
  }
  const rows =
    bookId === null
      ? stmtSearch.all(match, translation, limit)
      : stmtSearchBook.all(match, translation, bookId, limit);

  // `treffer` zählt Verse, nicht Wortvorkommen: Ein Vers kann mehrfach passen
  // (1Joh 2,15 trägt drei Formen von „lieb*"). Konsumenten lesen „Treffer" als
  // Fundstellen und versuchen, die Zahl je Vers aufzuschlüsseln, wobei sie die
  // Zahlen je Vers raten (beobachtet 25.07.2026). Deshalb werden die
  // Hervorhebungsmarker über alle passenden Verse gezählt, damit die zweite Zahl
  // dasteht, statt abgeleitet zu werden.
  const scanSkipped = total > OCCURRENCE_SCAN_LIMIT;
  const scan =
    !scanSkipped && stmtSearchAll && stmtSearchAllBook
      ? bookId === null
        ? stmtSearchAll.all(match, translation, OCCURRENCE_SCAN_LIMIT)
        : stmtSearchAllBook.all(match, translation, bookId, OCCURRENCE_SCAN_LIMIT)
      : null;
  const hits = (text: string) => text.split(HIT_OPEN).length - 1;
  const vorkommen = scan === null ? null : scan.reduce((sum, r) => sum + hits(r.text), 0);

  // Jede Aufschlüsselung, die ein Konsument brauchen könnte, wird hier gezählt
  // und nicht dem Modell überlassen: Über sechs gemessene Läufe kamen die vom
  // Werkzeug genannten Zahlen in 10 von 10 Fällen richtig an, während selbst
  // abgeleitete Kapitelsummen in drei von fünf Fällen falsch waren, und zwar so
  // falsch, dass es gezählt aussieht, weil die Gesamtsumme aufgeht (25.07.2026).
  // Gruppiert wird nach Buch, wenn die ganze Bibel durchsucht wird, und nach
  // Kapitel, wenn die Suche auf ein Buch eingeschränkt ist: Auf dieser Ebene wird
  // die Frage jeweils gestellt. Ausgegeben nur bei mehr als einer Gruppe, denn
  // eine Aufschlüsselung mit einem Eintrag wiederholt `treffer` und lehrt nichts.
  const verteilung: Array<Record<string, unknown>> = [];
  if (scan !== null) {
    const buckets = new Map<number, { treffer: number; vorkommen: number }>();
    for (const r of scan) {
      const key = bookId === null ? r.book_id : r.chapter;
      const bucket = buckets.get(key) ?? { treffer: 0, vorkommen: 0 };
      bucket.treffer += 1;
      bucket.vorkommen += hits(r.text);
      buckets.set(key, bucket);
    }
    if (buckets.size > 1) {
      for (const [key, bucket] of [...buckets].sort((a, b) => a[0] - b[0])) {
        verteilung.push({
          ...(bookId === null ? { buch: getBookDisplayName(key) } : { kapitel: key }),
          treffer: bucket.treffer,
          vorkommen: bucket.vorkommen,
        });
      }
    }
  }

  // Die gelistete Trefferliste entsteht genau einmal und speist alles Weitere.
  // `rows` ist dafür untauglich: Dort trägt jede Zeile ihren Text, auch die, die
  // wegen der Grenze keinen ausliefert, und `bracketHints` weiter unten warnte
  // dann vor Klammern in Versen, die die Antwort nicht enthält. Der Typecheck
  // fängt das nicht, weil `r.text` auf der Datenbankzeile weiter eine
  // Zeichenkette ist. `rows` steht in Trefferreihenfolge, die ersten Treffer
  // tragen also den Text.
  const verse = rows.map((r) => ({
    stelle: `${getBookDisplayName(r.book_id)} ${r.chapter},${r.verse}`,
    ...(budget.nimm(1) === 1 ? { text: r.text } : {}),
  }));
  const gelisteteTexte = verse.flatMap((v) => (typeof v.text === "string" ? [v.text] : []));

  // `treffer`, `vorkommen_gesamt` und `verteilung` bleiben von der Grenze
  // unberührt: Das sind Zählungen über die Datenbank, und eine Zahl ist kein
  // Wortlaut.
  const response: Record<string, unknown> = {
    suche: query,
    uebersetzung: TRANSLATIONS[translation].name,
    treffer: total,
    ...(vorkommen !== null && vorkommen !== total ? { vorkommen_gesamt: vorkommen } : {}),
    ...(verteilung.length > 0 ? { verteilung } : {}),
    verse,
  };
  // Die Grenze steht vor allem anderen: Sie sagt, was in der Antwort fehlt, und
  // das schränkt jeden folgenden Satz ein.
  const hinweise: string[] = [];
  const grenzHinweis = verseMaxHinweis(budget, {
    art: "treffer",
    mitText: gelisteteTexte.length,
    gesamt: verse.length,
  });
  if (grenzHinweis !== null) {
    hinweise.push(grenzHinweis);
  }
  if (total > rows.length) {
    // Der Ausweg muss einer sein, den der Aufrufer gehen kann. Steht `limit`
    // schon auf der Obergrenze, ist Erhöhen keiner mehr.
    const ausweg =
      rows.length >= MAX_SEARCH_LIMIT
        ? `mehr als ${MAX_SEARCH_LIMIT} listet dieses Werkzeug je Abruf nicht; auf ein Buch einschränken oder den Suchausdruck verengen`
        : "limit erhöhen oder auf ein Buch einschränken";
    hinweise.push(
      `Nur die ersten ${rows.length} von ${total} Treffern gelistet (${ausweg}).`
    );
  }
  // „Im Verstext" wird unwahr, sobald gelistete Treffer ohne Text dabei sind:
  // Die Aufforderung, je Vers abzuzählen, ginge dann auch an die, die keinen
  // Text tragen, und wer ihr folgte, käme auf null Vorkommen.
  const markerSatz = budget.gekuerzt
    ? "Die Fundstellen sind in den Versen markiert, die 'text' tragen (⟦…⟧): " +
      "dort je Vers daran abzählen, nicht schätzen."
    : "Die Fundstellen im Verstext sind mit ⟦…⟧ markiert: " +
      "je Vers daran abzählen, nicht schätzen.";
  hinweise.push(
    vorkommen !== null && vorkommen !== total
      ? `'treffer' zählt Verse (${total}), nicht Wortvorkommen: in manchen Versen passt der Suchbegriff mehrfach, ` +
          `zusammen ${vorkommen} Vorkommen ('vorkommen_gesamt'). ${markerSatz}`
      : `'treffer' zählt Verse, nicht Wortvorkommen. ${markerSatz}`
  );
  // Oberhalb der Scan-Grenze entfallen beide gezählten Felder, und lange sagte
  // das nichts: Die Antwort nannte `treffer` und forderte weiter dazu auf, die
  // Marker je Vers abzuzählen, während die beiden Zahlen, die sonst dastehen,
  // schlicht fehlten (gemessen 26.07.2026, „der" mit 13 033 Treffern). Nach
  // eben der Messung, auf der `verteilung` beruht, wird geschätzt, was fehlt,
  // und liest sich trotzdem wie gezählt. Alle drei Zahlen gelten je Übersetzung
  // (`total` und die Scan-Abfragen tragen dieselbe `translation`), und deshalb
  // benennt der Ausweg sie neben der engeren Anfrage.
  if (scanSkipped) {
    hinweise.push(
      `Ab ${OCCURRENCE_SCAN_LIMIT} Treffern werden die Vorkommen nicht ausgezählt: ` +
        "'vorkommen_gesamt' und 'verteilung' fehlen deshalb hier, weil nicht gezählt wurde, " +
        "nicht weil es nichts zu zählen gäbe. Diese Zahlen nicht schätzen. Wer sie braucht, " +
        `schränkt mit 'book' auf ein Buch ein oder verengt den Suchbegriff; gezählt wird ` +
        `dann wie alle Zahlen hier für ${TRANSLATIONS[translation].name}.`
    );
  }
  if (verteilung.length > 0) {
    hinweise.push(
      `'verteilung' ist über alle ${total} Treffer ausgezählt, nicht über die gelisteten Verse: ` +
        `je ${bookId === null ? "Buch" : "Kapitel"} die Zahl der Verse ('treffer') und der Vorkommen ` +
        "('vorkommen'). Diese Zahlen übernehmen, nicht aus der Trefferliste selbst aufteilen."
    );
  }
  const nennung = nennungHinweis(translation);
  if (nennung !== null) {
    hinweise.push(nennung);
  }
  hinweise.push(...bracketHints(gelisteteTexte));
  response.hinweis = hinweise.join(" ");
  Object.assign(response, gekuerztFeld(budget));
  response.quellen = quellen(translationQuelle(translation));

  return jsonResult(response);
}
