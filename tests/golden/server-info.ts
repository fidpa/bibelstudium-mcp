/**
 * `bible_server_info`: was der Server über sich selbst sagt.
 *
 * Das Werkzeug gibt es, weil der Handshake das Modell nicht erreicht: Version
 * und `instructions` stehen im `initialize`, blieben im Chat aber unsichtbar.
 * Ein Werkzeugergebnis ist der einzige Kanal, den ein Modell sicher sieht.
 *
 * Einzeln lauffähig: `bun run tests/golden/server-info.ts`
 */
import packageJson from "../../package.json";
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, lacks, abschluss, type Json } from "../lib/zusicherungen.ts";
import { db } from "../../src/db.ts";

export const serverInfoBuendel = buendel({
  name: "server-info",
  calls: {
    serverInfo: ["bible_server_info", {}],
  },
  pruefe({ res }) {
    const { serverInfo } = res;
    const j = serverInfo.json as Json;
    // Gegen den einen Fehler, dessentwegen es dieses Werkzeug gibt: eine Version,
    // die an zweiter Stelle gepflegt wird. Verglichen wird gegen package.json,
    // nicht gegen ein Literal an dieser Stelle.
    eq("version == package.json", j?.version, packageJson.version);
    eq("kein Fehler", serverInfo.isError, false);
    const geladen = j?.uebersetzungen as
      | Array<{ code: string; name: string; lizenz?: unknown; nennung?: unknown; verse_max?: unknown }>
      | undefined;
    check("Übersetzungen gelistet", Array.isArray(geladen) && geladen.length > 0);
    // Jeder Name muss seine Jahreszahl tragen: „Schlachter" allein bezeichnet
    // keinen Text, und 1951 weicht im Wortlaut von 2000 ab.
    for (const t of geladen ?? []) {
      check(`${t.code}: Jahreszahl im Namen`, /\d{4}/.test(t.name), `war "${t.name}"`);
      // Die drei Bedingungen, unter denen eine Ausgabe benutzt wird. Sie fehlen
      // nur bei einem Kürzel, das die Registry nicht kennt; hier ist jedes
      // geladene Kürzel aus der Registry, also müssen sie dastehen. `nennung`
      // und `verse_max` dürfen null sein, das ist die Aussage „keine Nennung
      // verlangt" bzw. „keine Grenze", und `undefined` ist sie gerade nicht.
      check(
        `${t.code}: Lizenz genannt`,
        typeof t.lizenz === "string" && t.lizenz.length > 0,
        `war ${JSON.stringify(t.lizenz)}`
      );
      check(
        `${t.code}: nennung Zeichenkette oder null`,
        typeof t.nennung === "string" || t.nennung === null,
        `war ${JSON.stringify(t.nennung)}`
      );
      check(
        `${t.code}: verse_max Zahl oder null`,
        typeof t.verse_max === "number" || t.verse_max === null,
        `war ${JSON.stringify(t.verse_max)}`
      );
    }
    // Die Grenze, die ein Aufrufer vor dem Abruf kennen muss, an der Ausgabe, für
    // die sie gilt: Stünde hier null, hätte die Selbstauskunft die Zusage
    // stillschweigend aufgehoben, während die Werkzeuge weiter kürzen.
    const sch = (geladen ?? []).find((t) => t.code === "SCH");
    eq("SCH: verse_max ist die zugesagte Zahl", sch?.verse_max, 20);
    const editionen = j?.urtext_editionen as Array<{ code: string; name: string }> | undefined;
    has("Urtext: Mehrheitstext", JSON.stringify(editionen), "byzantine");
    has("Urtext: AT (WLC)", JSON.stringify(editionen), "wlc");
    // Jede Edition muss einen aufgelösten Namen tragen: „tr" allein bezeichnet
    // keinen Text, und name === code heißt, der Rückfall in EDITION_META hat still
    // übernommen.
    for (const e of editionen ?? []) {
      check(
        `${e.code}: Name aufgeloest`,
        typeof e.name === "string" && e.name.length > 0 && e.name !== e.code,
        `war "${e.name}"`
      );
    }
    const zusatz = (j?.zusatzdaten ?? {}) as Record<string, unknown>;
    for (const key of [
      "strong_lexikon",
      "strong_lexikon_vollstaendig",
      "editionsbezeugung",
      "querverweise",
      "volltextsuche",
    ]) {
      check(`zusatzdaten.${key} ist bool`, typeof zusatz[key] === "boolean");
    }
    // Die Sprachangabe hängt am Bestand: Ohne Lexikon gibt es nichts, dessen
    // Sprache zu nennen wäre. Mit Lexikon ist sie englisch, und zwar aus beiden
    // Quellen (Strong und STEPBible); „en" ist deshalb kein Vorgabewert, sondern
    // die gemessene Eigenschaft der Einträge.
    eq(
      "strong_lexikon_sprache genau dann, wenn es ein Lexikon gibt",
      zusatz["strong_lexikon_sprache"],
      zusatz["strong_lexikon"] === true ? "en" : undefined
    );

    // Der Kanonumfang stand bis 0.6.12 allein in der Fehlermeldung nach einem
    // Fehlgriff. Die Zahl kommt aus der Tabelle, nicht aus einem Literal im
    // Server; 66 ist die Gegenprobe gegen eine halb aufgebaute Datenbank.
    const kanon = (j?.kanon ?? {}) as Record<string, unknown>;
    eq("kanon: 66 Bücher", kanon["buecher"], 66);
    has("kanon: Apokryphen ausdrücklich ausgenommen", String(kanon["umfang"]), "Apokryphen");

    // Das Datum des Bestands, gegen die Herkunftstabelle nachgerechnet statt gegen
    // ein Literal: Ein Literal veraltete beim nächsten Download, und eine reine
    // Formprüfung ließe jedes andere gültige Datum durch. Genau das war die Lücke:
    // Ein Einbau, der hier ein festes Datum einsetzte, blieb grün (07.08.2026).
    // Die Tabelle ist optional, älteren Aufbauten fehlt sie; dann fehlt auch das
    // Feld, und diese Übereinstimmung ist die Aussage.
    {
      const hat =
        db
          .query("SELECT name FROM sqlite_master WHERE type='table' AND name='provenance'")
          .get() !== null;
      const zeile = hat
        ? (db.query("SELECT MAX(fetched_at) AS t FROM provenance").get() as { t: string | null })
        : null;
      const erwartet = zeile?.t ? zeile.t.slice(0, 10) : undefined;
      eq("daten_stand ist der jüngste vermerkte Abruf", j?.daten_stand, erwartet);
    }

    lacks("keine Verszahl", serverInfo.text, "verse_gesamt");
    // Bis zum 06.08.2026 stand hier ein einzelnes `lacks(…, "/opt/")` unter der
    // Überschrift „kein Pfad". Es konnte nicht fehlschlagen: Die Datenbank liegt
    // in der Entwicklung unter `/home/`, in der Erweiterung unter
    // `~/.local/share/`, und `/opt/` kommt auf keiner der beiden Maschinen vor.
    // Leckte `bible_server_info` seinen Datenbankpfad, ginge die Zusicherung
    // durch. Geprüft wird jetzt dieselbe Liste, die `tests/lib/buendel.ts` über
    // die Ressourcen legt; dort deckte sie den Werkzeugkanal nicht mit ab.
    for (const verboten of ["/home/", "/Users/", "/opt/", "process", "uptime", "hostname"]) {
      lacks(`keine Host-Angabe: ${verboten}`, serverInfo.text, verboten);
    }
  },
});

if (import.meta.main) {
  await fahre([serverInfoBuendel]);
  abschluss();
}
