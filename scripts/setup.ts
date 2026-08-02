#!/usr/bin/env bun
/**
 * Baut die Datenbank aus dem Server heraus auf, damit niemand, der das
 * MCPB-Bundle installiert hat, je ein Terminal öffnen muss.
 *
 * Eigenständiger Aufruf:
 *   bun run setup
 *
 * Die Schritte sind dieselben Downloads, die die package.json-Aliase anbieten,
 * in derselben Reihenfolge, jeder über einen Import der main() des Skripts
 * statt über einen eigenen Prozess: Ein kompiliertes Binary hat weder Bun noch
 * die Skripte auf der Platte, um einen zu starten.
 *
 * Ein Teilfehler ist vorgesehen und behandelt. Jeder Download arbeitet auf
 * einer eigenen Kopie der Datenbank und wechselt sie atomar ein; ein
 * gescheiterter Schritt lässt den bisherigen Stand also unberührt und kann
 * nicht beschädigen, was frühere Schritte geschrieben haben. Erforderlich ist
 * allein der erste Schritt: Ohne Verse gibt es überhaupt keine Datenbank, und
 * die späteren Schritte hätten nichts, woran sie ihre Daten hängen. Alles
 * danach ist optional. Ist eine Quelle nicht erreichbar, wird der Schritt als
 * gescheitert vermerkt, die übrigen laufen weiter, und der Bericht benennt,
 * welche Fähigkeit fehlt und wie sie sich nachholen lässt.
 */

import { main as downloadVerses } from "./download.ts";
import { main as downloadByzantine } from "./download-byz.ts";
import { main as downloadSblgnt } from "./download-morph.ts";
import { main as downloadTextusReceptus } from "./download-tr.ts";
import { main as downloadHebrew } from "./download-heb.ts";
import { main as downloadCrossrefs } from "./download-crossrefs.ts";
import { main as downloadTagnt } from "./download-tagnt.ts";
import { main as downloadLexicon } from "./download-lexicon.ts";

/** Was ein Schritt beiträgt, und was fehlt, wenn er scheitert. */
export interface SetupStep {
  readonly id: string;
  readonly label: string;
  /** Erforderliche Schritte brechen den Lauf ab, optionale vermerken nur ihr Scheitern. */
  readonly required: boolean;
  /** Steht im Bericht, wenn der Schritt scheitert, damit die Lücke benannt ist. */
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
  /** Nur im Fehlerfall gesetzt. */
  readonly error?: string;
  readonly provides?: string;
  readonly command?: string;
}

export interface SetupReport {
  readonly complete: boolean;
  /** Wahr, wenn der erforderliche Schritt scheiterte und nichts Brauchbares entstand. */
  readonly aborted: boolean;
  readonly steps: readonly StepResult[];
  readonly seconds: number;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Auf eine Zeile beschränken: Der Bericht wird in einer Chat-Antwort gelesen,
  // und ein Stacktrace begräbt dort den Satz, der die unerreichbare Quelle nennt.
  return message.split("\n")[0] ?? message;
}

/**
 * Führt alle Schritte der Reihe nach aus und berichtet, was geglückt ist.
 *
 * `onProgress` wird vor jedem Schritt gerufen, damit ein Aufrufer den Stand
 * mitschreiben kann: Der Server nutzt das für sein Protokoll, der eigenständige
 * Lauf für die Konsole.
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
