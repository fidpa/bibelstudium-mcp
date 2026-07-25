#!/usr/bin/env bun
/**
 * Build the database from inside the server, so a user who installed the MCPB
 * bundle never has to open a terminal.
 *
 * Run standalone:
 *   bun run setup
 *
 * The steps are the same downloads the package.json aliases expose, in the same
 * order, each one importing the script's main() rather than spawning it: a
 * compiled binary has neither Bun nor the scripts on disk to spawn.
 *
 * Partial failure is expected and handled. Every download works on a private
 * copy of the database and swaps it in atomically, so a step that fails leaves
 * the previous state untouched and cannot corrupt what earlier steps wrote.
 * Only the first step is required — without verses there is no database at all,
 * and the later steps have nothing to attach their data to. Everything after it
 * is optional: if a source is unreachable, that step is recorded as failed, the
 * remaining steps still run, and the report names which capability is missing
 * and how to add it later.
 */

import { main as downloadVerses } from "./download.ts";
import { main as downloadByzantine } from "./download-byz.ts";
import { main as downloadSblgnt } from "./download-morph.ts";
import { main as downloadTextusReceptus } from "./download-tr.ts";
import { main as downloadHebrew } from "./download-heb.ts";
import { main as downloadCrossrefs } from "./download-crossrefs.ts";
import { main as downloadTagnt } from "./download-tagnt.ts";
import { main as downloadLexicon } from "./download-lexicon.ts";

/** What one step contributes, and what is lost when it fails. */
export interface SetupStep {
  readonly id: string;
  readonly label: string;
  /** Required steps abort the run; optional ones only record their failure. */
  readonly required: boolean;
  /** Named in the report when the step fails, so the gap is concrete. */
  readonly provides: string;
  readonly command: string;
  readonly run: () => Promise<void>;
}

export const SETUP_STEPS: readonly SetupStep[] = [
  {
    id: "verses",
    label: "Deutsche Übersetzungen",
    required: true,
    provides: "der gesamte deutsche Bibeltext (bible_lookup, bible_search)",
    command: "bun run download",
    run: () => downloadVerses("all"),
  },
  {
    id: "byzantine",
    label: "Griechisch: Mehrheitstext",
    required: false,
    provides: "der griechische Grundtext in der Voreinstellung (bible_original)",
    command: "bun run download:byz",
    run: downloadByzantine,
  },
  {
    id: "sblgnt",
    label: "Griechisch: SBLGNT",
    required: false,
    provides: "die kritische Edition im Editionsvergleich (bible_compare)",
    command: "bun run download:sblgnt",
    run: downloadSblgnt,
  },
  {
    id: "tr",
    label: "Griechisch: Textus Receptus",
    required: false,
    provides: "der Textus Receptus, die einzige Edition mit dem Comma Johanneum",
    command: "bun run download:tr",
    run: downloadTextusReceptus,
  },
  {
    id: "wlc",
    label: "Hebräisch: Westminster Leningrad Codex",
    required: false,
    provides: "der hebräische Grundtext des Alten Testaments (bible_original)",
    command: "bun run download:heb",
    run: downloadHebrew,
  },
  {
    id: "crossrefs",
    label: "Querverweise",
    required: false,
    provides: "die Querverweise (bible_crossrefs)",
    command: "bun run download:crossrefs",
    run: downloadCrossrefs,
  },
  {
    id: "tagnt",
    label: "Bezeugung über acht Editionen",
    required: false,
    provides: "die Bezeugung und die Quellenkonflikte in bible_compare",
    command: "bun run download:tagnt",
    run: downloadTagnt,
  },
  {
    id: "lexicon",
    label: "Lexika",
    required: false,
    provides: "Glossen und Wörterbucheinträge in bible_concordance",
    command: "bun run download:lexicon",
    run: downloadLexicon,
  },
] as const;

export interface StepResult {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly seconds: number;
  /** Present only on failure. */
  readonly error?: string;
  readonly provides?: string;
  readonly command?: string;
}

export interface SetupReport {
  readonly complete: boolean;
  /** True when the required step failed and nothing usable was built. */
  readonly aborted: boolean;
  readonly steps: readonly StepResult[];
  readonly seconds: number;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Keep it to one line: the report is read inside a chat answer, and a stack
  // trace there buries the sentence that says which source was unreachable.
  return message.split("\n")[0] ?? message;
}

/**
 * Run all steps in order and report what succeeded.
 *
 * `onProgress` is called before each step so a caller can stream status; the
 * server uses it for its log, and the standalone run for the console.
 */
export async function runSetup(
  onProgress?: (label: string, index: number, total: number) => void,
  steps: readonly SetupStep[] = SETUP_STEPS
): Promise<SetupReport> {
  const started = Date.now();
  const results: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    onProgress?.(step.label, i + 1, steps.length);

    const stepStarted = Date.now();
    try {
      await step.run();
      results.push({
        id: step.id,
        label: step.label,
        ok: true,
        seconds: (Date.now() - stepStarted) / 1000,
      });
    } catch (error) {
      results.push({
        id: step.id,
        label: step.label,
        ok: false,
        seconds: (Date.now() - stepStarted) / 1000,
        error: describeError(error),
        provides: step.provides,
        command: step.command,
      });
      if (step.required) {
        return {
          complete: false,
          aborted: true,
          steps: results,
          seconds: (Date.now() - started) / 1000,
        };
      }
    }
  }

  return {
    complete: results.every((r) => r.ok),
    aborted: false,
    steps: results,
    seconds: (Date.now() - started) / 1000,
  };
}

if (import.meta.main) {
  const report = await runSetup((label, i, total) => {
    console.log(`\n[${i}/${total}] ${label}`);
  });

  console.log("\n=== Ergebnis ===");
  for (const r of report.steps) {
    const mark = r.ok ? "ok  " : "FEHL";
    console.log(`${mark} ${r.label} (${r.seconds.toFixed(1)}s)`);
    if (!r.ok) {
      console.log(`     ${r.error}`);
      console.log(`     Fehlt dadurch: ${r.provides}`);
      console.log(`     Nachholen mit: ${r.command}`);
    }
  }
  console.log(`\nGesamt: ${report.seconds.toFixed(1)}s`);

  if (report.aborted) {
    console.error("\nAbgebrochen: ohne die Übersetzungen gibt es keine Datenbank.");
    process.exit(1);
  }
}
