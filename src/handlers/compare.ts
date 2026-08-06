/**
 * Das Werkzeug `bible_compare`: vergleicht einen NT-Vers Wort für Wort über die
 * griechischen Editionen, paarweise und normalisiert, gemeldet werden die
 * ursprünglichen Wortformen.
 *
 * Ein Vorbehalt gehört nach oben, nicht in eine Verschachtelung: Widerspricht
 * die Bezeugungsnotiz dem Text der Edition, wiederholt die Antwort das als
 * `warnung` und `quellenkonflikte` vor den Daten, die es einschränkt. Tief
 * verschachtelt hieße ungelesen, und in rund jedem zehnten NT-Vers gehen Notiz
 * und Editionstext auseinander. Für die Frage, was in dieser Edition steht,
 * gilt der Editionstext, nicht die Notiz.
 */

import { availableEditions, stmtOriginal, stmtTagnt } from "../db.ts";
import {
  DATASET_QUELLEN,
  EDITION_META,
  NT_EDITION_ORDER,
  quellen,
} from "../editions.ts";
import { crossCheckVariant, diffSegments } from "../greek-diff.ts";
import {
  MAX_CHAPTER,
  MAX_VERSE,
  bookNotFound,
  chapterOutOfRange,
  errorResult,
  getBookDisplayName,
  jsonResult,
  requireBookName,
  resolveBook,
  toInt,
  verseOutOfRange,
} from "../werkzeug-helfer.ts";

/**
 * Bedient das Werkzeug `bible_compare`: vergleicht einen NT-Vers Wort für Wort
 * über die griechischen Editionen (paarweise, normalisiert verglichen, gemeldet
 * werden die ursprünglichen Wortformen).
 */
