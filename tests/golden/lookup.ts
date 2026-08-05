/**
 * `bible_lookup`: Verse im Wortlaut, das meistgenutzte Werkzeug.
 *
 * Vier Themen liegen hier beieinander, und alle vier gehen auf einen gemessenen
 * Fehlgriff zurück. Die Buchauflösung, weil „Buch nicht gefunden" allein nicht
 * sagt, ob ein Tippfehler vorliegt oder das Buch außerhalb des Kanons steht. Die
 * Klammern, weil sie zum Wortlaut der Ausgabe gehören und beim Zitieren nicht
 * entfallen dürfen. Die Verslisten-Grenzen, weil stilles Kürzen der Hausfehler
 * dieses Servers ist. Und die Fußnoten, weil `fussnoten` bedingt ist.
 *
 * Einzeln lauffähig: `bun run tests/golden/lookup.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, hint, lacks, abschluss, type Json } from "../lib/zusicherungen.ts";
import { KAPITEL_AUSSERHALB, VERSLISTE_ZU_LANG } from "../lib/meldungen.ts";
import { NO_ERROR } from "../lib/mcp-client.ts";
import { serverInfoBuendel } from "./server-info.ts";

// Eingabe genau an und knapp jenseits der abgeleiteten Grenzen von `verses`
// (MAX_VERSE_PARTS = 30 Segmente, MAX_VERSE = 200, also 30 × "176-176" plus 29
// Kommata = 239 Zeichen). Hier gebaut statt hineinkopiert, damit die Länge
// sichtbar bleibt.
const VERSES_MAX_VALID = Array(30).fill("100-176").join(","); // 239 Zeichen, sämtlich gültig
const VERSES_TOO_LONG = `${VERSES_MAX_VALID},1`; // 241 Zeichen
const VERSES_TOO_MANY = Array.from({ length: 35 }, (_, i) => String(i + 1)).join(",");

export const lookupBuendel = buendel({
  name: "lookup",
  calls: {
    lookupChap999: ["bible_lookup", { book: "Ps", chapter: 999 }],
    // Buchauflösung
    hesekiel: ["bible_lookup", { book: "Hesekiel-Zusatz", chapter: 1, verses: "1" }],
    sirach: ["bible_lookup", { book: "Sirach", chapter: 1, verses: "1" }],
    // Klammern: Menge setzt Einschübe in Klammern, Luther nicht
    joh316: ["bible_lookup", { book: "Joh", chapter: 3, verses: "16" }],
    mengeVers: ["bible_lookup", { book: "1. Mose", chapter: 15, verses: "3", translation: "MB" }],
    mengeOhneKlammer: ["bible_lookup", { book: "Hiob", chapter: 32, verses: "1-4", translation: "MB" }],
    // `verses`: ein Fall je Fehlerklasse, dazu die größte gültige Eingabe. Jede
    // Meldung muss die tatsächlich verletzte Bedingung nennen, und keine der vier
    // Grenzen darf eine Antwort stillschweigend kürzen.
    versesTooMany: ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_TOO_MANY }],
    versesSpanTooHigh: ["bible_lookup", { book: "Ps", chapter: 117, verses: "1-500" }],
    versesSpanWithComma: ["bible_lookup", { book: "Ps", chapter: 117, verses: "1-500,2" }],
    versesTooLong: ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_TOO_LONG }],
    versesNotAString: ["bible_lookup", { book: "Ps", chapter: 119, verses: { kein: "string" } }],
    versesMaxValid: ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_MAX_VALID }],
    // Fußnoten: der Apparat einer Ausgabe. Vier Fälle, denn `fussnoten` ist
    // bedingt und die Bedingung hat mehr als eine Richtung: mit Note, ohne Note,
    // drei Noten am selben Vers, und dieselbe Stelle in einer Ausgabe ohne
    // Apparat. Geprüft wird ausschließlich die Gestalt: Der Wortlaut dieser
    // Ausgabe ist lizenziert und hat in einem öffentlichen Repository nichts zu
    // suchen, auch nicht als Erwartungswert.
    noteEine: ["bible_lookup", { book: "Joh", chapter: 3, verses: "16", translation: "SLT" }],
    noteKeine: ["bible_lookup", { book: "Joh", chapter: 3, verses: "17", translation: "SLT" }],
    noteDrei: ["bible_lookup", { book: "Römer", chapter: 8, verses: "1", translation: "SLT" }],
    noteMehrvers: ["bible_lookup", { book: "Joh", chapter: 3, verses: "16-18", translation: "SLT" }],
  },
  pruefe({ res }, ctx) {
    const {
      lookupChap999, hesekiel, sirach, joh316, mengeVers, mengeOhneKlammer,
      versesTooMany, versesSpanTooHigh, versesSpanWithComma, versesTooLong,
      versesNotAString, versesMaxValid, noteEine, noteKeine, noteDrei, noteMehrvers,
    } = res;

    eq("bible_lookup chapter", lookupChap999.text, KAPITEL_AUSSERHALB);

    has("Hesekiel-Zusatz: Vorschlag", hesekiel.text, 'Am nächsten kommt "Hesekiel"');
    has("Hesekiel-Zusatz: Kanonumfang", hesekiel.text, "66 Bücher");
    has("Sirach: als apokryph benannt", sirach.text, "apokryphen/deuterokanonischen");
    lacks("Sirach: kein Sacharja-Fehlvorschlag", sirach.text, "Sacharja");

    has("1Mo 15,3 (MB): Wortklammer im Text", mengeVers.json?.text as string, "[darum wird einer");
    has("1Mo 15,3 (MB): Klammerhinweis", hint(mengeVers.json), "Wörter in eckigen Klammern");
    eq("Joh 3,16 (LUT): kein Klammerhinweis", hint(joh316.json), "");
    eq("Joh 3,16 (LUT): Voreinstellung Luther", joh316.json?.translation, "Luther 1912");
    eq("Hiob 32,1-4 (MB): kein Klammerhinweis", hint(mengeOhneKlammer.json), "");
    eq("Hiob 32,1-4 (MB): kein Fehler", mengeOhneKlammer.isError, false);

    {
      // Der Hausfehler dieses Servers ist das stille Kürzen: Eine Grenze greift, die
      // Antwort wird kürzer, nichts sagt es, und sie sieht trotzdem vollständig aus.
      // "1,2,…,35" auf Ps 119 kam wortlos als 1-30 zurück (26.07.2026).
      eq(
        "35 Segmente: abgewiesen statt gekürzt",
        versesTooMany.text,
        VERSLISTE_ZU_LANG
      );
      eq("35 Segmente: isError", versesTooMany.isError, true);
      // Gleiche Bedeutung, zwei Wege: Der Schnellpfad für eine schlichte Spanne
      // übersprang die Grenze ganz, der Weg über parseVerses ließ das Segment fallen.
      // Beide müssen jetzt melden.
      const outOfBounds = "Error: every verse number in 'verses' must be between 1 and 200";
      eq("Spanne 1-500", versesSpanTooHigh.text, outOfBounds);
      eq("Spanne 1-500,2 (gleiche Meldung)", versesSpanWithComma.text, outOfBounds);
      eq(
        "241 Zeichen: Längenmeldung nennt die Länge",
        versesTooLong.text,
        "Error: 'verses' must be at most 239 characters"
      );
      eq(
        "kein String: Formmeldung",
        versesNotAString.text,
        `Error: 'verses' must be a string like "4", "16-17" or "1-3,7"`
      );
      // Das Gegenstück, und der Grund, warum die Zeichengrenze abgeleitet und nicht
      // gewählt ist: Bei 239 Zeichen ist alles gültig und muss durchgehen. Die alte,
      // freihändig gesetzte 200 wies genau diese Eingabe ab.
      eq("239 Zeichen gültig: kein Fehler", versesMaxValid.isError, false);
      eq("239 Zeichen gültig: volle Spanne", versesMaxValid.json?.reference, "Psalter 119,100-176");
    }

    {
      // Nur wenn die Ausgabe mit Apparat auch geladen ist. Ihre Quelldateien sind
      // nicht frei lizenziert und liegen nicht im Repository; ein Klon und jede
      // frisch aufgebaute Datenbank haben sie nicht, und ein Test, der dort rot
      // wird, meldet keinen Fehler, sondern eine fehlende Datei.
      const info = ctx.fremd("server-info.serverInfo").json;
      const apparat =
        ((info?.zusatzdaten as Json | undefined)?.fussnoten as boolean | undefined) === true;
      const geladen = ((info?.uebersetzungen ?? []) as Array<{ code: string }>).some(
        (t) => t.code === "SLT"
      );

      check("Bestandsanzeige und geladene Ausgabe stimmen überein", apparat === geladen,
        `zusatzdaten.fussnoten=${apparat}, SLT geladen=${geladen}`);

      if (!apparat || !geladen) {
        console.log("  übersprungen: die Ausgabe mit Apparat ist nicht geladen");
      } else {
        // Gestalt eines Eintrags. Der Wortlaut wird nirgends verglichen, nur seine
        // Anwesenheit: `text.length > 0` ist die stärkste Aussage, die dieser Test
        // über ihn treffen darf.
        const pruefeGestalt = (name: string, eintraege: unknown): Array<Json> => {
          check(`${name}: fussnoten ist ein Feld`, Array.isArray(eintraege));
          const liste = (Array.isArray(eintraege) ? eintraege : []) as Array<Json>;
          for (const [i, e] of liste.entries()) {
            check(`${name}[${i}]: vers ist eine Zahl`, typeof e.vers === "number");
            check(`${name}[${i}]: stelle ist eine Zeichenkette`, typeof e.stelle === "string");
            check(`${name}[${i}]: text nicht leer`, typeof e.text === "string" && e.text.length > 0);
          }
          return liste;
        };

        {
          const liste = pruefeGestalt("Joh 3,16 (SLT)", noteEine.json?.fussnoten);
          eq("Joh 3,16 (SLT): eine Fußnote", liste.length, 1);
          eq("Joh 3,16 (SLT): Fußnote am abgefragten Vers", liste[0]?.vers, 16);
          // Die Stellenangabe stammt aus der Ausgabe, nicht vom Server: Sie zählt
          // in deren eigener Schreibweise „Kapitel,Vers".
          eq("Joh 3,16 (SLT): Stellenangabe der Ausgabe", liste[0]?.stelle, "3,16");
          eq("Joh 3,16 (SLT): kein Fehler", noteEine.isError, false);
        }

        check("Joh 3,17 (SLT): ohne fussnoten", !("fussnoten" in (noteKeine.json ?? {})));
        eq("Joh 3,17 (SLT): kein Fehler", noteKeine.isError, false);

        {
          // Ein Vers trägt bis zu drei Noten, und ihre Reihenfolge gehört zur
          // Aussage: Sie stehen im Druck untereinander und beziehen sich der Reihe
          // nach auf den Vers. Deshalb hat `verse_notes` die Spalte `seq`.
          const liste = pruefeGestalt("Röm 8,1 (SLT)", noteDrei.json?.fussnoten);
          eq("Röm 8,1 (SLT): drei Fußnoten", liste.length, 3);
          check(
            "Röm 8,1 (SLT): alle am selben Vers",
            liste.every((e) => e.vers === 1)
          );
          check(
            "Röm 8,1 (SLT): drei verschiedene Texte",
            new Set(liste.map((e) => e.text)).size === 3
          );
        }

        {
          // Mehrere Verse auf einmal: Jede Note muss einem der abgefragten Verse
          // zugeordnet sein, sonst liest ein Konsument sie beim falschen.
          const liste = pruefeGestalt("Joh 3,16-18 (SLT)", noteMehrvers.json?.fussnoten);
          check("Joh 3,16-18 (SLT): mindestens eine Fußnote", liste.length >= 1);
          check(
            "Joh 3,16-18 (SLT): jede Fußnote an einem abgefragten Vers",
            liste.every((e) => typeof e.vers === "number" && e.vers >= 16 && e.vers <= 18)
          );
        }

        // Der Gegenfall über die Ausgaben hinweg: Dieselbe Stelle in einer Ausgabe
        // ohne Apparat trägt das Feld nicht. Ohne ihn bliebe offen, ob das Feld an
        // der Stelle hängt oder an der Ausgabe.
        check("Joh 3,16 (LUT): ohne fussnoten", !("fussnoten" in (joh316.json ?? {})));

        // Die Namensnennung muss an der Antwort hängen, die den Apparat trägt: Der
        // Apparat gehört derselben Ausgabe wie der Vers, und eine Antwort ohne
        // Nennung wäre eine Weitergabe ohne sie.
        const quellen = (noteEine.json?.quellen ?? []) as Array<Json>;
        check(
          "Joh 3,16 (SLT): Antwort mit Fußnote trägt eine Nennung",
          quellen.some((q) => typeof q.nennung === "string" && q.nennung.length > 0)
        );
      }
    }

    // Die Gegenprobe zu den JSON-RPC-Fehlern der Ressourcen und Prompts: Ein
    // falsches Argument an ein Werkzeug, das es gibt, bleibt ein
    // Werkzeugergebnis. Daraus einen JSON-RPC-Fehler zu machen verbärge es vor
    // dem Modell, und genau deshalb sind diese Meldungen Prosa.
    for (const [label, r] of [
      ["unbekanntes Buch", hesekiel],
      ["Kapitel außerhalb", lookupChap999],
      ["Versliste zu lang", versesTooLong],
    ] as const) {
      eq(`Werkzeug, ${label}: bleibt isError`, r.isError, true);
      eq(`Werkzeug, ${label}: kein JSON-RPC-Fehler`, r.code, NO_ERROR);
    }
  },
});

if (import.meta.main) {
  // Der Fußnotenblock fragt die Selbstauskunft, ob die Ausgabe mit Apparat
  // überhaupt geladen ist; im Einzellauf muss das Bündel deshalb mitfahren.
  await fahre([serverInfoBuendel, lookupBuendel]);
  abschluss();
}
