/**
 * Das Werkzeug `bible_concordance`: alle Vorkommen eines Wortes des Grundtextes
 * in einer Edition, gefunden über die Strong-Nummer oder das genaue Lemma,
 * samt Auswertung nach Büchern und Formen.
 *
 * Der Lemma-Index unten gehört hierher und nirgendwo sonst hin: Er ist die
 * einzige Stelle, an der ein Lemma aus fremder Hand auf die abgelegte
 * Schreibweise trifft, und sein Zwischenspeicher hat genau diesen einen Leser.
 */

import {
  availableEditions,
  editionsWithStrong,
  db,
  stmtConcordLemma,
  stmtConcordStrong,
  stmtStrongDef,
} from "../db.ts";
import {
  DATASET_QUELLEN,
  EDITION_META,
  NT_EDITIONS,
  quellen,
  resolveEdition,
} from "../editions.ts";
import {
  MAX_LEMMA_LENGTH,
  errorResult,
  getBookDisplayName,
  jsonResult,
  toInt,
} from "../werkzeug-helfer.ts";

// Lemmata mit kombinierenden Zeichen (hebräische Nikkud, griechische Akzente)
// können sich zwischen den abgelegten Daten und der Eingabe eines Aufrufers in
// der Reihenfolge der Codepunkte unterscheiden und dabei kanonisch gleichwertig
// sein. Solche Fehlgriffe löst eine bei Bedarf gebaute Abbildung je Edition auf,
// von NFC-normalisiert auf abgelegtes Lemma (einmal je Edition gebaut, rund
// 10 000 Einträge).
const lemmaIndexCache = new Map<string, Map<string, string>>();
function findStoredLemma(edition: string, lemma: string): string | null {
  let idx = lemmaIndexCache.get(edition);
  if (idx === undefined) {
    idx = new Map();
    const rows = db
      .query("SELECT DISTINCT lemma FROM original_words WHERE edition = ?")
      .all(edition) as Array<{ lemma: string }>;
    for (const r of rows) idx.set(r.lemma.normalize("NFC"), r.lemma);
    lemmaIndexCache.set(edition, idx);
  }
  return idx.get(lemma.normalize("NFC")) ?? null;
}

/**
 * Bedient das Werkzeug `bible_concordance`: alle Vorkommen eines Wortes des
 * Grundtextes (über die Strong-Nummer oder das genaue Lemma) in einer Edition,
 * samt Auswertung.
 */
