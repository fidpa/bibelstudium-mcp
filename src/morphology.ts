/**
 * Die drei Morphologie-Schemata der geführten Grundtext-Editionen.
 *
 * Reine Funktionen: Eine Zeichenkette geht hinein, ein aufgelöster Text kommt
 * heraus. Keine Datenbank, kein Protokollbezug, kein geteilter Zustand. Deshalb
 * stehen sie hier und nicht im Server.
 *
 * Drei Schemata, nicht eines, und sie sehen einander ähnlich genug, um
 * verwechselt zu werden: `sblgnt` liegt in MorphGNT-Codes vor (acht Zeichen),
 * `byzantine` und `tr` in Robinson-Codes, `wlc` in OSHB-Codes. Der wichtigste
 * Unterschied steht am Robinson-Abschnitt: Der Imperativ ist dort „M", bei
 * MorphGNT „D".
 *
 * Die drei Abschnitte gehören zusammen und dürfen nicht getrennt werden: Der
 * Robinson-Dekoder greift auf die Kasus-, Numerus-, Genus- und Personentabellen
 * des MorphGNT-Abschnitts zu.
 *
 * Nach außen sichtbar sind allein die drei Dekoder und `posLabel`; die Tabellen
 * und die hebräischen Teilschritte bleiben hier.
 */

// --- Griechische Morphologie: MorphGNT-Codes (sblgnt) ----------------------
// Ein Parse-Code hat acht Zeichen in fester Feldreihenfolge: Person, Tempus,
// Genus verbi, Modus, Kasus, Numerus, Genus, Steigerung; "-" heißt, das Feld
// trifft nicht zu.
const POS_LABELS: Record<string, string> = {
  "N-": "Substantiv", "A-": "Adjektiv", "V-": "Verb", "RA": "Artikel",
  "RP": "Pronomen", "RD": "Demonstrativpronomen", "RI": "Interrog./Indef.-Pronomen",
  "RR": "Relativpronomen", "C-": "Konjunktion", "D-": "Adverb",
  "P-": "Präposition", "I-": "Interjektion", "X-": "Partikel",
};
const PERSON: Record<string, string> = { "1": "1. Person", "2": "2. Person", "3": "3. Person" };
const TENSE: Record<string, string> = {
  P: "Präsens", I: "Imperfekt", F: "Futur",
  A: "Aorist", X: "Perfekt", Y: "Plusquamperfekt",
};
const VOICE: Record<string, string> = { A: "Aktiv", M: "Medium", P: "Passiv" };
const MOOD: Record<string, string> = {
  I: "Indikativ", D: "Imperativ", S: "Konjunktiv",
  O: "Optativ", N: "Infinitiv", P: "Partizip",
};
const GCASE: Record<string, string> = {
  N: "Nominativ", G: "Genitiv", D: "Dativ", A: "Akkusativ", V: "Vokativ",
};
const GNUMBER: Record<string, string> = { S: "Singular", P: "Plural" };
const GENDER: Record<string, string> = { M: "maskulin", F: "feminin", N: "neutrum" };
const DEGREE: Record<string, string> = { C: "Komparativ", S: "Superlativ" };

export function decodeParse(parse: string): string {
  const p = parse.padEnd(8, "-");
  const parts: string[] = [];
  const push = (map: Record<string, string>, ch: string | undefined) => {
    if (ch && ch !== "-" && map[ch]) parts.push(map[ch]!);
  };
  push(PERSON, p[0]);
  push(TENSE, p[1]);
  push(VOICE, p[2]);
  push(MOOD, p[3]);
  push(GCASE, p[4]);
  push(GNUMBER, p[5]);
  push(GENDER, p[6]);
  push(DEGREE, p[7]);
  return parts.join(" ");
}

export function posLabel(pos: string): string {
  return POS_LABELS[pos] ?? pos;
}

