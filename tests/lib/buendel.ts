/**
 * Ein Bündel ist die Absicherung eines Werkzeugs: seine Aufrufe und die
 * Zusicherungen darüber, in einer Datei.
 *
 * Warum überhaupt gebündelt wird: Vorher standen alle Aufrufe in einer Liste
 * und wurden positionsweise zerlegt. Wer eine Zusicherung suchte, suchte in
 * 1400 Zeilen, und wer einen Fall einschob, verschob jeden Namen darunter. Ein
 * Bündel benennt seine Aufrufe selbst und trägt nur, was zu ihm gehört.
 *
 * Alle Bündel mit derselben Umgebung laufen in EINEM Serverprozess: Ein Start
 * kostet rund 0,3 Sekunden, und ein Prozess je Bündel wäre eine Vervierfachung
 * der Laufzeit für nichts. Die Fragilität lag nie an der Zahl der Prozesse.
 *
 * Jede Bündeldatei ist trotzdem einzeln lauffähig (`bun run tests/golden/…`),
 * dann mit eigenem Start. Dafür steht ihr Aufruf von `fahre()` hinter
 * `import.meta.main`; ohne das startete jeder Import durch den Aggregator das
 * Bündel sofort mit.
 */
import { callNamed, type Aufruf, type PromptResult, type ResourceResult, type ToolResult } from "./mcp-client.ts";
import { check, lacks, zusicherungen, type Json } from "./zusicherungen.ts";
import { isRecord, schemaErrors } from "../schema-validator.ts";

/**
 * Was der Lauf über sich selbst weiß, für jedes Bündel gleich.
 *
 * Der Kontext gibt es, damit kein Bündel die Aufrufe eines anderen wiederholen
 * muss: Die Selbstauskunft wird einmal geholt. Ein zusätzlicher Aufruf wäre
 * nicht nur Verschwendung, er brächte über die Nachprüfung unten drei weitere
 * Zusicherungen, und eine wachsende Gesamtzahl verdeckt jeden Verlust.
 */
export type Ctx = {
  tools: Json[];
  resourceList: Json[];
  templateList: Json[];
  promptList: Json[];
  /**
   * Das Ergebnis eines fremden Bündels, angesprochen als `buendel.schluessel`.
   *
   * Wirft, wenn es den Schlüssel nicht gibt. Ein `undefined` stattdessen wäre
   * genau der stille Fehler, gegen den der ganze Umbau gerichtet ist: Eine
   * Zusicherung auf einem fehlenden Ergebnis bestünde und bewiese nichts.
   */
  fremd: (pfad: string) => ToolResult;
};

type Ergebnisse<C, P, R> = {
  res: { [K in keyof C]: ToolResult };
  prompts: { [K in keyof P]: PromptResult };
  ressourcen: { [K in keyof R]: ResourceResult };
};

export type Buendel = {
  name: string;
  env: Record<string, string>;
  calls: Record<string, Aufruf>;
  prompts: Record<string, Aufruf>;
  resources: Record<string, string>;
  ohneNachpruefung: boolean;
  pruefe: (
    e: {
      res: Record<string, ToolResult>;
      prompts: Record<string, PromptResult>;
      ressourcen: Record<string, ResourceResult>;
    },
    ctx: Ctx
  ) => void;
};

/**
 * Ein Bündel bauen. Der Umweg über diese Funktion statt eines Objektliterals
 * hat genau einen Grund: Sie hält die Schlüssel der Aufrufe als konkrete
 * Typen fest, so dass `res.joh316` in `pruefe` ein `ToolResult` ist und ein
 * vertippter Schlüssel ein Übersetzungsfehler wird.
 */
export function buendel<
  const C extends Record<string, Aufruf>,
  const P extends Record<string, Aufruf> = Record<string, never>,
  const R extends Record<string, string> = Record<string, never>,
