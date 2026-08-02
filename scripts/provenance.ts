/**
 * Herkunftsnachweis für die Download-Skripte („Belege statt Behauptungen"):
 * Jedes download-*.ts hasht jede empfangene Nutzlast in eine fortlaufende
 * SHA-256 je Quelle und schreibt vor commit() eine `provenance`-Zeile je
 * logischer Quelle.
 *
 * Die Prüfsumme läuft über die Nutzlasten in der Reihenfolge des Abrufs. Sie
 * ist damit für einen gegebenen Stand der Gegenstelle reproduzierbar, solange
 * die Abrufreihenfolge des Skripts feststeht (alle Schleifen hier laufen über
 * feste Buch- oder Dateilisten). Nachsehen mit:
 *
 *   sqlite3 data/bible.db "SELECT * FROM provenance ORDER BY script"
 */

import type { Database } from "bun:sqlite";
import { ensureProvenanceSchema } from "./schema.ts";

/** Fortlaufende SHA-256 über jede Nutzlast einer logischen Quelle. */
export interface SourceDigest {
  readonly source: string;
  /** Anzahl der bisher gehashten Nutzlasten. */
  readonly files: number;
  add(payload: string | Uint8Array | ArrayBuffer): void;
  /** Abschließen und die Prüfsumme hexadezimal liefern: einmal, nach dem letzten add(). */
  hex(): string;
}

export function createSourceDigest(source: string): SourceDigest {
  const hasher = new Bun.CryptoHasher("sha256");
  let files = 0;
  return {
    source,
    get files() {
      return files;
    },
    add(payload) {
      hasher.update(payload);
      files++;
    },
    hex: () => hasher.digest("hex"),
  };
}

/**
 * Ersetzt die provenance-Zeilen des aufrufenden Skripts. Aufzurufen direkt vor
 * commit(), nachdem alle Abrufe geglückt sind: Ein gescheiterter Lauf verwirft
 * die temporäre Kopie und lässt die bisherigen Zeilen unberührt.
 */
export function writeProvenance(
  db: Database,
  script: string,
  digests: ReadonlyArray<SourceDigest>
): void {
  ensureProvenanceSchema(db);
  db.prepare("DELETE FROM provenance WHERE script = ?").run(script);
  const insert = db.prepare(
    "INSERT INTO provenance (script, source, files, sha256, fetched_at) VALUES (?, ?, ?, ?, ?)"
  );
  const now = new Date().toISOString();
  for (const d of digests) {
    insert.run(script, d.source, d.files, d.hex(), now);
  }
}
