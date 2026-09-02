/**
 * Das eine Abholen für alle Download-Skripte: Wiederholung mit wachsender
 * Pause, und eine Zeitgrenze je Versuch.
 *
 * Bis zum 02.09.2026 stand diese Schleife neunmal im Baum, dreimal byteweise
 * gleich, sechsmal um je eine Zeile verschieden, und keine der neun Kopien
 * hatte eine Zeitgrenze: Eine Gegenstelle, die die Verbindung annimmt und dann
 * schweigt, hing den Lauf unbegrenzt, und über `bible_setup` damit einen
 * Werkzeugaufruf des Servers. Die Wiederholung griff dabei nie, weil nichts
 * fehlschlug.
 *
 * Drei Leseformen, weil die Quellen drei Gestalten haben: Text (die meisten
 * Rohdateien), Bytes (die beiden ZIP-Archive) und JSON samt Rohtext (bolls.life,
 * dessen Rohtext in die Prüfsumme geht). Das Parsen liegt bei JSON innerhalb des
 * Versuchs, damit eine abgeschnittene Antwort oder eine HTML-Fehlerseite
 * wiederholt wird wie ein Netzwerkfehler, statt unbehandelt zu entkommen.
 */

export interface HoleOptionen {
  /** Versuche insgesamt; Vorgabe 3. */
  readonly versuche?: number;
  /** Zeitgrenze je Versuch in Millisekunden; Vorgabe 60 000. Die größte Datei
   *  (bolls.life, rund 7 MB) braucht hier gemessen unter zehn Sekunden. */
  readonly fristMs?: number;
  /** Jede Wiederholung auf stderr melden (download.ts tat das seit je). */
  readonly meldeWiederholung?: boolean;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function hole<T>(url: string, lese: (res: Response) => Promise<T>, opt: HoleOptionen): Promise<T> {
  const versuche = opt.versuche ?? 3;
  const fristMs = opt.fristMs ?? 60_000;
  for (let versuch = 0; versuch < versuche; versuch++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(fristMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await lese(res);
    } catch (err) {
      if (versuch === versuche - 1) throw err;
      const pause = Math.pow(2, versuch) * 1000;
      if (opt.meldeWiederholung) console.warn(`  Retry ${versuch + 1}/${versuche} after ${pause}ms: ${err}`);
      await sleep(pause);
    }
  }
  throw new Error(`Failed after ${versuche} attempts: ${url}`);
}

export function holeText(url: string, opt: HoleOptionen = {}): Promise<string> {
  return hole(url, (res) => res.text(), opt);
}

export function holeBytes(url: string, opt: HoleOptionen = {}): Promise<ArrayBuffer> {
  return hole(url, (res) => res.arrayBuffer(), opt);
}

export function holeJson<T>(
  url: string,
  opt: HoleOptionen = {}
): Promise<{ readonly data: T; readonly raw: string }> {
  return hole(
    url,
    async (res) => {
      const raw = await res.text();
      return { data: JSON.parse(raw) as T, raw };
    },
    opt
  );
}