>(spec: {
  name: string;
  calls: C;
  prompts?: P;
  resources?: R;
  /** Umgebung des Serverprozesses. Bündel gleicher Umgebung teilen sich einen. */
  env?: Record<string, string>;
  /**
   * Die Nachprüfung unten auslassen. Nur für die Instanz ohne Datenbank: Dort
   * ist jede Antwort ein Fehler, und `structuredContent` gibt es zu Recht
   * nicht.
   */
  ohneNachpruefung?: boolean;
  pruefe: (e: Ergebnisse<C, P, R>, ctx: Ctx) => void;
}): Buendel {
  return {
    name: spec.name,
    env: spec.env ?? {},
    calls: spec.calls,
    prompts: spec.prompts ?? {},
    resources: spec.resources ?? {},
    ohneNachpruefung: spec.ohneNachpruefung ?? false,
    // Der eine Cast dieses Umbaus: Der allgemeine Typ hat eine Index-Signatur,
    // der spezifische konkrete Felder, und Parameter sind kontravariant.
    pruefe: spec.pruefe as Buendel["pruefe"],
  };
}

/**
 * Die Nachprüfung, die für jede Antwort gilt, gleich welches Bündel sie
 * angefordert hat.
 *
 * Jeder Fall, keine Auswahl von Hand: Ein selten genommener Rückgabepfad, der
 * `structuredContent` vergisst, ist ein harter Client-Fehler, kein fehlendes
 * Feld.
 */
function nachpruefen(
  b: Buendel,
  res: Record<string, ToolResult>,
  schemaOf: Map<string, Json | undefined>
): number {
  let geprueft = 0;
  for (const [schluessel, r] of Object.entries(res)) {
    const name = b.calls[schluessel]![0];
    if (r.isError) {
      check(`${name} #${schluessel}: Fehlerantwort ohne structuredContent`, r.structured === null);
      continue;
    }
    // Kein Schema: entweder ein Werkzeug, das noch keines deklariert, oder der
    // Aufruf eines Werkzeugs, das es nicht gibt, dessen Abweisung ein
    // JSON-RPC-Fehler ist und daher kein zu prüfendes Ergebnis trägt. Beides
    // wird an anderer Stelle geprüft.
    const schema = schemaOf.get(name);
    if (schema === undefined) continue;
    check(`${name} #${schluessel}: structuredContent vorhanden`, r.structured !== null);
    if (r.structured === null) continue;
    check(
      `${name} #${schluessel}: structuredContent gleich Textblock`,
      JSON.stringify(r.structured) === JSON.stringify(r.json)
    );
    const fehler = schemaErrors(schema, r.structured);
    check(`${name} #${schluessel}: schemagültig`, fehler.length === 0, fehler.slice(0, 3).join("; "));
    geprueft++;
  }
  return geprueft;
}

/**
 * Alle Bündel fahren: nach Umgebung gruppiert, je Gruppe ein Serverprozess.
 *
 * Die Schlüssel werden für den Lauf mit dem Bündelnamen versehen, damit zwei
 * Bündel denselben sprechenden Namen vergeben dürfen, ohne einander zu
 * überschreiben.
 */
