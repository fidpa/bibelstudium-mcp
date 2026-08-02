import { Database } from "bun:sqlite";
import { dirname, resolve, basename } from "path";
import {
  copyFileSync, existsSync, renameSync, unlinkSync, chmodSync, mkdirSync,
} from "fs";

/**
 * Atomarer Schreiber für die geteilte bible.db.
 *
 * Ein Download darf die laufende Datenbankdatei niemals an Ort und Stelle
 * ändern: Der nur lesende MCP-Server einer anderen Sitzung hält sie womöglich
 * offen, und sie mitten im Betrieb zu überschreiben oder ihre WAL-Sidecars zu
 * löschen erzeugt dort einen „disk I/O error".
 *
 * Gearbeitet wird deshalb auf einer eigenen temporären Kopie, die ein einzelnes
 * rename(2) einwechselt, auf demselben Dateisystem atomar. Ein gleichzeitiger
 * Leser behält über seinen offenen Dateideskriptor eine in sich stimmige Sicht
 * auf die alte Datei, bis er neu öffnet; neue Verbindungen sehen die fertig
 * geschriebene neue Datei. Einen Zwischenzustand sieht niemand.
 *
 * Die veröffentlichte Datei bleibt im Rollback-Journalmodus (DELETE): Sie ist
 * damit selbstgenügsam, braucht keine -wal/-shm-Sidecars, und nur lesende Leser
 * müssen gar keine solchen Dateien anlegen.
 *
 * ACHTUNG: Die Download-Skripte ergänzen dieselbe Datei und müssen nacheinander
 * laufen, denn jedes startet von einer Kopie der aktuellen Datenbank. Bei zwei
 * gleichzeitigen Läufen überschreibt das spätere rename die Edition des
 * früheren.
 */
export interface AtomicDb {
  db: Database;
  /** Abschluss: Checkpoint, WAL zurückfalten, laufende Datei atomar ersetzen. */
  commit(): void;
  /** Temporäre Kopie verwerfen, die laufende Datei bleibt unberührt. */
  abort(): void;
}

function removeSidecars(path: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* gibt es womöglich nicht */ }
  }
}

/**
 * Öffnet eine temporäre Kopie von `dbPath` zum Schreiben. Mit `fresh: true`
 * (oder wenn die Datei noch nicht existiert) beginnt sie mit einer leeren
 * Datenbank, statt zu kopieren.
 */
export function openAtomicDb(dbPath: string, opts: { fresh?: boolean } = {}): AtomicDb {
  const dir = dirname(dbPath);
  // Datenverzeichnis sicherstellen: Es ist gitignored, ein frischer Klon hat
  // also kein data/, bis der erste Download läuft.
  mkdirSync(dir, { recursive: true });
  const tmpPath = resolve(dir, `.${basename(dbPath)}.${process.pid}.tmp`);

  // Reste eines früheren, abgestürzten Laufs wegräumen.
  removeSidecars(tmpPath);
  try { unlinkSync(tmpPath); } catch { /* keine da */ }

  if (!opts.fresh && existsSync(dbPath)) {
    copyFileSync(dbPath, tmpPath);
  }

  const db = new Database(tmpPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL"); // schnelles Massenladen auf der eigenen Kopie
  db.exec("PRAGMA synchronous = NORMAL");

  let finalized = false;

  const abort = (): void => {
    if (finalized) return;
    finalized = true;
    try { db.close(); } catch { /* schon geschlossen */ }
    removeSidecars(tmpPath);
    try { unlinkSync(tmpPath); } catch { /* keine da */ }
  };

  const commit = (): void => {
    if (finalized) throw new Error("atomic db already finalized");
    finalized = true;
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.exec("PRAGMA journal_mode = DELETE"); // selbstgenügsame Datei veröffentlichen
    db.close();
    removeSidecars(tmpPath); // gefahrlos: die Kopie ist privat, kein zweiter Leser
    renameSync(tmpPath, dbPath); // atomarer Tausch
    chmodSync(dbPath, 0o600); // die Datenbankdatei selbst beschränken (sicherheitsrelevant)
    try { chmodSync(dir, 0o700); } catch { /* nach Möglichkeit; das Elternverzeichnis gehört uns womöglich nicht */ }
  };

  return { db, commit, abort };
}
