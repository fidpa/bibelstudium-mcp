/**
 * Das Werkzeug `bible_crossrefs`: die Querverweise zu einem Vers, nach den
 * Bewertungen von OpenBible.info geordnet, mit dem deutschen Zieltext, dazu die
 * Parallelstellen derselben Stelle nach der UBS Parallel Passage Database.
 *
 * Ein mehrversiges Ziel wird zweimal getragen, als zusammengesetztes `text` und
 * zusätzlich je Vers in `verse_einzeln`. Das ist kein Versehen: Die
 * zusammengesetzte Zeichenkette wurde beim Zitieren schon an beiden Enden
 * abgeschnitten, weil die eingeflochtenen Versnummern wie Fließtext aussehen.
 *
 * Die beiden Datensätze stehen nebeneinander und werden nicht vermischt.
 * `verweise` sind gerichtete, bewertete Einzelkanten; eine Parallelgruppe ist
 * eine ungeordnete Menge ohne Richtung und ohne Bewertung. Ein erfundener
 * `votes`-Wert wäre eine Aussage, die die UBS-Quelle nicht macht. Der Unterschied
 * ist auch praktisch: Zu Markus 2,12 nennen die zehn bestbewerteten Verweise
 * weder Lukas 5,25-26 noch Johannes 5,9, die Parallelgruppe nennt beide
 * (gemessen 22.08.2026).
 */

import {
  stmtKapitelLaengen,
  stmtParallelGroups,
  stmtParallelMembers,
  stmtVerse,
  stmtVerseRange,
  stmtWlcKapitelLaenge,
  stmtXrefs,
  stmtXrefsCount,
} from "../db.ts";
import { DATASET_QUELLEN, quellen, translationQuelle } from "../editions.ts";
import {
  gekuerztFeld,
  teilBudget,
  verseBudget,
  verseMaxHinweis,
  type VerseBudget,
} from "../verse-budget.ts";
import {
  MAX_CHAPTER,
  MAX_VERSE,
  bookNotFound,
  bracketHints,
  chapterOutOfRange,
  errorResult,
  getBookDisplayName,
  jsonResult,
  markerAbschnitt,
  markerBisVers,
  nennungHinweis,
  requireBookName,
  requireTranslation,
  resolveBook,
  stellenangabe,
  stripHtml,
  toInt,
  verseOutOfRange,
} from "../werkzeug-helfer.ts";

/** Obergrenze für `limit`. Ein größerer Wert wird darauf geklemmt; wie viele
 *  Verweise es wirklich gibt, sagt `gesamt`. */
const MAX_XREF_LIMIT = 30;

/**
 * Wie viele Verse der Wortlaut-Grenze die Parallelstellen höchstens verbrauchen
 * dürfen. Nur bei einer Ausgabe mit Grenze überhaupt wirksam.
 *
 * Die Parallelstellen werden vor den Verweisen bedient, weil sie sonst regelmäßig
 * leer ausgingen; damit sie den Verweisen nicht das Budget nehmen, diese Grenze.
 * Acht Verse decken 4763 der 4983 Verse mit Parallelstellen ab, also 95,6 %
 * (gemessen 22.08.2026). Der Rest sind formelhafte Wiederholungen: die
 * Wortereignisformel in Jeremia und Ezechiel (37 Verse Bedarf), der paulinische
 * Briefgruß (11). Dort wird gekürzt, und die Kürzung steht im Ergebnis.
 */
const MAX_PARALLEL_VERSE = 8;

/** Ein Mitglied einer Parallelgruppe, aus den Zeilen der Tabelle zusammengesetzt. */
interface ParallelMitglied {
  bookId: number;
  lang: string;
  locator: string;
  spans: Array<{ chapter: number; verse: number; verseEnd: number }>;
}

/**
 * Ob die Zählung dieses Kapitels zwischen dem hebräischen Grundtext und der
 * gelieferten Ausgabe auseinandergeht, oder null, wenn sich das hier nicht
 * feststellen lässt (kein AT-Buch, oder `original_words` ohne WLC).
 *
 * Der Unterschied zwischen `false` und `null` trägt: `false` heißt „geprüft und
 * gleich", `null` heißt „nicht geprüft". Als Feld geht allein `true` hinaus, und
 * der Vorbehalt im `hinweis` steht auch dann, wenn nichts geprüft werden konnte.
 */