export async function fahre(buendel: Buendel[]): Promise<Map<string, ToolResult>> {
  const gruppen = new Map<string, Buendel[]>();
  for (const b of buendel) {
    const schluessel = JSON.stringify(b.env);
    const liste = gruppen.get(schluessel);
    if (liste === undefined) gruppen.set(schluessel, [b]);
    else liste.push(b);
  }

  // Zwei Bündel könnten denselben Namen tragen, und sie überschrieben einander
  // im zusammengeführten Aufrufverzeichnis: Beide läsen dann dieselben
  // Antworten und blieben womöglich grün. Ein Punkt im Namen erzeugt dieselbe
  // Kollision, weil der Schlüssel `name.aufruf` lautet.
  const namen = new Set<string>();
  for (const b of buendel) {
    if (b.name.includes(".")) throw new Error(`Bündelname enthält einen Punkt: "${b.name}"`);
    if (namen.has(b.name)) throw new Error(`Zwei Bündel heißen "${b.name}"`);
    namen.add(b.name);
  }

  const alleErgebnisse = new Map<string, ToolResult>();
  const alleRessourcen: ResourceResult[] = [];
  let geprueftGesamt = 0;
  // Wie viele Antworten in diesem Lauf überhaupt nachprüfbar sind. Ohne diese
  // Zahl schlüge die Zusicherung unten im Einzellauf zweier Bündel fehl, die
  // rechtmäßig keine schemabehaftete Antwort haben, und ein roter Einzellauf
  // ohne Fehler ist genau die Rückmeldung, die der Schnitt herstellen sollte.
  let nachpruefbar = 0;

  for (const [envJson, gruppe] of gruppen) {
    const calls: Record<string, Aufruf> = {};
    const prompts: Record<string, Aufruf> = {};
    const resources: Record<string, string> = {};
    for (const b of gruppe) {
      for (const [k, v] of Object.entries(b.calls)) calls[`${b.name}.${k}`] = v;
      for (const [k, v] of Object.entries(b.prompts)) prompts[`${b.name}.${k}`] = v;
      for (const [k, v] of Object.entries(b.resources)) resources[`${b.name}.${k}`] = v;
    }
    const lauf = await callNamed(calls, prompts, resources, JSON.parse(envJson) as Record<string, string>);
    const schemaOf = new Map<string, Json | undefined>(
      lauf.tools.map((t) => [String(t.name), isRecord(t.outputSchema) ? t.outputSchema : undefined])
    );
    const ctx: Ctx = {
      tools: lauf.tools,
      resourceList: lauf.resourceList,
      templateList: lauf.templateList,
      promptList: lauf.promptList,
      fremd: (pfad) => {
        const r = alleErgebnisse.get(pfad);
        if (r === undefined) {
          throw new Error(
            `Kein Ergebnis unter "${pfad}". Erwartet wird "buendel.schluessel", und das Bündel ` +
              "muss vor diesem gefahren werden."
          );
        }
        return r;
      },
    };

    for (const b of gruppe) {
      const eigen = <T>(quelle: Record<string, T>, keys: string[]): Record<string, T> =>
        Object.fromEntries(keys.map((k) => [k, quelle[`${b.name}.${k}`] as T]));
      const res = eigen(lauf.results as Record<string, ToolResult>, Object.keys(b.calls));
      const ressourcen = eigen(
        lauf.resourceResults as Record<string, ResourceResult>,
        Object.keys(b.resources)
      );
      alleRessourcen.push(...Object.values(ressourcen));
      for (const [k, v] of Object.entries(res)) alleErgebnisse.set(`${b.name}.${k}`, v);
      const vorher = zusicherungen();
      if (!b.ohneNachpruefung) {
        nachpruefbar += Object.values(b.calls).filter(
          ([werkzeug]) => schemaOf.get(werkzeug) !== undefined
        ).length;
        geprueftGesamt += nachpruefen(b, res, schemaOf);
      }
      b.pruefe(
        {
          res,
          prompts: eigen(lauf.promptResults as Record<string, PromptResult>, Object.keys(b.prompts)),
          ressourcen,
        },
        ctx
      );
      console.log(`  ${b.name}: ${zusicherungen() - vorher}`);
    }
  }

  // Der Endpunkt ist öffentlich und authlos: Keine Ressource meldet
  // Host-Details. Die Prüfung steht hier und nicht im Ressourcen-Bündel, weil
  // sie für **jede** gelesene Ressource gilt, gleich welches Bündel sie
  // angefordert hat. Im Bündel deckte sie nur dessen eigene ab, und der
  // Heuhaufen schrumpfte still, sobald eine Ressource woandershin wandert.
  if (alleRessourcen.length > 0) {
    const allerText = alleRessourcen.map((r) => r.text).join("\n");
    for (const verboten of ["/home/", "/Users/", "process", "uptime", "hostname"]) {
      lacks(`keine Host-Angabe: ${verboten}`, allerText, verboten);
    }
  }

  // Eine Zählung, die nie zustande kommt, wäre eine bestandene leere Prüfung.
  // Gestellt wird die Frage nur, wo es etwas zu zählen gab: `uebergreifend`
  // ruft allein ein Werkzeug auf, das es nicht gibt, `ohne-datenbank` läuft
  // ohne Nachprüfung, und beide sollen einzeln grün sein.
  if (nachpruefbar > 0) {
    check("mindestens ein Fall schemageprüft", geprueftGesamt > 0, `geprüft: ${geprueftGesamt}`);
  }
  return alleErgebnisse;
}
