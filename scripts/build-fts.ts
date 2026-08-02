#!/usr/bin/env bun
/**
 * Baut den FTS5-Volltextindex über die deutschen Verse (`verses_fts`) in der
 * vorhandenen lokalen Datenbank auf oder neu. Ohne Netzzugriff, rein
 * abgeleitete Daten.
 *
 * Aufruf (nachdem download.ts die bible.db gebaut hat):
 *   bun run build-fts.ts
 *
 * download.ts baut den Index nach einem frischen Versimport von selbst neu;
 * dieses Skript ergänzt oder erneuert ihn auf einer bestehenden Datenbank.
 *
 * ERGÄNZEND: fasst allein `verses_fts` an.
 */

import { dirname, resolve } from "path";
import { rebuildVersesFts } from "./schema.ts";
import { DB_PATH } from "../db-path.ts";
import { openAtomicDb } from "./atomic-db.ts";


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
