/**
 * Der Wortvergleich zweier Grundtext-Editionen und der Abgleich mit der
 * Bezeugungsnotiz.
 *
 * Zustandsfrei: String und Wortlisten gehen hinein, Segmente und Belege kommen
 * heraus. Keine Datenbank, kein Protokollbezug. `crossCheckVariant` steht
 * ebenfalls hier, obwohl es nach einer Datenabfrage aussieht: Es bekommt die
 * Editionstexte als Parameter und liest selbst nichts.
 *
 * Das Vergleichen braucht eine Normalform, weil die Editionen verschieden
 * überliefert sind: Zwei liegen unakzentuiert vor, eine akzentuiert. Verglichen
 * werden deshalb normalisierte Formen, gemeldet die ursprünglichen.
 */

/**
 * Normalisiert eine griechische Wortform für den Editionsvergleich: diakritische
 * Zeichen entfernen, kleinschreiben, das Schlusssigma falten. byzantine und tr
 * liegen unakzentuiert vor, sblgnt akzentuiert; ohne das wiche jedes Wortpaar
 * voneinander ab.
 *
 * Die Sigma-Faltung ist Vorsorge und kein laufendes Geschäft, und dafür gibt es
 * keinen Testfall: Sie greift nur, wo zwei Editionen dieselbe Form schreiben,
 * die eine mit Schlusssigma, die andere mit medialem. Gemessen am 05.08.2026
 * über alle Verse des Neuen Testaments gibt es **kein einziges** solches
 * Wortpaar, obwohl jede der drei griechischen Editionen rund 27 000 Wörter mit
 * Schlusssigma führt. Ein Testfall ließe sich also nur mit erfundenen Daten
 * herstellen, und die prüfen hier nichts. Stehen bleibt die Zeile, weil die
 * TR-Quelle transliteriert vorliegt (Beta-Code, „v" Schlusssigma gegen „s"
 * medial) und beim Aufbau umgesetzt wird: Ein Neuaufbau kann den Fall
 * herstellen, ohne dass jemand diese Datei anfasst.
 */
function normForCompare(w: string): string {
  return w
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ");
}

/**
 * Wortvergleich zweier Editionen eines Verses über die längste gemeinsame
 * Teilfolge. Verglichen werden normalisierte Formen, gemeldet die
 * ursprünglichen Wortformen. Jedes Segment hält die abweichende Wortfolge
 * beider Seiten ("" heißt: auf dieser Seite nicht vorhanden).
 */