// --- Griechische Morphologie: Robinson-Codes (byzantine, tr) ---------------
// Durch Bindestriche getrennt, etwa "N-APN", "V-PAM-2P", "T-GSM".
// Form: POS[-Tempus/Genus verbi/Modus]-[Person][Kasus][Numerus][Genus].
const ROB_POS: Record<string, string> = {
  N: "Substantiv", A: "Adjektiv", T: "Artikel", V: "Verb",
  P: "Personalpronomen", R: "Relativpronomen", C: "Reziprok-/Demonstrativpron.",
  D: "Demonstrativpronomen", K: "Korrelativpronomen", I: "Interrogativpronomen",
  X: "Indefinitpronomen", Q: "Korrelativ-/Interrog.-Pron.", F: "Reflexivpronomen",
  S: "Possessivpronomen", ADV: "Adverb", CONJ: "Konjunktion", COND: "Konditional",
  PRT: "Partikel", PREP: "Präposition", INJ: "Interjektion", ARAM: "aramäisch",
  HEB: "hebräisch", "N-PRI": "Eigenname (indekl.)", "A-NUI": "Zahlwort (indekl.)",
};
const ROB_TENSE: Record<string, string> = {
  P: "Präsens", I: "Imperfekt", F: "Futur", A: "Aorist",
  R: "Perfekt", L: "Plusquamperfekt", X: "Perfekt",
  "2A": "Aorist", "2F": "Futur", "2R": "Perfekt", "2P": "Präsens",
};
const ROB_VOICE: Record<string, string> = {
  A: "Aktiv", M: "Medium", P: "Passiv", E: "Medium/Passiv",
  D: "Deponens (Med.)", O: "Deponens (Pass.)", N: "Deponens (Med./Pass.)",
  Q: "unpersönlich", X: "kein",
};
// Die Modusbuchstaben bei Robinson weichen von MorphGNT ab: Der Imperativ ist
// "M" (iMperativ), nicht "D".
const ROB_MOOD: Record<string, string> = {
  I: "Indikativ", M: "Imperativ", S: "Konjunktiv",
  O: "Optativ", N: "Infinitiv", P: "Partizip",
};

/** Löst einen Robinson-Morphologiecode (byzantinische Edition) in lesbares Deutsch auf. */
export function decodeRobinson(code: string): string {
  const raw = code.trim();
  if (!raw) return "—";
  const parts = raw.split("-");
  const head = parts[0]!;
  const out: string[] = [];

  // Verb: V-<Tempus+Genus+Modus>-<Person+Numerus> oder V-<tgm>-<Kasus+Numerus+Genus>
  // beim Partizip
  if (head === "V") {
    out.push("Verb");
    const tvm = parts[1] ?? "";
    // Das Tempus hat ein oder zwei Zeichen ("2A"), dann folgt das Genus verbi (1),
    // dann der Modus (1)
    let i = 0;
    let tense = tvm[i] ?? "";
    if (tense === "2" && tvm[i + 1]) { tense = "2" + tvm[i + 1]; i += 2; } else { i += 1; }
    const voice = tvm[i] ?? ""; i += 1;
    const mood = tvm[i] ?? "";
    if (ROB_TENSE[tense]) out.push(ROB_TENSE[tense]!);
    if (ROB_VOICE[voice]) out.push(ROB_VOICE[voice]!);
    if (ROB_MOOD[mood]) out.push(ROB_MOOD[mood]!);
    const tail = parts[2] ?? "";
    if (mood === "P") {
      // Partizip: Kasus, Numerus, Genus
      if (GCASE[tail[0] ?? ""]) out.push(GCASE[tail[0]!]!);
      if (GNUMBER[tail[1] ?? ""]) out.push(GNUMBER[tail[1]!]!);
      if (GENDER[tail[2] ?? ""]) out.push(GENDER[tail[2]!]!);
    } else if (tail) {
      // finite Form: Person und Numerus
      if (PERSON[tail[0] ?? ""]) out.push(PERSON[tail[0]!]!);
      if (GNUMBER[tail[1] ?? ""]) out.push(GNUMBER[tail[1]!]!);
    }
    return out.join(" ");
  }

  // Nicht-Verb: POS, dann ein optionaler Block aus Kasus, Numerus und Genus (etwa
  // N-APN, T-GSM, A-NPM). Nur deklinierbare Wortarten tragen ein solches Suffix;
  // bei Partikeln, Konjunktionen und dergleichen ist ein angehängtes "-N"/"-I" ein
  // Funktionsmarker (Negation, Interrogativ) und keine Deklination, darf also
  // nicht als Kasus gelesen werden.
  out.push(ROB_POS[head] ?? head);
  const DECLINABLE = new Set(["N", "A", "T", "P", "R", "C", "D", "K", "I", "X", "Q", "F", "S"]);
  const decl = parts[1] ?? "";
  if (DECLINABLE.has(head) && decl && decl !== "PRI" && decl !== "NUI") {
    // Personalpronomen mit vorangestellter Personenziffer, etwa P-1DS, P-2AP
    let d = decl;
    if (/^[123]/.test(d)) { if (PERSON[d[0]!]) out.push(PERSON[d[0]!]!); d = d.slice(1); }
    if (GCASE[d[0] ?? ""]) out.push(GCASE[d[0]!]!);
    if (GNUMBER[d[1] ?? ""]) out.push(GNUMBER[d[1]!]!);
    if (GENDER[d[2] ?? ""]) out.push(GENDER[d[2]!]!);
  }
  return out.join(" ") || "—";
}

