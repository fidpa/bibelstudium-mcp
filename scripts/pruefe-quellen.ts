#!/usr/bin/env bun
/**
 * Stellt die `provenance`-Zeilen der Datenbank gegen `quellen-pruefsummen.json`.
 *
 * Warum es das gibt: Die Download-Skripte schrieben ihre SHA-256 seit dem
 * 25.07.2026 in die Datenbank, und **niemand las sie je**. Gelesen wurde allein
 * `MAX(fetched_at)`, also das Datum. Eine Prüfsumme ohne Sollwert dokumentiert
 * nur, was ankam; sie bemerkt nicht, dass etwas anderes ankam als beim letzten
 * Mal. Ändert eine Gegenstelle ihren Text still, trägt der nächste Lauf die neue
 * Summe ein und alles sieht unverändert aus (Befund vom 22.08.2026).
 *
 * Der Abgleich läuft in **beide** Richtungen. Nur zu prüfen, ob jede gelistete
 * Quelle stimmt, ließe eine neu hinzugekommene Quelle unbemerkt durch: Genau
 * der Fall, in dem eine ungeprüfte Datenquelle in die Auslieferung gerät.
 *
 *   bun run pruefe:quellen              # prüfen, Exit 1 bei jeder Abweichung
 *   bun run pruefe:quellen --uebernehmen  # den Ist-Zustand zum neuen Soll machen
 *
 * `--uebernehmen` ist für den Fall gedacht, dass eine Quelle sich nachweislich
 * geändert hat und die Änderung geprüft wurde. Es benennt jede Abweichung, bevor
 * es sie festschreibt: Wer nicht liest, was er übernimmt, hat das Gate entfernt
 * statt es zu pflegen.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db-path.ts";

const MANIFEST_PFAD = new URL("../quellen-pruefsummen.json", import.meta.url).pathname;

/** Eine Zeile, wie `provenance` sie führt. Feldnamen bewusst wie die Spalten. */
interface Quelle {
  readonly script: string;
  readonly source: string;
  readonly files: number;
  readonly sha256: string;
}

interface Manifest {
  readonly erfasst_am: string;
  readonly hinweis: string;
  /** Skripte, deren Zeilen absichtlich nicht im Soll stehen, je mit Grund. */
  readonly nicht_geprueft: ReadonlyArray<{ readonly script: string; readonly grund: string }>;
  readonly quellen: ReadonlyArray<Quelle>;
}

/**
 * Sortierschlüssel aus beiden Primärschlüsselspalten. `\u0000` als Trenner,
 * weil es in keiner URL und keinem Skriptnamen vorkommen kann: Ein Leerzeichen
 * täte es hier auch, aber nur solange keine Quelle je eines enthält.
 *
 * Sortiert wird ausschließlich binär (`sort()` ohne Vergleichsfunktion), weil
 * SQLite `ORDER BY` es ebenso tut. `localeCompare()` ist hier falsch und war es
 * am 22.08.2026 bereits einmal: Es stellt `openscriptures` vor `STEPBible`, die
 * binäre Ordnung `STEPBible` vor `openscriptures` (`S` = 0x53 vor `o` = 0x6F).
 * Das Manifest galt dadurch als unsortiert, obwohl dasselbe Skript es eben
 * geschrieben hatte.
 */
function schluessel(q: Pick<Quelle, "script" | "source">): string {
  return `${q.script}\u0000${q.source}`;
}

function leseManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PFAD, "utf8")) as Manifest;
}

function leseDatenbank(): Quelle[] {
  // Ohne diese Vorabprüfung wirft bun:sqlite einen rohen Stacktrace und endet
  // mit Code 1: derselbe Code, mit dem eine echte Abweichung endet. Wer den
  // Lauf in einer Kette hat, könnte eine fehlende Datei nicht von einer
  // veränderten Quelle unterscheiden (gemessen 22.08.2026). Code 2 heißt
  // deshalb durchgängig „konnte nicht prüfen", Code 1 „geprüft und abweichend".
  if (!existsSync(DB_PATH)) {
    console.error(
      `Die Datenbank ${DB_PATH} gibt es nicht. Erst 'bun run setup' fahren, ` +
        "oder BIBLE_DB_PATH auf die vorhandene Datei zeigen lassen."
    );
    process.exit(2);
  }
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const vorhanden = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='provenance'")
      .get();
    if (vorhanden === null) {
      console.error(
        `Die Datenbank ${DB_PATH} hat keine provenance-Tabelle. Erst 'bun run setup' fahren.`
      );
      process.exit(2);
    }
    return db
      .query("SELECT script, source, files, sha256 FROM provenance ORDER BY script, source")
      .all() as Quelle[];
  } finally {
    db.close();
  }
}

