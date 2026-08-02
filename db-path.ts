/**
 * Wo die Datenbank liegt: die eine Antwort, die sich der Server und jedes
 * Skript des Datenaufbaus teilen.
 *
 * Früher löste jede Datei den Pfad für sich auf. Harmlos war das, solange die
 * Skripte nur aus einem Checkout liefen; mit `bible_setup` war es das nicht
 * mehr. Der Server befolgte BIBLE_DB_PATH, die von ihm gerufenen Skripte
 * schrieben neben den eigenen Quelltext, und eine Bundle-Installation lud
 * damit in ein Verzeichnis, in das niemand sieht. Beide Seiten fragen jetzt
 * hier.
 *
 * Reihenfolge der Auflösung:
 *   1. BIBLE_DB_PATH, sofern nicht leer. Ein im Installationsdialog leer
 *      gelassenes Feld kommt als "" an und zählt nicht als gesetzter Pfad.
 *   2. Ein Datenverzeichnis je Benutzer, wenn der Lauf ein `bun build
 *      --compile`-Binary ist. `import.meta.path` zeigt dann in Buns virtuelles
 *      Dateisystem, das auf der Platte nicht existiert; daran wird der Fall
 *      erkannt, statt Buns internen Pfad fest zu verdrahten. Neben dem Binary
 *      darf die Datenbank nicht liegen: Das Verzeichnis einer installierten
 *      Erweiterung ersetzt der Host beim Update vollständig, und die geladenen
 *      Daten wären still verloren.
 *   3. Das Verzeichnis data/ des Repositories, für einen gewöhnlichen Checkout.
 */

import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { homedir } from "os";

const MODULE_DIR = dirname(import.meta.path);
const APP_DIR = "bibelstudium-mcp";

/** Wo eine paketierte Installation ihre Daten hält, je Plattformkonvention. */
function userDataDir(): string {
  if (process.platform === "darwin") {
    return resolve(homedir(), "Library/Application Support", APP_DIR);
  }
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"]?.trim();
    return appData !== undefined && appData !== ""
      ? resolve(appData, APP_DIR)
      : resolve(homedir(), "AppData/Roaming", APP_DIR);
  }
  const xdg = process.env["XDG_DATA_HOME"]?.trim();
  return xdg !== undefined && xdg !== ""
    ? resolve(xdg, APP_DIR)
    : resolve(homedir(), ".local/share", APP_DIR);
}

/**
 * Wahr für einen Wert, den der Host nicht ersetzt hat, etwa
 * "${user_config.db_path}".
 *
 * Gemessen am 25.07.2026: Claude Desktop reicht den Platzhalter wörtlich
 * durch, wenn ein optionales user_config-Feld leer bleibt, statt eine leere
 * Zeichenkette einzusetzen. Ohne diese Prüfung lief der Download vollständig
 * durch und scheiterte erst beim Schreiben in eine Datei namens
 * "${user_config.db_path}". Die gemeldete SQLite-Meldung („unable to open
 * database file") liest sich dabei wie ein Netzwerkproblem, und genau so wurde
 * sie auch gedeutet.
 */
function isUnresolvedPlaceholder(value: string): boolean {
  return value.includes("${") && value.includes("}");
}

export const DB_PATH = ((): string => {
  const configured = process.env["BIBLE_DB_PATH"]?.trim();
  if (configured !== undefined && configured !== "" && !isUnresolvedPlaceholder(configured)) {
    return configured;
  }
  if (!existsSync(MODULE_DIR)) return resolve(userDataDir(), "bible.db");
  return resolve(MODULE_DIR, "data/bible.db");
})();