// --- Hebräische und aramäische Morphologie (OSHB-Codes) --------------------
const HEB_STEM: Record<string, string> = {
  q: "Qal", N: "Nifal", p: "Piel", P: "Pual", h: "Hifil", H: "Hofal",
  t: "Hitpael", o: "Polel", O: "Polal", r: "Hitpolel", m: "Poel", M: "Poal",
  k: "Palel", K: "Pulal", Q: "Qal passiv", l: "Pilpel", L: "Polpal",
  f: "Hitpalpel", D: "Nitpael", j: "Pealal", i: "Pilel", u: "Hotpaal",
  c: "Tifil", v: "Hištafel", w: "Nitpalel", y: "Nitpoel", z: "Hitpoel",
};
const ARC_STEM: Record<string, string> = {
  q: "Peal", Q: "Peil", u: "Hitpeel", p: "Pael", P: "Itpaal", M: "Hitpaal",
  a: "Afel", h: "Hafel", s: "Šafel", e: "Šafel", H: "Hofal", i: "Itpeel",
  t: "Hištafel", v: "Ištafel", w: "Hitafel", o: "Polel", z: "Itpoel",
  r: "Hitpolel", f: "Hitpalpel", b: "Hefal", c: "Tifel", m: "Poel",
  l: "Palpel", L: "Itpalpel", O: "Itpolel", G: "Ittafal",
};
const HEB_CONJ: Record<string, string> = {
  p: "Perfekt", q: "seq. Perfekt", i: "Imperfekt", w: "seq. Imperfekt",
  h: "Kohortativ", j: "Jussiv", v: "Imperativ", r: "Partizip aktiv",
  s: "Partizip passiv", a: "Infinitiv absolut", c: "Infinitiv konstrukt",
};
const HEB_PERSON: Record<string, string> = { "1": "1. Person", "2": "2. Person", "3": "3. Person" };
const HEB_GENDER: Record<string, string> = {
  b: "m./f.", c: "gemeins.", f: "feminin", m: "maskulin",
};
const HEB_NUMBER: Record<string, string> = { s: "Singular", d: "Dual", p: "Plural" };
const HEB_STATE: Record<string, string> = { a: "absolut", c: "konstrukt", d: "determiniert" };
const HEB_ADJ_TYPE: Record<string, string> = {
  a: "Adjektiv", c: "Kardinalzahl", g: "Adjektiv (Gentilicum)", o: "Ordinalzahl",
};
const HEB_PRON_TYPE: Record<string, string> = {
  d: "Demonstrativ", f: "Indefinit", i: "Interrogativ", p: "Personal", r: "Relativ",
};
const HEB_PART_TYPE: Record<string, string> = {
  a: "Affirmation", d: "Artikel", e: "Exhortativ", i: "Interrogativ",
  j: "Interjektion", m: "Demonstrativ", n: "Negation", o: "Objektmarker",
  r: "Relativ",
};
const HEB_SUFF_TYPE: Record<string, string> = {
  d: "Richtungs-He", h: "paragog. He", n: "paragog. Nun", p: "Pronominalsuffix",
};

