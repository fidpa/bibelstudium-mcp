/**
 * Regressionsprüfung der Serverkorrektheit: alle Bündel auf einmal.
 *
 * Spricht über stdio mit einem FRISCHEN `server.ts` und misst damit nie die
 * womöglich veraltete MCP-Instanz einer laufenden Editorsitzung.
 *
 * Aufgebaut aus Zusicherungen statt aus einem abgelegten Schnappschuss: Die
 * Erwartungen bleiben als Aussagen über die Daten lesbar („Psalm 23,1 hat sechs
 * Wörter", „das Comma steht nur im TR"), statt eine Textwand zu sein, die
 * niemand von Hand vergleicht.
 *
 * Diese Datei selbst prüft nichts. Sie sammelt die Bündel aus `golden/` ein und
 * fährt sie; was geprüft wird, steht dort, je Werkzeug in einer Datei. Jedes
 * Bündel läuft auch allein (`bun run tests/golden/lookup.ts`), dann mit eigenem
 * Serverstart. Hier teilen sich alle einen, bis auf die Instanz ohne Datenbank,
 * die ihre eigene Umgebung braucht.
 *
 * Braucht eine gebaute Datenbank, die CI kann den Test deshalb nicht ausführen
 * (dem Workflow fehlen die Daten). Lokal nach jeder Änderung an server.ts:
 *
 *   bun run test
 */
import { fahre } from "./lib/buendel.ts";
import { abschluss } from "./lib/zusicherungen.ts";

import { serverInfoBuendel } from "./golden/server-info.ts";
import { originalBuendel } from "./golden/original.ts";
import { compareBuendel } from "./golden/compare.ts";
import { crossrefsBuendel } from "./golden/crossrefs.ts";
import { concordanceBuendel } from "./golden/concordance.ts";
import { searchBuendel } from "./golden/search.ts";
import { lookupBuendel } from "./golden/lookup.ts";
import { promptsBuendel } from "./golden/prompts.ts";
import { ressourcenBuendel } from "./golden/ressourcen.ts";
import { wortlautGrenzeBuendel } from "./golden/wortlaut-grenze.ts";
import { uebergreifendBuendel } from "./golden/uebergreifend.ts";
import { ohneDatenbankBuendel } from "./golden/ohne-datenbank.ts";

/**
 * Die Reihenfolge ist nicht beliebig: Ein Bündel, das über `ctx.fremd` das
 * Ergebnis eines anderen liest, muss nach ihm stehen. `server-info` steht
 * deshalb vorn, `lookup` vor `ressourcen`.
 */
await fahre([
  serverInfoBuendel,
  originalBuendel,
  compareBuendel,
  crossrefsBuendel,
  concordanceBuendel,
  searchBuendel,
  lookupBuendel,
  promptsBuendel,
  ressourcenBuendel,
  wortlautGrenzeBuendel,
  uebergreifendBuendel,
  ohneDatenbankBuendel,
]);

/**
 * Die Mindestzahl ist ein Wächter und keine Zusicherung. Fiele ein Bündel aus
 * der Liste oben, sänke die Summe, ohne dass eine einzige Prüfung fehlschlüge:
 * ein grüner Lauf mit weniger Prüfungen sieht aus wie ein grüner Lauf. Die Zahl
 * ist der gemessene Stand und wird angehoben, wenn Zusicherungen hinzukommen.
 * Sie hängt am geladenen Bestand: Ohne die Ausgabe mit Apparat entfallen die
 * Fußnotenfälle.
 */
abschluss(475);
