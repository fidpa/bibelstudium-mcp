#!/usr/bin/env bun
/**
 * Build the MCPB bundle (.mcpb) for one-click installation in Claude Desktop.
 *
 * Run:
 *   bun run build:mcpb                    # for the platform you are building on
 *   bun run build:mcpb bun-darwin-x64     # cross-compile for another target
 *
 * The bundle carries a standalone binary produced by `bun build --compile`, so
 * users need no Bun installation. It does NOT carry data/bible.db: the database
 * is ~145 MB, is built locally from the download scripts, and STEPBible asks
 * that their data files not be redistributed. The user picks an existing
 * bible.db during installation; Claude Desktop passes it to the server as
 * BIBLE_DB_PATH (see mcpb/manifest.json and the DB_PATH block in server.ts).
 *
 * A compiled binary is architecture-specific and this script bundles exactly
 * one, so a bundle built here runs on the target it was built for and nowhere
 * else. The manifest's compatibility.platforms is derived from the target
 * rather than claiming all three.
 *
 * Output lands in tmp/ (gitignored) — the binary is 60+ MB and belongs in no
 * repository.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

const ROOT = resolve(dirname(import.meta.path), "..");
const STAGE_DIR = resolve(ROOT, "tmp/mcpb");
const SERVER_DIR = resolve(STAGE_DIR, "server");
// The compiler's scratch file must land outside the staging directory: anything
// left inside it gets packed into the bundle. Running the compiler from the
// staging directory (an earlier attempt at keeping the repository root clean)
// shipped a 63 MB stray binary and doubled the bundle size.
const SCRATCH_DIR = resolve(ROOT, "tmp/build-scratch");

/** Bun compile targets mapped to the platform name the MCPB manifest uses. */
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

// Claude Desktop appends .exe itself on Windows, but the file has to be named
// that way inside the bundle for the binary to be found at all.
const binaryName = platform === "win32" ? "bibelstudium-server.exe" : "bibelstudium-server";

// --- Stage the bundle directory --------------------------------------------
rmSync(STAGE_DIR, { recursive: true, force: true });
rmSync(SCRATCH_DIR, { recursive: true, force: true });
mkdirSync(SERVER_DIR, { recursive: true });
mkdirSync(SCRATCH_DIR, { recursive: true });

console.log(`Compiling server for ${target} …`);
// `bun build --compile` writes its scratch binary into the working directory
// and leaves it behind when the outfile sits on another filesystem. Give it a
// directory of its own, outside both the repository root and the staging tree.
const build = Bun.spawnSync(
  [
    "bun",
    "build",
    "--compile",
    `--target=${target}`,
    resolve(ROOT, "server.ts"),
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

// --- Write the manifest, version taken from package.json --------------------
// Only the fields this script rewrites are typed; everything else in the
// manifest passes through untouched. The source file in mcpb/ is the reference
// for the full schema — `mcpb validate` checks the result against it.
interface Manifest {
  version: string;
  icon?: string;
  server: {
    entry_point: string;
    mcp_config: { command: string };
  };
  compatibility: { platforms: string[] };
  [key: string]: unknown;
}

// Keeping one version number means the bundle can never claim a release the
// repository does not have.
const pkg = (await Bun.file(resolve(ROOT, "package.json")).json()) as { version: string };
const manifest = (await Bun.file(resolve(ROOT, "mcpb/manifest.json")).json()) as Manifest;

manifest.version = pkg.version;
manifest.server.entry_point = `server/${binaryName}`;
manifest.server.mcp_config.command = `\${__dirname}/server/${binaryName}`;
// Derived from the compile target rather than copied: a bundle carries exactly
// one binary and runs on exactly one platform.
manifest.compatibility.platforms = [platform];

const icon = resolve(ROOT, "mcpb/icon.png");
if (existsSync(icon)) {
  writeFileSync(resolve(STAGE_DIR, "icon.png"), await Bun.file(icon).bytes());
  manifest.icon = "icon.png";
}

writeFileSync(resolve(STAGE_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// --- Pack ------------------------------------------------------------------
// The MCPB CLI is a Node package and is not a dependency of this repo; npx
// fetches it on demand so the bundle stays a maintainer-only build step.
// The architecture belongs in the filename because it fits nowhere else: the
// manifest's compatibility.platforms only knows darwin/win32/linux, so an Intel
// Mac would pass that check and fail later on the binary itself, with an error
// from the operating system rather than from this bundle. The name is the only
// warning a user gets before downloading.
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