export function diffSegments(aWords: string[], bWords: string[]): Array<{ a: string; b: string }> {
  const an = aWords.map(normForCompare);
  const bn = bWords.map(normForCompare);
  const m = an.length;
  const n = bn.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = an[i] === bn[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const segs: Array<{ a: string[]; b: string[] }> = [];
  let cur: { a: string[]; b: string[] } | null = null;
  const flush = (): void => {
    if (cur) { segs.push(cur); cur = null; }
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (an[i] === bn[j]) {
      flush();
      i++; j++;
    } else {
      cur ??= { a: [], b: [] };
      if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { cur.a.push(aWords[i]!); i++; }
      else { cur.b.push(bWords[j]!); j++; }
    }
  }
  if (i < m || j < n) {
    cur ??= { a: [], b: [] };
    while (i < m) cur.a.push(aWords[i++]!);
    while (j < n) cur.b.push(bWords[j++]!);
  }
  flush();
  return segs.map((s) => ({ a: s.a.join(" "), b: s.b.join(" ") }));
}

/** Das TAGNT-Zeugenkürzel je hier geladener Edition; für die übrigen sechs liegt kein Text vor. */
const TAGNT_LABEL: Record<string, string> = {
  byzantine: "Byz",
  tr: "TR",
  sblgnt: "SBL",
};

const TAGNT_WITNESS_RE = /\b(?:NA28|NA27|Tyn|SBL|WH|Treg|TR|Byz)\b/g;
// Mit den kombinierenden Zeichen: STEPBible schreibt das Iota subscriptum
// teils zerlegt (U+0345, Script=Inherited), und „ὑπῇρχεν" brach als Lauf
// sonst nach „ὑπῆ" ab (Apg 4,34; gemessen 02.09.2026).
const GREEK_RUN_RE = /[\p{Script=Greek}\p{M}]+/gu;

/**
 * Nur griechische Buchstaben. Der Bereich Script=Greek führt auch Zeichen, die
 * keine Buchstaben sind: Die Koronis ᾽ (U+1FBD) markiert die Elision („ἀλλ᾽")
 * und reiste sonst in die verglichene Form mit, sodass „ἀλλ᾽" nie zum
 * abgelegten „αλλ" passte.
 */
function greekLettersOnly(s: string): string {
  return (s.match(GREEK_RUN_RE) ?? []).join("").replace(/[^\p{L}]/gu, "");
}

/**
 * Wahr, wenn sich zwei normalisierte Formen allein durch einen elidierten
 * Schlussvokal unterscheiden („αλλ" ↔ „αλλα"; „αφ" ↔ „απο" ist NICHT dieser
 * Fall). Die Editionen elidieren nach verschiedenen Konventionen, ein solches
 * Paar ist also eine Schreibvariante und keine Textvariante: in `in_dieser_db`
 * zu zeigen, aber keine Warnung wert.
 */
function istElision(a: string, b: string): boolean {
  const [kurz, lang] = a.length <= b.length ? [a, b] : [b, a];
  return lang.length === kurz.length + 1 && lang.startsWith(kurz) && /[αεηιουω]$/.test(lang);
}

/**
 * Wahr, wenn sich zwei Normalformen nur um ein bewegliches ν (nach ε oder ι:
 * „ηνοιξεν" gegen „ἤνοιξε", „εἰσιν" gegen „εἰσὶ"), ein bewegliches ς (nach ω
 * oder ι: „ἄχρι" gegen „ἄχρις", „οὕτω" gegen „οὕτως") oder um ι gegen ει
 * („ὀφθαλμοδουλίαις" gegen „ὀφθαλμοδουλείαις") unterscheiden. Auf eine solche
 * Schreibung wird kein Widerspruch gestützt: Bis zum 02.09.2026 hießen 14 der
 * 57 Widerspruchssätze „liest an dieser Stelle ηνοιξεν, weder … noch ἤνοιξε"
 * und nannten die Notiz falsch, wo sie recht hatte. Die Bedingung an den
 * vorletzten Buchstaben hält echte Unterschiede heraus: „τὸ" gegen „τὸν",
 * „βασιλεῦ" gegen „βασιλεὺς", „πάντα" gegen „πάντας" (dieselbe Messung). Ein
 * positiver Satz („liest hier X") bleibt davon unberührt; er ist bei einer
 * Schreibvariante wahr und nützlich.
 */
function istSchreibvariante(a: string, b: string): boolean {
  if (a === b) return false;
  const [kurz, lang] = a.length <= b.length ? [a, b] : [b, a];
  if (kurz.length > 0 && lang.length === kurz.length + 1 && lang.startsWith(kurz)) {
    if (lang.endsWith("ν") && /[ει]$/.test(kurz)) return true;
    if (lang.endsWith("σ") && /[ωι]$/.test(kurz)) return true;
  }
  return a.replace(/ει/g, "ι") === b.replace(/ει/g, "ι");
}

/** Die Nachbarwörter der TAGNT-Zeile, links und rechts des Kopfworts; am Versrand fehlt eines. */
export interface Umfeld {
  readonly vorher?: string;
  readonly nachher?: string;
}

/** Was eine Edition an der Stelle der Notiz führt, sofern die Stelle bestimmbar ist. */
type Stelle =
  | { readonly art: "wort"; readonly wort: string }
  | { readonly art: "luecke"; readonly bei: number }
  | { readonly art: "unbestimmt" };

/**
 * Sucht die Stelle des Kopfworts in einer Edition über die beiden Nachbarn
 * der TAGNT-Zeile: genau ein Wort, dessen linker Nachbar `vorher` und dessen
 * rechter `nachher` ist (am Versrand: das erste beziehungsweise letzte Wort).
 * Stehen die beiden Nachbarn direkt nebeneinander, lässt die Edition das Wort
 * an dieser Stelle aus. Alles andere (kein Treffer, zwei Treffer, keine
 * Nachbarn) ist unbestimmt, etwa bei vertauschter Wortstellung oder wenn die
 * Edition den Vers anders teilt.
 */
function stelleIn(words: readonly string[], original: readonly string[], vorher: string, nachher: string): Stelle {
  if (vorher === "" && nachher === "") return { art: "unbestimmt" };
  const letzte = words.length - 1;
  const passt = (p: number): boolean =>
    (vorher === "" ? p === 0 : words[p - 1] === vorher) &&
    (nachher === "" ? p === letzte : words[p + 1] === nachher);
  const treffer: number[] = [];
  for (let p = 0; p < words.length; p++) if (passt(p)) treffer.push(p);
  if (treffer.length === 1) return { art: "wort", wort: original[treffer[0]!]! };
  if (treffer.length === 0) {
    // `bei` ist der Index, an dem das Wort stünde: der des rechten Nachbarn.
    if (vorher === "" && words[0] === nachher) return { art: "luecke", bei: 0 };
    if (nachher === "" && words[letzte] === vorher) return { art: "luecke", bei: words.length };
    const q = words.findIndex((w, i) => w === vorher && words[i + 1] === nachher);
    if (vorher !== "" && nachher !== "" && q >= 0) return { art: "luecke", bei: q + 1 };
  }
  return { art: "unbestimmt" };
}

/**
 * Gleicht eine TAGNT-Variantennotiz gegen die Editionstexte dieser Datenbank ab.
 *
 * TAGNT-Notizen nennen allein die Zeugen, die der eigene Apparat für eine
 * Variante führt. Bei 1Tim 3,16 ist das „TR: ἀνελήφθη ;", was sich liest, als
 * trüge jede andere Edition, Byz eingeschlossen, das Stichwort ἀνελήμφθη. Der
 * hier abgelegte Robinson-Pierpont-Text liest ebenfalls ἀνελήφθη; die Notiz
 * allein führt also zum falschen Schluss über den Mehrheitstext (gemessen am
 * 24.07.2026: über 362 zufällige NT-Verse gehen Notiz und Editionstext in
 * 11 Prozent auseinander). Gemeldet wird deshalb, welche geladene Edition
 * welche Form tatsächlich bezeugt, unmittelbar aus `original_words`, und die
 * Widersprüche werden gekennzeichnet.
 *
 * Geurteilt wird an der Stelle der Notiz, wo die Stelle über die Nachbarwörter
 * (`umfeld`) bestimmbar ist. Ohne Stelle gilt die Frage „steht die Form
 * irgendwo im Vers", und dann schweigt der Abgleich, sobald eine Edition mehr
 * als eine Form der Notiz führt. Bis zum 02.09.2026 gab es nur diese zweite
 * Frage: Sie erzeugte Sätze wie „sblgnt liest hier ὃς" (Mt 5,32, das ὃς steht
 * 13 Wörter weiter), und die Mehrformen-Regel, die das abstellte, verschluckte
 * acht richtige Sätze, in denen die Edition die Lesart an der Stelle und die
 * Kopfform anderswo führt (Mt 28,3 „λευκον ωσει χιων", Röm 1,27 „οι αρρενες").
 */
export function crossCheckVariant(
  note: string,
  headword: string,
  texts: Array<{ ed: string; words: string[] }>,
  umfeld: Umfeld = {}
): { belege: Record<string, string[]>; abgleich: string[] } | undefined {
  const head = greekLettersOnly(headword);
  if (head === "") return undefined;
  const headNorm = normForCompare(head);
  const buchstaben = (w: string): string => normForCompare(greekLettersOnly(w));

  // ";" trennt die Notizen eines Wortes, "¦" trennt die Lesarten innerhalb
  // einer Notiz („ἐπὶ … in: TR ¦ εἰς … in: SBL+Byz", Mt 18,6). 65 Notizen
  // tragen "¦" (gemessen 02.09.2026); bis dahin wurde nur an ";" getrennt, und
  // eine solche Notiz wurde ein Segment mit allen Zeugen und der ersten Form.
  // Zwei Schreibungen derselben Form (Apg 15,4: „SBL+Treg: Ἱεροσόλυμα ; WH:
  // Ἰεροσόλυμα") sind eine Lesart mit vereinten Zeugen, sonst zählte sie
  // doppelt. Eine Mehrwortlesart („καὶ ἐγὼ") geht mit ihrem ersten Wort ein.
  const varianten = new Map<string, { form: string; zeugen: Set<string> }>();
  for (const seg of note.split(/[;¦]/)) {
    const form = (seg.match(GREEK_RUN_RE) ?? [])
      .map((f) => f.replace(/[^\p{L}]/gu, ""))
      .find((f) => f.length > 1);
    if (form === undefined) continue;
    const n = normForCompare(form);
    if (n === headNorm) continue;
    const eintrag = varianten.get(n) ?? { form, zeugen: new Set<string>() };
    for (const z of seg.match(TAGNT_WITNESS_RE) ?? []) eintrag.zeugen.add(z);
    varianten.set(n, eintrag);
  }

  // Editionswörter als reine Buchstaben: SBLGNT schreibt die Elision mit „’"
  // (1221 Wörter, gemessen 02.09.2026), und „ἐπ’" passte bis dahin nie auf den
  // Kopf „ἐπ᾽", sodass die Edition als Leserin allein der Lesart galt.
  const normTexts = texts.map((t) => ({ ed: t.ed, words: t.words.map(buchstaben), original: t.words }));
  const liest = (n: string): string[] => normTexts.filter((t) => t.words.includes(n)).map((t) => t.ed);

  const belege: Record<string, string[]> = {};
  for (const [n, form] of [[headNorm, head] as const, ...[...varianten].map(([n, v]) => [n, v.form] as const)]) {
    const eds = liest(n);
    if (eds.length > 0) belege[form] = eds;
  }
  if (Object.keys(belege).length === 0) return undefined;

  // Ohne Stelle: Wie viele Formen dieser Notiz (Kopf und alle Lesarten) eine
  // Edition irgendwo im Vers führt. Mehr als eine, und der Vers gibt nicht her,
  // welche an der Stelle der Notiz steht (TR bei Mt 18,6 liest die Lesart „ἐπὶ"
  // und daneben „εις εμε"); dann fällt kein Satz.
  const formenJeEdition = new Map<string, number>();
  for (const n of [headNorm, ...varianten.keys()]) {
    for (const ed of liest(n)) formenJeEdition.set(ed, (formenJeEdition.get(ed) ?? 0) + 1);
  }
  const vorher = umfeld.vorher === undefined ? "" : buchstaben(umfeld.vorher);
  const nachher = umfeld.nachher === undefined ? "" : buchstaben(umfeld.nachher);

  const abgleich: string[] = [];
  const schluss = " Für diese Edition gilt der Editionstext.";
  for (const [n, v] of varianten) {
    if (istElision(n, headNorm)) continue;
    // Kopf und Lesart nur verschieden geschrieben: kein Satz gegen die Notiz.
    const nurSchreibung = istSchreibvariante(n, headNorm);
    for (const t of normTexts) {
      const label = TAGNT_LABEL[t.ed];
      if (label === undefined) continue;
      const genannt = v.zeugen.has(label);
      const zeugen = [...v.zeugen].join("+") || "keine Edition";
      // Zuerst nennen, was die Edition liest, dann die Notiz, der sie
      // widerspricht. Umgekehrt formuliert („TAGNT nennt … der Text liest
      // anders") liest es sich wie eine Randbemerkung zur Datenqualität und
      // entfällt beim Wiedergeben des Befundes; Mk 14,46 wurde zweimal ohne den
      // Vorbehalt gemeldet (25.07.2026).
      const nurZeugen = `${t.ed} liest hier "${v.form}"; die TAGNT-Notiz führt dafür nur ${zeugen} als Zeugen.${schluss}`;
      const widerspruch = (was: string): string =>
        `${t.ed} ${was}; die TAGNT-Notiz nennt ${label} jedoch als Zeugen für "${v.form}".${schluss}`;
      const liestVariante = liest(n).includes(t.ed);
      const stelle = stelleIn(t.words, t.original, vorher, nachher);
      if (stelle.art !== "unbestimmt") {
        const dort = stelle.art === "wort" ? buchstaben(stelle.wort) : "";
        if (dort === n) {
          if (!genannt) abgleich.push(nurZeugen);
          continue;
        }
        // Die Edition schreibt die Lesart nur anders (Apg 5,19 „ηνοιξεν" gegen
        // „ἤνοιξε"): weder Beleg noch Widerspruch. Der Kopf wird zuerst geprüft,
        // sonst gälte „ἐστιν" als Beleg für die Lesart „ἐστι" (gemessen
        // 02.09.2026: 1310 falsche Belege).
        if (dort !== "" && dort !== headNorm && istSchreibvariante(dort, n)) continue;
        // Lücke, und die Lesart steht höchstens zwei Wörter daneben: Die Edition
        // liest sie in anderer Wortstellung (Mk 1,13 Byz „ημερας τεσσαρακοντα"
        // gegen „τεσσεράκοντα ἡμέρας"). Weiter weg ist es ein anderes Vorkommen
        // (Mt 8,5 TR „προσηλθεν αυτω", vier Wörter hinter der Lücke).
        if (stelle.art === "luecke" && !genannt && t.words.slice(Math.max(0, stelle.bei - 2), stelle.bei + 2).includes(n)) {
          abgleich.push(
            `${t.ed} liest hier "${v.form}" in anderer Wortstellung; die TAGNT-Notiz führt dafür nur ${zeugen} als Zeugen.${schluss}`
          );
          continue;
        }
        // Ein negatives Urteil nur, wenn die Lesart nirgends im Vers steht: Bei
        // vertauschter Wortstellung (Mt 5,30 Byz „βληθη εις γεενναν" gegen
        // „εἰς γέενναν ἀπέλθῃ") ist die Stelle bestimmt und die Lesart trotzdem
        // da, nur woanders. Ein echter Widerspruch mit derselben Form an zwei
        // Stellen (Mt 28,3 „ὡς ἀστραπὴ") bleibt so unerkannt; das ist der
        // Preis, und er ist kleiner als ein falsches „führt kein Wort".
        if (genannt && !liestVariante && !nurSchreibung) {
          abgleich.push(
            widerspruch(
              stelle.art === "luecke"
                ? `führt an dieser Stelle kein Wort, also auch nicht "${v.form}"`
                : dort === headNorm
                  ? `liest hier "${head}", nicht "${v.form}"`
                  : `liest an dieser Stelle "${stelle.wort}", weder "${head}" noch "${v.form}"`
            )
          );
        }
        continue;
      }
      if ((formenJeEdition.get(t.ed) ?? 0) > 1) continue;
      const liestKopf = liest(headNorm).includes(t.ed);
      if (liestVariante && !genannt) abgleich.push(nurZeugen);
      else if (!liestVariante && genannt && !nurSchreibung) {
        // Der dritte Zustand ist keiner der beiden: Die Edition führt weder die
        // Variante noch den Kopf. Bis zum 02.09.2026 wurde dann der Kopf behauptet.
        abgleich.push(
          widerspruch(
            liestKopf
              ? `liest hier "${head}", nicht "${v.form}"`
              : `führt an dieser Stelle weder "${head}" noch "${v.form}"`
          )
        );
      }
    }
  }
  return { belege, abgleich };
}