/** Löst eine Folge von Merkmalszeichen in fester Feldreihenfolge auf (überspringt Platzhalter 'x'). */
function hebFeatures(str: string, order: Array<Record<string, string>>): string[] {
  const out: string[] = [];
  for (let i = 0; i < order.length && i < str.length; i++) {
    const ch = str[i]!;
    if (ch === "x") continue;
    const label = order[i]![ch];
    if (label) out.push(label);
  }
  return out;
}

/** Löst ein Morphem eines OSHB-Codes auf (die Sprachkennung ist bereits entfernt). */
function decodeHebMorpheme(code: string, aramaic: boolean): string {
  if (!code) return "";
  const pos = code[0]!;
  const rest = code.slice(1);
  switch (pos) {
    case "C": return "Konjunktion";
    case "D": return "Adverb";
    case "R": return "Präposition" + (rest[0] === "d" ? " (mit Artikel)" : "");
    case "T": return "Partikel" + (HEB_PART_TYPE[rest[0] ?? ""] ? ` (${HEB_PART_TYPE[rest[0]!]})` : "");
    case "N": {
      const type = rest[0] ?? "";
      const head = type === "p" ? "Eigenname" : type === "g" ? "Substantiv (Gentilicum)" : "Substantiv";
      if (type === "p") return head; // Eigennamen tragen keine weitere Bestimmung
      return [head, ...hebFeatures(rest.slice(1), [HEB_GENDER, HEB_NUMBER, HEB_STATE])].join(" ");
    }
    case "A": {
      const head = HEB_ADJ_TYPE[rest[0] ?? ""] ?? "Adjektiv";
      return [head, ...hebFeatures(rest.slice(1), [HEB_GENDER, HEB_NUMBER, HEB_STATE])].join(" ");
    }
    case "P": {
      const head = `Pronomen${HEB_PRON_TYPE[rest[0] ?? ""] ? ` (${HEB_PRON_TYPE[rest[0]!]})` : ""}`;
      return [head, ...hebFeatures(rest.slice(1), [HEB_PERSON, HEB_GENDER, HEB_NUMBER])].join(" ");
    }
    case "S": {
      const head = HEB_SUFF_TYPE[rest[0] ?? ""] ?? "Suffix";
      return [head, ...hebFeatures(rest.slice(1), [HEB_PERSON, HEB_GENDER, HEB_NUMBER])].join(" ");
    }
    case "V": {
      const stem = (aramaic ? ARC_STEM : HEB_STEM)[rest[0] ?? ""] ?? rest[0] ?? "";
      const conjCh = rest[1] ?? "";
      const conj = HEB_CONJ[conjCh] ?? "";
      const feats = rest.slice(2);
      let tail: string[];
      if (conjCh === "r" || conjCh === "s") {
        tail = hebFeatures(feats, [HEB_GENDER, HEB_NUMBER, HEB_STATE]); // Partizip
      } else if (conjCh === "a" || conjCh === "c") {
        tail = []; // Infinitiv
      } else {
        tail = hebFeatures(feats, [HEB_PERSON, HEB_GENDER, HEB_NUMBER]); // finite Form
      }
      return ["Verb", stem, conj, ...tail].filter(Boolean).join(" ");
    }
    default: return pos;
  }
}

/** Löst eine vollständige OSHB-Morphologiezeichenkette auf ("HR/Ncfsa" → "Präposition + Substantiv feminin Singular absolut"). */
export function decodeHebrew(morph: string): string {
  if (!morph) return "—";
  const aramaic = morph[0] === "A";
  const body = morph.replace(/^[HA]/, "");
  const pieces = body.split("/").map((m) => decodeHebMorpheme(m, aramaic)).filter(Boolean);
  return pieces.join(" + ") || "—";
}
