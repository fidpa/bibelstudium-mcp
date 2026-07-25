/**
 * Provenance recording for the download scripts ("Belege statt Behauptungen"):
 * every download-*.ts hashes each fetched payload into a per-source rolling
 * SHA-256 and writes one `provenance` row per logical source before commit().
 *
 * The digest covers the payloads in fetch order, so it is reproducible for a
 * given upstream state as long as the script's fetch order is deterministic
 * (all loops here iterate fixed book/file lists). Inspect with:
 *
 *   sqlite3 data/bible.db "SELECT * FROM provenance ORDER BY script"
 */

import type { Database } from "bun:sqlite";
import { ensureProvenanceSchema } from "./schema.ts";

/** Rolling SHA-256 over every payload fetched from one logical source. */
export interface SourceDigest {
  readonly source: string;
  /** Number of payloads hashed so far. */
  readonly files: number;
  add(payload: string | Uint8Array | ArrayBuffer): void;
  /** Finalize and return the hex digest — call once, after the last add(). */
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
 * Replace the calling script's provenance rows. Call right before commit(),
 * after all fetches succeeded — a failed run aborts the temp copy and leaves
 * the previous rows untouched.
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