export function handleConcordance(args: {
  strong?: unknown;
  lemma?: unknown;
  texttyp?: unknown;
  limit?: unknown;
}) {
  if (!stmtConcordStrong || !stmtConcordLemma || availableEditions.size === 0) {
    return errorResult(
      "Urtext-Daten nicht geladen. Bitte zuerst 'bun run download:byz' " +
        "(und für das AT 'bun run download:heb') ausführen."
    );
  }

  // Suchart und Testament bestimmen.
  let strongDigits: string | null = null;
  let isHebrew: boolean;
  let suche: string;
  if (args.strong !== undefined && args.strong !== null && args.strong !== "") {
    if (typeof args.strong !== "string" || !/^[GHgh]\d{1,5}$/.test(args.strong.trim())) {
      return errorResult(
        'Error: \'strong\' muss eine Strong-Nummer mit Präfix sein, z. B. "G26" (NT) oder "H7225" (AT).'
      );
    }
    const s = args.strong.trim().toUpperCase();
    isHebrew = s[0] === "H";
    strongDigits = String(parseInt(s.slice(1), 10)); // normalize leading zeros
    suche = s;
  } else if (args.lemma !== undefined && args.lemma !== null && args.lemma !== "") {
    if (typeof args.lemma !== "string") {
      return errorResult("Error: 'lemma' must be a Greek or Hebrew word.");
    }
    if (args.lemma.length > MAX_LEMMA_LENGTH) {
      return errorResult(`Error: 'lemma' must be at most ${MAX_LEMMA_LENGTH} characters`);
    }
    const lemma = args.lemma.trim();
    if (/[֐-׿]/.test(lemma)) {
      isHebrew = true; // Hebrew block
    } else if (/[Ͱ-Ͽἀ-῿]/.test(lemma)) {
      isHebrew = false; // Greek + Greek Extended blocks
    } else {
      return errorResult(
        "Error: 'lemma' muss griechisch oder hebräisch geschrieben sein (wie von bible_original " +
          "zurückgegeben). Alternativ 'strong' verwenden (z. B. \"G26\", \"H7225\")."
      );
    }
    suche = lemma;
  } else {
    return errorResult("Error: entweder 'strong' (z. B. \"G26\") oder 'lemma' angeben.");
  }

  // Edition auflösen: Hebräisch → wlc; Griechisch → NT-Edition gemäß texttyp.
  let edition: string;
  // Bei einer hebräischen Angabe entscheidet die Angabe selbst, nicht `texttyp`:
  // Fürs AT gibt es allein den WLC. Eine mitgegebene NT-Edition wird deshalb
  // übergangen, und das gehört ins Ergebnis. `bible_original` sagt es im
  // gleichgelagerten Fall seit je; hier fehlte der Satz bis zum 07.08.2026, und
  // die Antwort sah aus, als hätte sie den gewünschten Texttyp durchsucht.
  let texttypUebergangen: string | null = null;
  if (isHebrew) {
    edition = "wlc";
    // Dieselbe Bedingung wie dort: Wer "wlc" schickt, hat recht und bekommt
    // keinen Hinweis; ein unbekannter Wert löst auf null auf und bekommt ihn.
    if (args.texttyp && resolveEdition(args.texttyp) !== "wlc") {
      texttypUebergangen = String(args.texttyp);
    }
  } else {
    const wanted = resolveEdition(args.texttyp);
    if (wanted === null || !NT_EDITIONS.has(wanted)) {
      return errorResult(
        `Error: Unbekannter oder fürs NT ungültiger texttyp "${args.texttyp}". ` +
          `Erlaubt: "byzantine" (Standard), "sblgnt", "tr".`
      );
    }
    edition = wanted;
  }
  if (!availableEditions.has(edition)) {
    return errorResult(
      `Texttyp "${edition}" ist nicht geladen. Verfügbar: ${[...availableEditions].join(", ")}.`
    );
  }

  // Vor der Abfrage, nicht nach ihr: Eine Strong-Suche gegen eine Edition ohne
  // Strong-Nummern kann nie etwas finden, und die gemeinsame Meldung unten riete
  // dann dazu, eine Strong-Nummer zu verwenden.
  if (strongDigits !== null && !editionsWithStrong.has(edition)) {
    const mitStrong = [...availableEditions].filter((e) => editionsWithStrong.has(e));
    return errorResult(
      `Die Edition "${edition}" führt keine Strong-Nummern; eine Suche danach findet dort ` +
        `grundsätzlich nichts. ` +
        (mitStrong.length > 0
          ? `Mit Strong-Nummern: ${mitStrong.join(", ")}. `
          : "") +
        `In "${edition}" ist stattdessen die Suche über 'lemma' möglich.`
    );
  }

  const limit = Math.min(Math.max(toInt(args.limit) ?? 50, 1), 200);
  let rows =
    strongDigits !== null
      ? stmtConcordStrong.all(edition, strongDigits)
      : stmtConcordLemma.all(edition, suche);
  if (rows.length === 0 && strongDigits === null) {
    // Der genaue Treffer blieb aus: über das Unicode-normalisierte Lemma erneut
    // nachschlagen.
    const stored = findStoredLemma(edition, suche);
    if (stored !== null) rows = stmtConcordLemma.all(edition, stored);
  }
  if (rows.length === 0) {
    return errorResult(
      `Keine Vorkommen für "${suche}" in Edition "${edition}" gefunden. ` +
        "Hinweis: Lemma muss exakt (mit Akzenten/Punktierung) übereinstimmen; im Zweifel Strong-Nummer verwenden."
    );
  }

  // Zusammenfassen: Anzahl je Buch und verschiedene Verse (die Zeilen stehen in
  // kanonischer Reihenfolge).
  const bookNames = new Map<number, string>();
  const name = (id: number): string => {
    let n = bookNames.get(id);
    if (n === undefined) { n = getBookDisplayName(id); bookNames.set(id, n); }
    return n;
  };
  const perBook = new Map<number, number>();
  const verseKeys = new Set<string>();
  for (const r of rows) {
    perBook.set(r.book_id, (perBook.get(r.book_id) ?? 0) + 1);
    verseKeys.add(`${r.book_id}-${r.chapter}-${r.verse}`);
  }

  const meta0 = EDITION_META[edition]!;
  const response: Record<string, unknown> = {
    suche,
    grundform: rows[0]!.lemma || "—",
  };
  // Um den Eintrag des Strong-Wörterbuchs anreichern (Umschrift und Bedeutung),
  // sofern die Lexikontabelle geladen und eine Strong-Nummer bekannt ist.
  const strongKey =
    strongDigits !== null
      ? (isHebrew ? "H" : "G") + strongDigits
      : rows[0]!.strong
        ? (isHebrew ? "H" : "G") + rows[0]!.strong
        : null;
  // Welches Lexikon tatsächlich beigetragen hat, entscheidet über die Nennung
  // weiter unten: translit, definition und kjv kommen aus den
  // Strong-Wörterbüchern (CC BY-SA), gloss und der Abbott-Smith-Eintrag von
  // STEPBible (CC BY 4.0). Eine Quelle zu nennen, die nichts beigetragen hat, ist
  // derselbe Fehler wie eine wegzulassen, die es tat.
  let usedStrongsLexicon = false;
  let usedStepLexicon = false;
  if (strongKey !== null && stmtStrongDef) {
    const def = stmtStrongDef.get(strongKey);
    if (def) {
      response.strong = strongKey;
      if (def.translit) response.umschrift = def.translit;
      if (def.gloss) response.kurzbedeutung = def.gloss;
      if (def.definition) response.bedeutung = def.definition;
      if (def.kjv) response.kjv_woerter = def.kjv;
      // Der vollständige Abbott-Smith-Eintrag (STEPBible TBESG, nur Griechisch):
      // die wissenschaftliche Bedeutung, meist einige hundert Zeichen, die Tokens
      // wert.
      if (def.meaning) response.lexikon = def.meaning;
      usedStrongsLexicon = Boolean(def.translit || def.definition || def.kjv);
      usedStepLexicon = Boolean(def.gloss || def.meaning);
    }
  }
  response.texttyp = edition;
  response.edition = meta0.label;
  response.gesamt = rows.length;
  response.verse = verseKeys.size;
  response.buecher = [...perBook.entries()].map(([id, anzahl]) => ({ buch: name(id), anzahl }));
  response.vorkommen = rows.slice(0, limit).map((r) => ({
    stelle: `${name(r.book_id)} ${r.chapter},${r.verse}`,
    wort: r.surface,
  }));
  // Zwei Hinweise, die einander nicht ausschließen: die gekürzte Liste und das
  // englische Lexikon. Bis 0.6.12 trug das Feld nur den ersten, und der zweite
  // hatte keinen Platz.
  const hinweise: string[] = [];
  // Der Vorbehalt zuerst: Er sagt, worin überhaupt gesucht wurde, und schränkt
  // damit alles ein, was danach kommt.
  if (texttypUebergangen !== null) {
    hinweise.push(
      `Der Texttyp "${texttypUebergangen}" gilt nur fürs NT; fürs AT wird der ` +
        "hebräische WLC durchsucht."
    );
  }
  if (rows.length > limit) {
    hinweise.push(
      `Nur die ersten ${limit} von ${rows.length} Vorkommen gelistet; ` +
        "'buecher' zeigt die vollständige Verteilung."
    );
  }
  // Die Lexikonfelder sind der einzige Teil dieses Servers, der nicht deutsch
  // antwortet, und `kjv_woerter` ist darunter der einzige, der auch inhaltlich
  // nicht meint, was er zu meinen scheint: Die Liste sagt, wie die King James
  // das Wort wiedergibt, nicht was es heißt. „charity" für ἀγάπη liest sich
  // heute als Wohltätigkeit und färbte das Wort in einem deutschen Ablauf genau
  // falsch (gemessen 06.08.2026 an G26). Der Satz steht deshalb neben der Liste
  // und nicht in der Dokumentation.
  if (response.kjv_woerter !== undefined) {
    hinweise.push(
      "Die Lexikonfelder sind englisch. 'kjv_woerter' ist dabei keine Bedeutungsangabe, " +
        "sondern die Wiedergabe in der King James Version: eine Aussage über jene " +
        "Übersetzung, nicht über das Urtextwort, und teils in veraltetem Wortgebrauch."
    );
  }
  if (hinweise.length > 0) {
    response.hinweis = hinweise.join(" ");
  }
  response.quellen = quellen(
    meta0.quelle,
    usedStrongsLexicon ? DATASET_QUELLEN.lexikon_strongs : undefined,
    usedStepLexicon ? DATASET_QUELLEN.lexikon_step : undefined
  );

  return jsonResult(response);
}
