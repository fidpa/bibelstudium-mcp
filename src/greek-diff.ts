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
const GREEK_RUN_RE = /\p{Script=Greek}+/gu;

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
 */
export function crossCheckVariant(
  note: string,
  headword: string,
  texts: Array<{ ed: string; words: string[] }>
): { belege: Record<string, string[]>; abgleich: string[] } | undefined {
  const head = greekLettersOnly(headword);
  if (head === "") return undefined;

  // Ein mit ";" getrenntes Segment je Variante: ihre Zeugen und ihre griechische Form.
  const varianten = note
    .split(";")
    .map((seg) => ({
      zeugen: new Set(seg.match(TAGNT_WITNESS_RE) ?? []),
      form: (seg.match(GREEK_RUN_RE) ?? [])
        .map((f) => f.replace(/[^\p{L}]/gu, ""))
        .find((f) => f.length > 1),
    }))
    .filter(
      (v): v is { zeugen: Set<string>; form: string } =>
        v.form !== undefined && normForCompare(v.form) !== normForCompare(head)
    );

  const liest = (form: string): string[] => {
    const n = normForCompare(form);
    return texts.filter((t) => t.words.some((w) => normForCompare(w) === n)).map((t) => t.ed);
  };

  const belege: Record<string, string[]> = {};
  for (const form of [head, ...varianten.map((v) => v.form)]) {
    const eds = liest(form);
    if (eds.length > 0) belege[form] = eds;
  }
  if (Object.keys(belege).length === 0) return undefined;

  const abgleich: string[] = [];
  for (const v of varianten) {
    if (istElision(normForCompare(v.form), normForCompare(head))) continue;
    for (const t of texts) {
      const label = TAGNT_LABEL[t.ed];
      if (label === undefined) continue;
      const liestVariante = liest(v.form).includes(t.ed);
      const genannt = v.zeugen.has(label);
      // Zuerst nennen, was die Edition liest, dann die Notiz, der sie
      // widerspricht. Umgekehrt formuliert („TAGNT nennt … der Text liest
      // anders") liest es sich wie eine Randbemerkung zur Datenqualität und
      // entfällt beim Wiedergeben des Befundes; Mk 14,46 wurde zweimal ohne den
      // Vorbehalt gemeldet (25.07.2026).
      const liesForm = liest(v.form).includes(t.ed) ? v.form : head;
      if (liestVariante && !genannt) {
        abgleich.push(
          `${t.ed} liest hier "${liesForm}"; die TAGNT-Notiz führt dafür nur ` +
            `${[...v.zeugen].join("+") || "keine Edition"} als Zeugen. Für diese Edition gilt ` +
            "der Editionstext."
        );
      } else if (!liestVariante && genannt) {
        abgleich.push(
          `${t.ed} liest hier "${liesForm}", nicht "${v.form}"; die TAGNT-Notiz nennt ` +
            `${label} jedoch als Zeugen für "${v.form}". Für diese Edition gilt der Editionstext.`
        );
      }
    }
  }
  return { belege, abgleich };
}
