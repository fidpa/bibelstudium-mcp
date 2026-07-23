#!/usr/bin/env bun
/**
 * (Re)build the FTS5 full-text index over the German verses (`verses_fts`)
 * in the existing local database. No network access — purely derived data.
 *
 * Run (after download.ts has built bible.db):
 *   bun run build-fts.ts
 *
 * download.ts rebuilds the index automatically after a fresh verse import;
 * this script exists to add or refresh the index on an existing DB.
 *
 * ADDITIVE: touches only `verses_fts`.
 */

import { dirname, resolve } from "path";
import { rebuildVersesFts } from "./schema.ts";
import { openAtomicDb } from "./atomic-db.ts";

const DB_PATH = resolve(dirname(import.meta.path), "data/bible.db");

function main(): void {
  console.log("=== Full-text index (FTS5) over the German verses ===");
  console.log(`Database: ${DB_PATH}`);

  const { db, commit, abort } = openAtomicDb(DB_PATH);
  try {
    const verses = (db.query("SELECT COUNT(*) as n FROM verses").get() as { n: number }).n;
    if (verses === 0) throw new Error("No verses in the DB — run download.ts first.");
    rebuildVersesFts(db);
    const rows = db
      .query("SELECT translation, COUNT(*) as n FROM verses_fts GROUP BY translation ORDER BY translation")
      .all() as Array<{ translation: string; n: number }>;
    for (const r of rows) console.log(`  ${r.translation}: ${r.n} verses indexed`);
    const n = (db.query("SELECT COUNT(*) as n FROM verses_fts").get() as { n: number }).n;
    console.log(`Done! ${n} verses indexed.`);
    commit();
  } catch (err) {
    abort();
    throw err;
  }
}

try {
  main();
} catch (error) {
  console.error("FTS build failed:", error);
  process.exit(1);
}
