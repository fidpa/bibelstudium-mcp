/**
 * Die Voreinstellung eines Endpunkts: `BIBLE_DEFAULT_TRANSLATION`.
 *
 * Drei Serverprozesse, weil die Variable beim Start ausgewertet wird und drei
 * Zustände zu prüfen sind: gesetzt und geladen, gesetzt als Alias, gesetzt und
 * unbrauchbar. Geprüft wird mit `ELB` und `MB`, nicht mit der Ausgabe, für die
 * der Schalter gebaut wurde: Diese Datei soll auch auf einer selbst aufgebauten
 * Datenbank durchlaufen, und dort gibt es nur die vier frei lizenzierten.
 *
 * Der tragende Fall ist nicht, dass der Schalter wirkt, sondern dass er
 * **überall** wirkt. Am teuersten wäre das Auseinanderlaufen von Verhalten und
 * Selbstauskunft: `tools/list` führt `translation.default`, und ein Client darf
 * daraus einen weggelassenen Wert materialisieren und ihn ausdrücklich senden.
 * Stünde dort ein festes Kürzel, wäre die Einstellung des Endpunkts wirkungslos,
 * ohne dass ein Lauf rot würde (gemessen 06.08.2026, drei Werkzeuge betroffen).
 * Deshalb wird die Selbstauskunft an drei Stellen gegen das Verhalten gehalten.
 *
 * Einzeln lauffähig: `bun run tests/golden/voreinstellung.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, abschluss, type Json } from "../lib/zusicherungen.ts";

export const voreinstellungBuendel = buendel({
  name: "voreinstellung",
  env: { BIBLE_DEFAULT_TRANSLATION: "ELB" },
  calls: {
    ohneAngabe: ["bible_lookup", { book: "Johannes", chapter: 3, verses: "16" }],
    // Eine ausdrückliche Angabe muss unberührt bleiben: Der Schalter verschiebt
    // die Vorgabe, nicht die Auflösung.
    mitAngabe: ["bible_lookup", { book: "Johannes", chapter: 3, verses: "16", translation: "LUT" }],
    serverInfo: ["bible_server_info", {}],
  },
  resources: {
    resUebersetzungen: "bible://uebersetzungen",
  },
  pruefe({ res, ressourcen }, ctx) {
    const { ohneAngabe, mitAngabe, serverInfo } = res;
    const { resUebersetzungen } = ressourcen;

    eq(
      "BIBLE_DEFAULT_TRANSLATION verschiebt die Vorgabe",
      ohneAngabe.json?.translation,
      "Elberfelder 1871"
    );
    eq("ausdrückliche Angabe bleibt unberührt", mitAngabe.json?.translation, "Luther 1912");

    // Drei Selbstauskünfte, alle gegen dasselbe gemessene Verhalten.
    eq(
      "bible://uebersetzungen meldet die wirksame Vorgabe",
      resUebersetzungen!.json?.voreinstellung,
      "ELB"
    );
    eq("bible_server_info meldet die wirksame Vorgabe", serverInfo.json?.voreinstellung, "ELB");
    for (const name of ["bible_lookup", "bible_crossrefs", "bible_search"]) {
      const w = (ctx.toolList as Array<Json>).find((t) => t.name === name);
      const arg = (w?.inputSchema as Json | undefined)?.["properties"] as Json | undefined;
      eq(
        `${name}: inputSchema.default nennt die wirksame Vorgabe`,
        (arg?.["translation"] as Json | undefined)?.["default"],
        "ELB"
      );
    }
  },
});

/** Ein Alias muss ebenso greifen wie ein Kürzel; sonst nähme der Schalter nur die halbe Eingabe an. */
export const voreinstellungAliasBuendel = buendel({
  name: "voreinstellung-alias",
  env: { BIBLE_DEFAULT_TRANSLATION: "menge" },
  calls: {
    aliasOhneAngabe: ["bible_lookup", { book: "Johannes", chapter: 3, verses: "16" }],
  },
  pruefe({ res }) {
    eq("Alias als Vorgabe", res.aliasOhneAngabe.json?.translation, "Menge 1939");
  },
});

/**
 * Ein unbrauchbarer Wert darf den Dienst nicht mitnehmen. Der Rückfall geht auf
 * die eingebaute Ausgabe, nicht auf irgendeine: Ein Endpunkt, der bei einem
 * Tippfehler still eine andere Übersetzung ausliefert, wäre schlimmer als einer,
 * der gar nicht startet.
 */
export const voreinstellungUnbekanntBuendel = buendel({
  name: "voreinstellung-unbekannt",
  env: { BIBLE_DEFAULT_TRANSLATION: "gibtesnicht" },
  calls: {
    unbekanntOhneAngabe: ["bible_lookup", { book: "Johannes", chapter: 3, verses: "16" }],
    unbekanntServerInfo: ["bible_server_info", {}],
  },
  pruefe({ res }) {
    eq(
      "unbrauchbarer Wert fällt auf die eingebaute Ausgabe zurück",
      res.unbekanntOhneAngabe.json?.translation,
      "Luther 1912"
    );
    eq(
      "und die Selbstauskunft nennt den Rückfall, nicht den Wunsch",
      res.unbekanntServerInfo.json?.voreinstellung,
      "LUT"
    );
    check("der Dienst antwortet trotzdem", res.unbekanntOhneAngabe.isError === false);
  },
});

if (import.meta.main) {
  await fahre([
    voreinstellungBuendel,
    voreinstellungAliasBuendel,
    voreinstellungUnbekanntBuendel,
  ]);
  abschluss();
}