function zaehlungWeichtAb(
  bookId: number,
  chapter: number,
  translation: string
): boolean | null {
  if (bookId > 39 || stmtWlcKapitelLaenge === null) return null;
  const hebr = stmtWlcKapitelLaenge.get(bookId, chapter)?.n ?? null;
  if (hebr === null) return null;
  const eigene = stmtKapitelLaengen
    .all(bookId, chapter)
    .find((l) => l.translation === translation)?.n;
  if (eigene === undefined) return null;
  return hebr !== eigene;
}

/** Die Stellenangabe eines Mitglieds. Mehrere Abschnitte werden mit Punkt
 *  verkettet, wie es die deutsche Zitierform tut ("2Kor 8,9.13-15"). */
function parallelStelle(mitglied: ParallelMitglied): string {
  const name = getBookDisplayName(mitglied.bookId);
  const teile = mitglied.spans.map((s) =>
    s.verse === s.verseEnd ? `${s.verse}` : `${s.verse}-${s.verseEnd}`
  );
  return `${name} ${mitglied.spans[0]!.chapter},${teile.join(".")}`;
}

/**
 * Die Parallelgruppen zu einem Vers, mit dem Wortlaut, den das Teilbudget
 * zulässt.
 *
 * Der abgefragte Vers selbst fällt aus seiner Gruppe heraus: Er steht schon in
 * `reference`, und als Mitglied gelesen sähe die Gruppe eine Stelle größer aus,
 * als sie an Neuem beiträgt.
 */
function sammleParallelen(
  bookId: number,
  chapter: number,
  verse: number,
  translation: string,
  budget: VerseBudget
): {
  gruppen: Array<Record<string, unknown>>;
  mitText: number;
  stellen: number;
  texte: string[];
  zaehlungBeruehrt: boolean;
} {
  const gruppen: Array<Record<string, unknown>> = [];
  const texte: string[] = [];
  let mitText = 0;
  let stellen = 0;
  let zaehlungBeruehrt = false;
  if (stmtParallelGroups === null || stmtParallelMembers === null) {
    return { gruppen, mitText, stellen, texte, zaehlungBeruehrt };
  }

  for (const g of stmtParallelGroups.all(bookId, chapter, verse, verse)) {
    // Die Zeilen einer Gruppe sind nach `member_seq` sortiert; ein Mitglied kann
    // zwei Abschnitte haben (die zehn Referenzen der Form "LUK 6:27-28,35").
    const mitglieder: ParallelMitglied[] = [];
    for (const r of stmtParallelMembers.all(g.group_id)) {
      const letztes = mitglieder[mitglieder.length - 1];
      if (r.span_seq > 0 && letztes !== undefined) {
        letztes.spans.push({ chapter: r.chapter, verse: r.verse, verseEnd: r.verse_end });
        continue;
      }
      mitglieder.push({
        bookId: r.book_id,
        lang: r.lang,
        locator: r.locator,
        spans: [{ chapter: r.chapter, verse: r.verse, verseEnd: r.verse_end }],
      });
    }

    const andere = mitglieder.filter(
      (m) =>
        !(
          m.bookId === bookId &&
          m.spans.some((s) => s.chapter === chapter && s.verse <= verse && verse <= s.verseEnd)
        )
    );
    if (andere.length === 0) continue;

    const stellenListe = andere.map((m) => {
      stellen++;
      if (m.bookId <= 39) zaehlungBeruehrt = true;
      const abweichend = zaehlungWeichtAb(m.bookId, m.spans[0]!.chapter, translation);

      // Erst holen, dann bewilligen, wie bei den Verweisen: Ein Mitglied, dessen
      // Verse diese Ausgabe gar nicht führt, soll kein Budget verbrauchen.
      const verse_ = m.spans.flatMap((sp) =>
        stmtVerseRange.all(translation, m.bookId, sp.chapter, sp.verse, sp.verseEnd)
      );
      const mehrfach = verse_.length > 1;
      let text: string | null = null;
      let einzeln: Array<{ nr: number; text: string }> | null = null;
      if (verse_.length > 0 && budget.nimmGanz(verse_.length)) {
        text = verse_
          .map((v) => (mehrfach ? `${v.verse} ${stripHtml(v.text)}` : stripHtml(v.text)))
          .join(" ");
        if (mehrfach) einzeln = verse_.map((v) => ({ nr: v.verse, text: stripHtml(v.text) }));
        texte.push(text);
        mitText++;
      }
      return {
        stelle: parallelStelle(m),
        locator: m.locator,
        sprache: m.lang === "HEB" ? "hebräisch" : "griechisch",
        ...(abweichend === true ? { zaehlung_abweichend: true } : {}),
        ...(text !== null ? { text } : {}),
        ...(einzeln !== null ? { verse_einzeln: einzeln } : {}),
      };
    });

    gruppen.push({ stellen: stellenListe });
  }
  return { gruppen, mitText, stellen, texte, zaehlungBeruehrt };
}