export function handleCompare(args: { book?: unknown; chapter?: unknown; verse?: unknown }) {
  if (!stmtOriginal || availableEditions.size === 0) {
    return errorResult(
      "Urtext-Daten nicht geladen. Bitte zuerst 'bun run download:byz' ausführen."
    );
  }

  const geprueft = requireBookName(args.book, "Error: 'book' is required (e.g. 'Römer', '1Joh').");
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
  const bookId = resolveBook(book);
  if (bookId === null) {
    return bookNotFound(book);
  }
  if (bookId < 40) {
    return errorResult(
      "Der Editionsvergleich gilt nur fürs NT; fürs AT gibt es nur eine Edition (hebräischer WLC)."
    );
  }

  const editions = NT_EDITION_ORDER.filter((e) => availableEditions.has(e));
  if (editions.length < 2) {
    return errorResult(
      `Mindestens zwei NT-Editionen nötig; geladen: ${editions.join(", ") || "keine"}. ` +
        "Bitte die Download-Skripte (download-byz.ts, download-tr.ts, download-morph.ts) ausführen."
    );
  }

  const texts = editions.map((ed) => ({
    ed,
    words: stmtOriginal!.all(ed, bookId, chapter, verse).map((r) => r.surface),
  }));
  if (texts.every((t) => t.words.length === 0)) {
    return errorResult(
      `Keine Urtext-Daten für ${getBookDisplayName(bookId)} ${chapter},${verse}.`
    );
  }

  const vergleiche = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const A = texts[i]!;
      const B = texts[j]!;
      const paar = `${A.ed} ↔ ${B.ed}`;
      if (A.words.length === 0 || B.words.length === 0) {
        const fehlt = A.words.length === 0 ? A.ed : B.ed;
        vergleiche.push({ paar, ergebnis: `Vers fehlt in Edition "${fehlt}"` });
        continue;
      }
      const segs = diffSegments(A.words, B.words);
      if (segs.length === 0) {
        vergleiche.push({ paar, ergebnis: "identisch (nach Normalisierung)" });
      } else {
        // Die Wortzahl einer abweichenden Folge steht da, statt abgezählt zu
        // werden: Das Comma Johanneum wurde als „16 zusätzliche Wörter"
        // gemeldet, wo Editionsvergleich und TAGNT-Bezeugung beide 17 sagen
        // (25.07.2026). Nur ab zwei Wörtern, denn „(1 Wort)" an jeder
        // Einzelwortabweichung ist Rauschen, das die wichtigen Fälle begräbt.
        const laenge = (s: string) => {
          const n = s === "" ? 0 : s.split(" ").length;
          return n > 1 ? ` (${n} Wörter)` : "";
        };
        vergleiche.push({
          paar,
          unterschiede: segs.map((s) =>
            s.a && s.b
              ? `${A.ed}: "${s.a}"${laenge(s.a)} ↔ ${B.ed}: "${s.b}"${laenge(s.b)}`
              : s.a
                ? `nur in ${A.ed}: "${s.a}"${laenge(s.a)}`
                : `nur in ${B.ed}: "${s.b}"${laenge(s.b)}`
          ),
        });
      }
    }
  }

  // Die Bezeugung je Wort über acht Editionen (STEPBible TAGNT). Wörter, die alle
  // acht Editionen bezeugen, werden nur gezählt; aufgelistet sind die, deren
  // Zeugenmenge abweicht, denn dort sitzt das textkritische Signal.
  let bezeugung: Record<string, unknown> | undefined;
  // Warum die Bezeugung fehlt, wenn sie fehlt. Ein weggelassenes Feld ist keine
  // Aussage, und hier wurde es als eine gelesen: Zu Johannes 7,53 fehlte
  // `bezeugung` ersatzlos, während der `hinweis` weiter darauf verwies, und ein
  // fremder Client stand vor der Wahl, das als „nicht bezeugt" zu deuten
  // (gemessen 06.08.2026). Nicht bezeugt heißt es gerade nicht: byzantine und tr
  // führen den Vers mit je sieben Wörtern, allein SBLGNT lässt ihn aus. Neun
  // NT-Verse haben keine TAGNT-Zeile. Der Fall, dass die Tabelle ganz fehlt,
  // bleibt draußen: Den beantwortet bible_server_info für die ganze Instanz,
  // nicht jeder einzelne Vers aufs Neue.
  let bezeugungFehlt: string | undefined;
  // Ob überhaupt eine Variantennotiz in dieser Antwort steht. Der Hinweis unten
  // verwies bis 0.6.12 unbedingt auf 'schreibvariante' und 'bedeutungsvariante'
  // und verbot im selben Satz, die Art der Variante zu erschließen. Beides
  // zusammen ist eine Sackgasse, wo die Felder fehlen, und sie fehlen bei der
  // Mehrheit: Von 13 950 aufgeführten Wörtern tragen 6194 eine solche Notiz,
  // also 44,4 % (gemessen 06.08.2026 gegen tagnt_words).
  let hatVariantennotiz = false;
  const quellenkonflikte: string[] = [];
  if (stmtTagnt) {
    const rows = stmtTagnt.all(bookId, chapter, verse);
    if (rows.length === 0) {
      bezeugungFehlt =
        "Für diesen Vers führt die TAGNT-Bezeugung keine Zeile, das Feld 'bezeugung' " +
        "fehlt deshalb hier. Das ist eine Lücke der Quelle und keine Aussage über den " +
        "Vers: Was die geladenen Editionen lesen, steht in 'editionen'.";
    }
    if (rows.length > 0) {
      const FULL = "NA28+NA27+Tyn+SBL+WH+Treg+TR+Byz";
      const abweichend = rows.filter(
        (r) => r.editions !== FULL || r.meaning_variant !== "" || r.spelling_variant !== ""
      );
      const eintraege = abweichend.map((r) => {
        const notiz = [r.meaning_variant, r.spelling_variant].filter((s) => s !== "").join(" ; ");
        if (notiz !== "") hatVariantennotiz = true;
        const check = notiz !== "" ? crossCheckVariant(notiz, r.surface, texts) : undefined;
        if (check !== undefined) {
          for (const w of check.abgleich) quellenkonflikte.push(`${r.surface}: ${w}`);
        }
        return {
          wort: r.surface,
          typ: r.word_type,
          editionen: r.editions,
          ...(r.meaning_variant !== "" ? { bedeutungsvariante: r.meaning_variant } : {}),
          ...(r.spelling_variant !== "" ? { schreibvariante: r.spelling_variant } : {}),
          ...(check !== undefined ? { in_dieser_db: check.belege } : {}),
          ...(check !== undefined && check.abgleich.length > 0
            ? { abgleich: check.abgleich }
            : {}),
        };
      });
      bezeugung = {
        quelle:
          "STEPBible TAGNT (CC BY 4.0); Zeugen des Apparats, nicht die oben verglichenen " +
          "Editionen: NA28, NA27, Tyn(dale House), SBL, WH (Westcott-Hort), Treg(elles), TR, " +
          "Byz. Insbesondere ist 'Byz' hier eine Apparatspalte und nicht der oben verglichene " +
          "Text 'byzantine' (Robinson-Pierpont 2005); beide gehen in 10,8 % der NT-Verse " +
          "auseinander. typ: N=Nestle-Aland, K=KJV/TR-Tradition, O=andere; Kleinbuchstabe = " +
          "ohne Übersetzungsrelevanz; »n/«n = Wortstellung verschoben.",
        woerter_gesamt: rows.length,
        von_allen_acht_bezeugt: rows.length - abweichend.length,
        ...(eintraege.some((e) => "in_dieser_db" in e)
          ? {
              lesehinweis:
                "Die TAGNT-Notizen (bedeutungsvariante/schreibvariante) nennen nur die Zeugen " +
                "des eigenen Apparats; daraus folgt NICHT, dass alle übrigen Editionen die " +
                "Kopfform lesen. 'in_dieser_db' zeigt pro Form, welche der hier geladenen " +
                "Editionen sie tatsächlich lesen (aus original_words). Für die Frage 'was steht " +
                "in dieser Edition' gilt 'in_dieser_db', nicht die TAGNT-Notiz; 'abgleich' nennt " +
                "die Stellen, an denen beide auseinandergehen.",
            }
          : {}),
        abweichend: eintraege,
      };
    }
  }

  // Quellenkonflikte liegen vier Ebenen tief in bezeugung.abweichend[].abgleich,
  // und Konsumenten, die den Bezeugungsblock als optionales Detail behandeln,
  // erreichen sie nie: Mk 14,46 wurde ohne den Vorbehalt gemeldet (25.07.2026).
  // Deshalb oben in der Antwort wiederholt, vor den Daten, die sie einschränken.
  const response = {
    reference: `${getBookDisplayName(bookId)} ${chapter},${verse}`,
    sprache: "Griechisch (Koine)",
    ...(quellenkonflikte.length > 0
      ? {
          warnung:
            "An dieser Stelle widerspricht die TAGNT-Bezeugung dem Editionstext. " +
            "'quellenkonflikte' nennt für jede betroffene Form, was die Edition " +
            "tatsächlich liest; das gehört zur Antwort über diesen Vers, nicht in " +
            "eine Fußnote. Maßgeblich ist der Editionstext, nicht die TAGNT-Notiz.",
          quellenkonflikte,
        }
      : {}),
    editionen: texts.map((t) => ({
      texttyp: t.ed,
      edition: EDITION_META[t.ed]!.label,
      woerter: t.words.length,
      text: t.words.join(" ") || "— (Vers in dieser Edition nicht vorhanden)",
    })),
    vergleiche,
    ...(bezeugung !== undefined ? { bezeugung } : {}),
    ...(bezeugungFehlt !== undefined ? { bezeugung_fehlt: bezeugungFehlt } : {}),
    // Hier kein Beispiel für eine Variantenart: Das frühere „(z. B. bewegliches
    // Ny)" wurde als Etikett aufgegriffen und auf einen Fall gesetzt, der nichts
    // damit zu tun hat. ἐπέβαλον / ἐπέβαλαν in Mk 14,46 hieß dann bewegliches Ny,
    // obwohl es um thematische gegen Alpha-Aoristendung geht (25.07.2026). Auf
    // die klassifizierenden Felder zeigen, statt einen Fachbegriff einzustreuen.
    hinweis: [
      "Vergleich ignoriert Akzente, Groß-/Kleinschreibung und Schlusssigma (byzantine/tr sind " +
        "unakzentuiert gespeichert). Verbleibende Unterschiede sind echte Textvarianten oder " +
        "Schreibvarianten.",
      // Auf die klassifizierenden Felder zeigen, aber nur, wenn diese Antwort sie
      // führt. Sonst steht hier, dass die Art ungeklärt bleibt, und das Verbot
      // gilt weiter: Es ist der Grund für den ganzen Satz.
      hatVariantennotiz
        ? "Welche Art vorliegt, steht in 'bezeugung' ('schreibvariante' bzw. " +
          "'bedeutungsvariante', dazu 'typ'). Nicht aus diesem Hinweis erschließen und die " +
          "sprachliche Erscheinung nicht benennen, wenn sie dort nicht steht."
        : "Welche Art vorliegt, sagt diese Antwort nicht: " +
          (bezeugung !== undefined
            ? "Zu den aufgeführten Formen führt die Quelle keine Notiz. "
            : "Zu diesem Vers liegt keine Bezeugung vor, siehe 'bezeugung_fehlt'. ") +
          "Die sprachliche Erscheinung deshalb nicht benennen, auch nicht aus diesem " +
          "Hinweis erschlossen.",
      "Wortzahlen stehen im Ergebnis: je Edition in 'woerter', je Unterschied in Klammern " +
        "hinter der Lesart; diese Zahlen übernehmen, nicht selbst nachzählen.",
    ].join(" "),
    // Aus `editions`, nicht aus einer festen Dreierliste: die Auswahl ist nach
    // dem tatsächlich geladenen Bestand gefiltert und kann zwei Editionen
    // umfassen. TAGNT nur, wenn eine Bezeugung in der Antwort steht.
    quellen: quellen(
      ...editions.map((ed) => EDITION_META[ed]!.quelle),
      bezeugung !== undefined ? DATASET_QUELLEN.tagnt : undefined
    ),
  };

  return jsonResult(response);
}