function schreibeManifest(manifest: Manifest, quellen: ReadonlyArray<Quelle>): void {
  const sortiert = [...quellen].sort((a, b) => {
    const [x, y] = [schluessel(a), schluessel(b)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const neu: Manifest = {
    ...manifest,
    erfasst_am: new Date().toISOString().slice(0, 10),
    quellen: sortiert,
  };
  writeFileSync(MANIFEST_PFAD, `${JSON.stringify(neu, null, 2)}\n`);
}

const uebernehmen = process.argv.includes("--uebernehmen");
const manifest = leseManifest();
const ausgenommen = new Set(manifest.nicht_geprueft.map((a) => a.script));

// Zeilen ausgenommener Skripte gehen weder ins Soll noch ins Ist ein. Die
// Auslassung steht als Auslassung im Manifest, mit Grund: Ein stilles
// Weglassen wäre von einer vergessenen Quelle nicht zu unterscheiden.
const ist = leseDatenbank().filter((q) => !ausgenommen.has(q.script));
const soll = manifest.quellen;

// Manifest-Hygiene zuerst: Ein doppelter oder unsortierter Eintrag macht jeden
// folgenden Vergleich unzuverlässig, und beides entsteht beim Bearbeiten von Hand.
const sollSchluessel = soll.map(schluessel);
const befunde: string[] = [];
if (new Set(sollSchluessel).size !== sollSchluessel.length) {
  befunde.push("Das Manifest führt eine Quelle doppelt.");
}
if (JSON.stringify(sollSchluessel) !== JSON.stringify([...sollSchluessel].sort())) {
  befunde.push("Das Manifest ist nicht sortiert (script, dann source).");
}

const istNach = new Map(ist.map((q) => [schluessel(q), q]));
const sollNach = new Map(soll.map((q) => [schluessel(q), q]));

for (const [k, s] of sollNach) {
  const i = istNach.get(k);
  if (i === undefined) {
    befunde.push(`Fehlt in der Datenbank: ${s.script} | ${s.source}`);
    continue;
  }
  if (i.sha256 !== s.sha256) {
    befunde.push(
      `Prüfsumme weicht ab: ${s.script} | ${s.source}\n` +
        `    Soll ${s.sha256}\n    Ist  ${i.sha256}`
    );
  } else if (i.files !== s.files) {
    // Gleiche Summe bei anderer Anzahl ist kaum möglich und deshalb ein Hinweis
    // auf ein verändertes Skript, nicht auf veränderte Daten.
    befunde.push(`Anzahl Nutzlasten weicht ab: ${s.script} | ${s.source}: ${s.files} → ${i.files}`);
  }
}
for (const [k, i] of istNach) {
  if (!sollNach.has(k)) {
    befunde.push(`Nicht im Manifest: ${i.script} | ${i.source}`);
  }
}

if (uebernehmen) {
  if (befunde.length === 0) {
    console.log("Nichts zu übernehmen, Soll und Ist sind gleich.");
    process.exit(0);
  }
  console.log("Diese Abweichungen werden zum neuen Soll:\n");
  for (const b of befunde) console.log(`  - ${b}`);
  schreibeManifest(manifest, ist);
  console.log(
    `\n${MANIFEST_PFAD} geschrieben: ${ist.length} Quellen.\n` +
      "Die Änderung gehört in den Changelog, sonst ist später nicht zu klären, " +
      "ob sich eine Quelle geändert hat oder jemand das Gate weggedrückt hat."
  );
  process.exit(0);
}

if (befunde.length > 0) {
  console.error(`Quellenprüfung: ${befunde.length} Abweichung(en) gegen ${MANIFEST_PFAD}\n`);
  for (const b of befunde) console.error(`  - ${b}`);
  console.error(
    "\nIst die Änderung geprüft und gewollt: bun run pruefe:quellen --uebernehmen"
  );
  process.exit(1);
}

console.log(
  `Quellenprüfung bestanden: ${soll.length} Quellen stimmen mit dem Manifest überein` +
    (manifest.nicht_geprueft.length > 0
      ? `, ${manifest.nicht_geprueft.length} Skript(e) ausgenommen (siehe nicht_geprueft).`
      : ".")
);
