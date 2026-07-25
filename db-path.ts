/**
 * Where the database lives — the one answer shared by the server and every
 * data-building script.
 *
 * This used to be resolved separately in each file, which was harmless while the
 * scripts only ever ran from a checkout. It stopped being harmless when the
 * server gained bible_setup: the server would honour BIBLE_DB_PATH while the
 * scripts it calls wrote next to their own source, so a bundle install would
 * download into a directory nobody reads. Both sides now ask here.
 *
 * Resolution order:
 *   1. BIBLE_DB_PATH, when set to a non-empty value. An entry left blank in an
 *      installer dialog arrives as "" and must not count as a configured path.
 *   2. A per-user data directory, when running as a `bun build --compile`
 *      binary. `import.meta.path` then points into Bun's virtual filesystem,
 *      which does not exist on disk — that is how the case is detected, rather
 *      than by hardcoding Bun's internal path. The database must not live next
 *      to the binary: an installed bundle sits in a directory the host replaces
 *      wholesale on update, which would silently discard the downloaded data.
 *   3. The repository's data/ directory, for an ordinary checkout.
 */

import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { homedir } from "os";

const MODULE_DIR = dirname(import.meta.path);
const APP_DIR = "bibelstudium-mcp";

/** Where a packaged install keeps its data, per platform convention. */
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
 * True for a value the host left unsubstituted, e.g. "${user_config.db_path}".
 *
 * Measured on 25.07.2026: Claude Desktop passes the literal placeholder through
 * when an optional user_config field is left empty, rather than substituting an
 * empty string. Without this check the download ran to completion and then
 * failed writing to a file called "${user_config.db_path}" — and the reported
 * SQLite error ("unable to open database file") reads like a network problem,
 * which is exactly how it was misdiagnosed.
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
