/**
 * Zwei Handgriffe, die jedes Download-Skript am Ende macht: die Größe der
 * Datenbank melden und als Skript laufen, ohne bei einem Import zu starten.
 *
 * Bis zum 02.09.2026 stand der Größenblock neunmal und der Startblock zehnmal
 * gleichlautend im Baum. `import.meta.main` selbst muss im aufrufenden Modul
 * stehen (es meint dessen Datei); hier liegt nur, was danach kommt.
 */
import { statSync } from "fs";

/** Meldet die Größe der Datenbankdatei in Megabyte, eine Nachkommastelle. */
export function berichteGroesse(dbPath: string): void {
  const sizeMB = (statSync(dbPath).size / 1024 / 1024).toFixed(1);
  console.log(`Database size now: ${sizeMB} MB`);
}

/** Fährt `main` als Skript: ein Fehler geht mit Meldung nach stderr und Exit 1. */
export function alsSkript(main: () => Promise<void>, meldung = "Download failed:"): void {
  main().catch((error) => {
    console.error(meldung, error);
    process.exit(1);
  });
}
