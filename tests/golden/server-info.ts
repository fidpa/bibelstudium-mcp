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
    const geladen = j?.uebersetzungen as Array<{ code: string; name: string }> | undefined;
    check("Übersetzungen gelistet", Array.isArray(geladen) && geladen.length > 0);
    // Jeder Name muss seine Jahreszahl tragen: „Schlachter" allein bezeichnet
    // keinen Text, und 1951 weicht im Wortlaut von 2000 ab.
    for (const t of geladen ?? []) {
      check(`${t.code}: Jahreszahl im Namen`, /\d{4}/.test(t.name), `war "${t.name}"`);
    }
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