/**
 * Bedient das Werkzeug `bible_crossrefs`: liefert die Querverweise zu einem
 * Vers, nach den Bewertungen von OpenBible.info geordnet, mit dem deutschen
 * Zieltext, soweit die Wortlaut-Grenze der Ausgabe ihn zulässt.
 */
export function handleCrossrefs(args: {
  book?: unknown;
  chapter?: unknown;
  verse?: unknown;
  limit?: unknown;
  translation?: unknown;
}) {
  // Beide Datensätze sind eigene, voneinander unabhängige Setup-Schritte. Hängt
  // der Ausstieg allein an den Querverweisen, bekommt eine Instanz, die nur die
  // Parallelstellen geladen hat, eine Meldung über fehlende Daten, die sie hat.
  if (!stmtXrefs && !stmtParallelGroups) {
    return errorResult(
      "Weder Querverweis- noch Parallelstellen-Daten geladen. Bitte " +
        "'bun run download:crossrefs' und 'bun run download:parallels' ausführen."
    );
  }
  const resolved = requireTranslation(args.translation);
  if ("error" in resolved) {
    return errorResult(resolved.error);
  }
  const translation = resolved.code;

  const geprueft = requireBookName(
    args.book,
    "Error: 'book' is required (e.g. '1. Mose', 'Jesaja', 'Römer')."
  );
  if ("error" in geprueft) {
    return errorResult(geprueft.error);
  }
  const { book } = geprueft;

  const chapter = toInt(args.chapter);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    return errorResult(chapterOutOfRange);
  }
  const verse = toInt(args.verse);
  if (verse === null || verse < 1 || verse > MAX_VERSE) {
    return errorResult(verseOutOfRange);
  }
  const limit = Math.min(Math.max(toInt(args.limit) ?? 10, 1), MAX_XREF_LIMIT);
  const budget = verseBudget(translation);

  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }

  // Zuerst die Parallelstellen, dann die Verweise: `nimmGanz` sperrt nach der
  // ersten Ablehnung, und wer hier tauscht, liefert bei der Schlachter 2000 in
  // 6,2 % der Abrufe mit dem Vorgabelimit gar keinen Parallelstellen-Wortlaut
  // mehr (gemessen 22.08.2026). Das Teilbudget verhindert zugleich, dass die
  // Parallelstellen den Verweisen das Budget wegnehmen.
  const parallelBudget = teilBudget(budget, MAX_PARALLEL_VERSE);
  const parallel = sammleParallelen(bookId, chapter, verse, translation, parallelBudget);

  const rows = stmtXrefs ? stmtXrefs.all(bookId, chapter, verse, limit) : [];
  if (rows.length === 0 && parallel.gruppen.length === 0) {
    return errorResult(
      `Keine Querverweise für ${getBookDisplayName(bookId)} ${chapter},${verse} gefunden.`
    );
  }

  const verweise = rows.map((r) => {
    const bookName = getBookDisplayName(r.to_book);
    const sameChapter = r.to_chapter === r.to_chapter_end;
    const stelle = sameChapter
      ? r.to_verse === r.to_verse_end
        ? `${bookName} ${r.to_chapter},${r.to_verse}`
        : `${bookName} ${r.to_chapter},${r.to_verse}-${r.to_verse_end}`
      : `${bookName} ${r.to_chapter},${r.to_verse} – ${r.to_chapter_end},${r.to_verse_end}`;

    // Text: die volle Spanne innerhalb eines Kapitels (gedeckelt bei vier
    // Versen), sonst allein der erste Vers, denn Ziele über Kapitelgrenzen hinweg
    // sind selten und meist lang. Mehrversige Spannen gehen zusätzlich als
    // `verse_einzeln` hinaus: Die zusammengefügte Form flicht die Versnummern in
    // die Zeichenkette, überlässt das Zerlegen also den Konsumenten, und die
    // schneiden dabei die äußeren Ränder weg (beobachtet am 25.07.2026,
    // Joh 11,25-26 zitiert ohne „Jesus spricht zu ihr:" und ohne die
    // abschließende Frage).
    //
    // Die Wortlaut-Grenze wird hier je Verweis genommen, nicht je Vers
    // (`nimmGanz`), und beide Textfelder werden aus derselben bewilligten Liste
    // gebaut, damit ein Vers einmal zählt, obwohl er zweimal hinausgeht. Eine
    // Grenze auf Versebene schnitte in gemessen 3335 von 29 364 möglichen
    // Abrufen mitten in eine Spanne, und `stelle` nennte weiter den ganzen
    // Abschnitt. Seit dem 06.08.2026 bliebe das nicht mehr unbemerkt, denn
    // `abschnitt_gekuerzt` unten meldet jede Kürzung innerhalb eines Verweises;
    // gegen die Verweis-Grenze spricht seither allein, dass ein halb
    // gelieferter Verweis dem Konsumenten nichts nützt. Wer ein drittes
    // verstragendes Feld ergänzt, leitet es ebenfalls aus dieser Liste ab.
    // Verbraucht wird in `votes`-Reihenfolge (das Statement sortiert so): Die
    // bestbewerteten Verweise behalten ihren Text.
    let text: string | null = null;
    let einzeln: Array<{ nr: number; text: string }> | null = null;
    // Die Abschnittskürzung, sobald sie greift. Sie ist NICHT die
    // Wortlaut-Grenze: Diese hier schneidet innerhalb eines Verweises, jene
    // lässt ganze Verweise ohne Text. Deshalb ein eigener Feldname und eigene
    // Zahlen; die beiden nebeneinander als „gekuerzt" zu führen hat schon
    // einmal zu einer Verwechslung der Einheiten geführt (06.08.2026).
    let abschnittGekuerzt: { verse_gezeigt: number; verse_gesamt?: number } | null = null;
    if (sameChapter) {
      const span = r.to_verse_end - r.to_verse + 1;
      const CAP = 4;
      const verses = stmtVerseRange.all(
        translation, r.to_book, r.to_chapter, r.to_verse, Math.min(r.to_verse_end, r.to_verse + CAP - 1)
      );
      // Findet sich kein Vers, fehlt das Feld, statt leer dazustehen. Ein leerer
      // String war nie eine Aussage: Er sagte weder, dass es den Vers in dieser
      // Übersetzung nicht gibt, noch sonst etwas, und seit die Grenze dasselbe
      // Feld weglassen kann, stünden zwei Bedeutungen nebeneinander.
      if (verses.length > 0 && budget.nimmGanz(verses.length)) {
        text = verses
          .map((v) => (span > 1 ? `${v.verse} ${stripHtml(v.text)}` : stripHtml(v.text)))
          .join(" ");
        if (span > CAP) text += markerBisVers(r.to_verse_end);
        if (span > 1) einzeln = verses.map((v) => ({ nr: v.verse, text: stripHtml(v.text) }));
        // `verse_einzeln` trug den Rest nicht und sagte es nicht. Der
        // `lesehinweis` fordert zugleich, daraus vollständig zu zitieren: Wer
        // dem folgte, gab „Sprüche 8,22-30" aus und lieferte 22-25 (gemessen am
        // 06.08.2026, und schon beim Vorgabelimit erreichbar).
        if (span > CAP) {
          abschnittGekuerzt = { verse_gezeigt: verses.length, verse_gesamt: span };
        }
      }
    } else {
      // Erst holen, dann bewilligen: Umgekehrt verbrauchte ein Ziel ohne
      // gefundenen Vers Budget, das kein Wortlaut aufbraucht.
      const v = stmtVerse.get(translation, r.to_book, r.to_chapter, r.to_verse);
      if (v && budget.nimmGanz(1)) {
        text = `${stripHtml(v.text)}${markerAbschnitt(r.to_chapter_end, r.to_verse_end)}`;
        // Kapitelübergreifend gibt es nur den ersten Vers und gar kein
        // `verse_einzeln`, obwohl `stelle` mehrere Verse nennt. `verse_gesamt`
        // bleibt weg, weil die Länge über die Kapitelgrenze hinweg hier nicht
        // feststeht; wie weit das Ziel reicht, sagt `stelle`.
        abschnittGekuerzt = { verse_gezeigt: 1 };
      }
    }
    return {
      stelle,
      votes: r.votes,
      ...(text !== null ? { text } : {}),
      ...(einzeln !== null ? { verse_einzeln: einzeln } : {}),
      ...(abschnittGekuerzt !== null ? { abschnitt_gekuerzt: abschnittGekuerzt } : {}),
    };
  });

  // Nur der Text, der wirklich hinausgeht: Sonst warnte die Antwort vor
  // Klammern in Versen, die sie nicht geliefert hat.
  const texte = [
    ...parallel.texte,
    ...verweise.flatMap((v) => (typeof v.text === "string" ? [v.text] : [])),
  ];
  // Wie viele Verweise es überhaupt gibt. Zwei Kürzungen wirken hier
  // unabhängig voneinander und dürfen nicht verwechselt werden: `limit` schneidet
  // die Liste der Verweise, die Wortlaut-Grenze schneidet nur deren Text.
  // `gekuerzt` meint allein die zweite; für die erste steht `gesamt` da, und der
  // Satz unten nennt beide Zahlen. Ohne ihn sah eine auf 10 von 62 gekürzte
  // Antwort vollständig aus.
  const gesamt = stmtXrefsCount?.get(bookId, chapter, verse)?.n ?? verweise.length;
  const hinweise = [
    gesamt > verweise.length
      ? `Nur die ${verweise.length} bestbewerteten von ${gesamt} Verweisen gelistet` +
        (verweise.length < MAX_XREF_LIMIT
          ? " (limit erhöhen)."
          : `; mehr als ${MAX_XREF_LIMIT} gibt dieses Werkzeug je Abruf nicht aus.`)
      : null,
    verseMaxHinweis(budget, {
      art: "verweise",
      mitText: texte.length - parallel.mitText,
      gesamt: verweise.length,
      ...(parallel.stellen > 0
        ? { parallelenMitText: parallel.mitText, parallelenGesamt: parallel.stellen }
        : {}),
    }),
    // Der Vorbehalt steht auch dann, wenn kein einziges Mitglied
    // `zaehlung_abweichend` trägt: Die Flagge setzt voraus, dass der hebräische
    // Grundtext geladen ist, und ihre Abwesenheit ist keine Entwarnung.
    parallel.zaehlungBeruehrt
      ? "Die Parallelstellen im Alten Testament sind nach der Zählung der " +
        "hebräischen Bibel angegeben, diese Ausgabe zählt anders. Die " +
        "aufgelöste Stellenangabe kann deshalb um Verse verschoben sein; " +
        "maßgeblich ist 'locator', die Referenz im Wortlaut der Quelle."
      : null,
    nennungHinweis(translation),
    ...bracketHints(texte),
  ].filter((h): h is string => h !== null);
  const response = {
    ...stellenangabe(bookId, chapter, verse),
    gesamt,
    verweise,
    ...(parallel.gruppen.length > 0
      ? { parallelen: { gruppen: parallel.gruppen, stellen: parallel.stellen } }
      : {}),
    ...(verweise.some((v) => "verse_einzeln" in v) ||
    parallel.gruppen.some((g) =>
      (g.stellen as Array<Record<string, unknown>>).some((st) => "verse_einzeln" in st)
    )
      ? {
          lesehinweis:
            "Mehrversige Verweise und Parallelstellen tragen zusätzlich 'verse_einzeln' " +
            "(ein Eintrag je Vers, ohne eingebettete Versnummern). Beim Zitieren daraus " +
            "die Verse vollständig übernehmen, nicht Anfang oder Ende des Abschnitts " +
            "weglassen. Wo 'abschnitt_gekuerzt' steht, reicht der Abschnitt weiter als " +
            "die gelieferten Verse: Dann gilt die Stellenangabe des Zitats nur den " +
            "vorhandenen Versen, nicht der ganzen Spanne aus 'stelle'. Bei einer " +
            "Parallelstelle mit zwei durch Punkt getrennten Abschnitten liegen zwischen " +
            "ihnen Verse, die nicht zur Stelle gehören und in 'verse_einzeln' fehlen.",
        }
      : {}),
    ...(hinweise.length > 0 ? { hinweis: hinweise.join(" ") } : {}),
    ...gekuerztFeld(budget, { parallelen: parallelBudget }),
    quellen: quellen(
      rows.length > 0 ? DATASET_QUELLEN.crossrefs : undefined,
      parallel.gruppen.length > 0 ? DATASET_QUELLEN.parallelen : undefined,
      translationQuelle(translation)
    ),
  };

  return jsonResult(response);
}
