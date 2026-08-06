/**
 * Die Zusicherungen der Golden-Tests und ihr Zähler.
 *
 * Bewusst kein Test-Framework: Eine Zusicherung ist hier ein Funktionsaufruf mit
 * einem Namen, einer Bedingung und einer Erklärung, was stattdessen dastand. Wer
 * die Datei liest, sieht die Aussage über die Daten, nicht das Gerüst darum.
 *
 * Der Zähler liegt auf Modulebene und wird von allen Bündeln geteilt. Deshalb
 * gibt es genau eine Stelle, die das Ergebnis ausgibt und den Prozess beendet:
 * `abschluss()`. Wer die Zahl an zwei Orten ausgäbe, zählte im Einzellauf eines
 * Bündels mit, was gar nicht gelaufen ist.
 */

export type Json = Record<string, unknown>;

let failures = 0;
let checks = 0;

export function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (ok) return;
  failures++;
  console.log(`  FEHLGESCHLAGEN  ${name}${detail ? `\n                  ${detail}` : ""}`);
}

export function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `erwartet ${JSON.stringify(expected)}, war ${JSON.stringify(actual)}`);
}

/**
 * Teilzeichenketten-Prüfung über NFC-normalisierten Text.
 *
 * Nötig, nicht kosmetisch: `tagnt_words` führt bei 46 095 seiner 141 720
 * Wortformen die Oxia-Codepunkte (U+1F73 …), während `original_words`
 * durchgängig NFC ist (Tonos, U+03AD …). Beide sehen gleich aus, und
 * `ἐπέβαλον` aus der einen Quelle ist byteweise nicht `ἐπέβαλον` aus der
 * anderen. Ohne die Normalisierung hier scheiterte eine Zusicherung an einem
 * Unterschied, den niemand sehen kann.
 */
export function has(name: string, haystack: string, needle: string): void {
  const h = haystack.normalize("NFC");
  const n = needle.normalize("NFC");
  check(name, h.includes(n), `"${needle}" fehlt in: ${haystack.slice(0, 160)}…`);
}

/**
 * Das Gegenstück, und aus demselben Grund normalisiert.
 *
 * Bis zum 06.08.2026 normalisierte `has()` und `lacks()` nicht. Folgenlos war
 * das nur, solange kein Aufruf griechischen Text prüfte: Beim ersten solchen
 * bestünde die Zusicherung genau aus dem Grund, den der Kommentar über `has()`
 * beschreibt, und zwar in der gefährlicheren Richtung. Ein `has()`, das
 * fälschlich fehlschlägt, meldet sich; ein `lacks()`, das fälschlich besteht,
 * schweigt.
 */
export function lacks(name: string, haystack: string, needle: string): void {
  const h = haystack.normalize("NFC");
  const n = needle.normalize("NFC");
  check(name, !h.includes(n), `"${needle}" stand unerwartet drin`);
}

/** Der `hinweis` einer Antwort, leer wenn keiner dasteht. */
export const hint = (j: Json | null): string =>
  typeof j?.hinweis === "string" ? j.hinweis : "";

/** Wie viele Zusicherungen bisher gelaufen sind. Für die Zahl je Bündel. */
export const zusicherungen = (): number => checks;

/**
 * Ergebniszeile ausgeben und den Prozess beenden.
 *
 * `mindestens` ist ein Wächter und keine Zusicherung: Fällt ein Bündel aus der
 * Importliste des Aggregators, sinkt die Summe, ohne dass eine einzige Prüfung
 * fehlschlüge. Ein grüner Lauf mit weniger Prüfungen sieht aus wie ein grüner
 * Lauf. Beim Einzellauf eines Bündels bleibt der Wert offen, dort ist jede Zahl
 * richtig.
 */
export function abschluss(mindestens: number | null = null): never {
  if (mindestens !== null && checks < mindestens) {
    console.log(
      `\nFEHLER: nur ${checks} Zusicherungen gelaufen, erwartet waren mindestens ${mindestens}. ` +
        "Fehlt ein Bündel in der Importliste?"
    );
    process.exit(1);
  }
  console.log(
    `\n${failures === 0 ? "OK" : "FEHLER"}: ${checks - failures}/${checks} Prüfungen bestanden`
  );
  process.exit(failures === 0 ? 0 : 1);
}
