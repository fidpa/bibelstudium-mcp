#!/usr/bin/env bun
/**
 * Baut das MCPB-Bundle (.mcpb) für die Installation mit einem Klick in Claude
 * Desktop.
 *
 * Aufruf:
 *   bun run build:mcpb                    # für die Plattform, auf der gebaut wird
 *   bun run build:mcpb bun-darwin-x64     # Übersetzung für ein anderes Ziel
 *
 * Das Bundle trägt ein eigenständiges Binary aus `bun build --compile`, eine
 * Bun-Installation braucht also niemand. Die data/bible.db trägt es NICHT: Die
 * Datenbank ist rund 145 MB groß, entsteht lokal aus den Download-Skripten, und
 * STEPBible bittet darum, die eigenen Dateien nicht weiterzuverbreiten. Der
 * Nutzer wählt bei der Installation eine vorhandene bible.db; Claude Desktop
 * reicht sie dem Server als BIBLE_DB_PATH weiter (siehe mcpb/manifest.json und
 * den DB_PATH-Abschnitt in server.ts).
 *
 * Ein kompiliertes Binary ist architekturspezifisch, und dieses Skript packt
 * genau eines ein; ein hier gebautes Bundle läuft also auf dem Ziel, für das es
 * gebaut wurde, und sonst nirgends. compatibility.platforms im Manifest wird
 * deshalb aus dem Ziel abgeleitet, statt alle drei zu behaupten.
 *
 * Das Ergebnis landet in tmp/ (gitignored): Das Binary ist über 60 MB groß und
 * gehört in kein Repository.
 */

import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

const ROOT = resolve(dirname(import.meta.path), "..");
const STAGE_DIR = resolve(ROOT, "tmp/mcpb");
const SERVER_DIR = resolve(STAGE_DIR, "server");
// Die Arbeitsdatei des Compilers muss außerhalb des Staging-Verzeichnisses
// landen: Was dort liegen bleibt, wandert mit ins Bundle. Den Compiler aus dem
// Staging-Verzeichnis heraus laufen zu lassen (ein früherer Versuch, das
// Repository-Wurzelverzeichnis sauber zu halten) legte ein verirrtes Binary von
// 63 MB bei und verdoppelte die Bundle-Größe.
const SCRATCH_DIR = resolve(ROOT, "tmp/build-scratch");

/** Compile-Ziele von Bun, abgebildet auf den Plattformnamen des MCPB-Manifests. */
const TARGET_PLATFORMS: Readonly<Record<string, string>> = {
  "bun-darwin-arm64": "darwin",
  "bun-darwin-x64": "darwin",
  "bun-windows-x64": "win32",
  "bun-linux-x64": "linux",
  "bun-linux-arm64": "linux",
};

function localTarget(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `bun-${platform}-${arch}`;
}

const target = process.argv[2] ?? localTarget();
const platform = TARGET_PLATFORMS[target];
if (platform === undefined) {
  console.error(
    `Unknown compile target '${target}'. Known targets: ${Object.keys(TARGET_PLATFORMS).join(", ")}`
  );
  process.exit(1);
}

// Claude Desktop hängt unter Windows selbst ein .exe an; im Bundle muss die
// Datei aber so heißen, damit das Binary überhaupt gefunden wird.
const binaryName = platform === "win32" ? "bibelstudium-server.exe" : "bibelstudium-server";

// --- Bundle-Verzeichnis herrichten ------------------------------------------
rmSync(STAGE_DIR, { recursive: true, force: true });
rmSync(SCRATCH_DIR, { recursive: true, force: true });
mkdirSync(SERVER_DIR, { recursive: true });
mkdirSync(SCRATCH_DIR, { recursive: true });

console.log(`Compiling server for ${target} …`);
// `bun build --compile` legt sein Arbeits-Binary im Arbeitsverzeichnis ab und
// lässt es liegen, wenn die Zieldatei auf einem anderen Dateisystem sitzt. Es
// bekommt deshalb ein eigenes Verzeichnis, außerhalb des Repository-Wurzel-
// verzeichnisses wie des Staging-Baums.
const build = Bun.spawnSync(
  [
    "bun",
    "build",
    "--compile",
    `--target=${target}`,
    resolve(ROOT, "src/server.ts"),
    "--outfile",
    resolve(SERVER_DIR, binaryName),
  ],
  { cwd: SCRATCH_DIR }
);
rmSync(SCRATCH_DIR, { recursive: true, force: true });
if (build.exitCode !== 0) {
  console.error(new TextDecoder().decode(build.stderr));
  console.error("bun build --compile failed.");
  process.exit(1);
}

// --- Manifest schreiben, Version aus package.json ---------------------------
// Typisiert sind nur die Felder, die dieses Skript neu schreibt; alles Übrige
// im Manifest geht unverändert durch. Maßgeblich für das vollständige Schema ist
// die Quelldatei in mcpb/, und `mcpb validate` prüft das Ergebnis dagegen.
interface Manifest {
  version: string;
  server: {
    entry_point: string;
    mcp_config: { command: string };
  };
  compatibility: { platforms: string[] };
  [key: string]: unknown;
}

// Eine einzige Versionsnummer heißt: Das Bundle kann nie eine Fassung
// behaupten, die es im Repository nicht gibt.
const pkg = (await Bun.file(resolve(ROOT, "package.json")).json()) as { version: string };
const manifest = (await Bun.file(resolve(ROOT, "mcpb/manifest.json")).json()) as Manifest;

manifest.version = pkg.version;
manifest.server.entry_point = `server/${binaryName}`;
manifest.server.mcp_config.command = `\${__dirname}/server/${binaryName}`;
// Aus dem Compile-Ziel abgeleitet statt übernommen: Ein Bundle trägt genau ein
// Binary und läuft auf genau einer Plattform.
manifest.compatibility.platforms = [platform];

writeFileSync(resolve(STAGE_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// --- Packen -----------------------------------------------------------------
// Das MCPB-CLI ist ein Node-Paket und keine Abhängigkeit dieses Repositories;
// npx holt es bei Bedarf, damit das Bauen des Bundles ein Schritt allein für die
// Betreuerseite bleibt.
// Die Architektur gehört in den Dateinamen, weil sie sonst nirgends Platz hat:
// compatibility.platforms im Manifest kennt nur darwin/win32/linux, ein
// Intel-Mac bestünde diese Prüfung also und scheiterte erst am Binary selbst,
// mit einer Meldung des Betriebssystems statt einer dieses Bundles. Der Name ist
// die einzige Warnung, die ein Nutzer vor dem Herunterladen bekommt.
const arch = target.replace(/^bun-[^-]+-/, "");
const outFile = resolve(ROOT, `tmp/bibelstudium-mcp-${pkg.version}-${platform}-${arch}.mcpb`);
console.log("Packing bundle …");
const pack = Bun.spawnSync(["npx", "--yes", "@anthropic-ai/mcpb@latest", "pack", STAGE_DIR, outFile], {
  stdout: "inherit",
  stderr: "pipe",
});
if (pack.exitCode !== 0) {
  console.error(new TextDecoder().decode(pack.stderr));
  console.error(
    "mcpb pack failed. It needs Node/npx on PATH — install Node.js, or run " +
      `'npx @anthropic-ai/mcpb pack ${STAGE_DIR}' by hand.`
  );
  process.exit(1);
}

console.log(`\nBundle: ${outFile}`);
console.log("Install: Claude Desktop › Einstellungen › Extensions › Advanced settings ›");
console.log("         Extension Developer › Install Extension…");
