import { Database } from "bun:sqlite";
import { dirname, resolve, basename } from "path";
import {
  copyFileSync, existsSync, renameSync, unlinkSync, chmodSync, mkdirSync,
} from "fs";

/**
 * Atomic writer for the shared bible.db.
 *
 * Downloads must never modify the live database file in place: another session's
 * read-only MCP server may hold it open, and rewriting it (or deleting its WAL
 * sidecars) mid-flight causes "disk I/O error" for that reader.
 *
 * Instead we work on a private temporary copy and swap it in with a single
 * rename(2), which is atomic on the same filesystem. A concurrent reader keeps
 * a consistent view of the old file (via its open fd) until it reopens; new
 * connections see the fully-written new file. Nothing ever observes a partial
 * state.
 *
 * The published file is left in rollback (DELETE) journal mode — self-contained,
 * needing no -wal/-shm sidecars — so read-only readers never have to create
 * sidecar files at all.
 *
 * NOTE: download scripts append to the same file and must be run sequentially
 * (each starts from a copy of the current DB); running two at once would let the
 * later rename clobber the earlier one's edition.
 */
export interface AtomicDb {
  db: Database;
  /** Finalize: checkpoint, fold WAL back, atomically replace the live file. */
  commit(): void;
  /** Discard the temp copy; leave the live file untouched. */
  abort(): void;
}

function removeSidecars(path: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* may not exist */ }
  }
}

/**
 * Open a temp copy of `dbPath` for writing. With `fresh: true` (or when the file
 * does not yet exist) it starts from an empty database instead of copying.
 */
export function openAtomicDb(dbPath: string, opts: { fresh?: boolean } = {}): AtomicDb {
  const dir = dirname(dbPath);
  // Ensure the data directory exists — it is gitignored, so a fresh clone has
  // no data/ folder until the first download runs.
  mkdirSync(dir, { recursive: true });
  const tmpPath = resolve(dir, `.${basename(dbPath)}.${process.pid}.tmp`);

  // Clean any leftover temp from a previous crashed run.
  removeSidecars(tmpPath);
  try { unlinkSync(tmpPath); } catch { /* none */ }

  if (!opts.fresh && existsSync(dbPath)) {
    copyFileSync(dbPath, tmpPath);
  }

  const db = new Database(tmpPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL"); // fast bulk load on the private copy
  db.exec("PRAGMA synchronous = NORMAL");

  let finalized = false;

  const abort = (): void => {
    if (finalized) return;
    finalized = true;
    try { db.close(); } catch { /* already closed */ }
    removeSidecars(tmpPath);
    try { unlinkSync(tmpPath); } catch { /* none */ }
  };

  const commit = (): void => {
    if (finalized) throw new Error("atomic db already finalized");
    finalized = true;
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.exec("PRAGMA journal_mode = DELETE"); // publish a self-contained file
    db.close();
    removeSidecars(tmpPath); // safe: temp is private, no other reader
    renameSync(tmpPath, dbPath); // atomic swap
    chmodSync(dbPath, 0o600); // restrict the DB file itself (security-relevant)
    try { chmodSync(dir, 0o700); } catch { /* best effort; parent dir may not be ours */ }
  };

  return { db, commit, abort };
}
