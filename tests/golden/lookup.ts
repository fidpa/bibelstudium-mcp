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
import {
  BUCH_KEINE_ZEICHENKETTE,
  BUCH_ZU_LANG,
  KAPITEL_AUSSERHALB,
  VERSLISTE_ZU_LANG,
} from "../lib/meldungen.ts";
import { NO_ERROR } from "../lib/mcp-client.ts";
import { stmtAlias } from "../../src/db.ts";
import { BUCH_KUERZEL_LISTE } from "../../src/werkzeug-helfer.ts";
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
    // Die Kopiervorlage `kurzref`, an den drei Fällen, die ein fremder Client von
    // Hand falsch umgeschrieben hat: ein Buch mit abweichendem Datenbanknamen
    // („Psalter"), eine gezählte Epistel und eine zusammengesetzte Versliste.
    kurzPs: ["bible_lookup", { book: "Psalmen", chapter: 22, verses: "25" }],
    kurzKor: ["bible_lookup", { book: "2. Korinther", chapter: 8, verses: "9,13-15" }],
    // Und der Rücklauf: die Kurzform aus der vorigen Antwort wieder als `book`.
    kurzRuecklauf: ["bible_lookup", { book: "2Kor", chapter: 8, verses: "9" }],
    // Buchauflösung
    hesekiel: ["bible_lookup", { book: "Hesekiel-Zusatz", chapter: 1, verses: "1" }],
    sirach: ["bible_lookup", { book: "Sirach", chapter: 1, verses: "1" }],
    // Der bloße Titel „Weisheit" ist gebräuchlich; die Apokryphen-Meldung führt
    // ihn in ihrer eigenen Aufzählung, erkannte ihn aber lange nicht.
    weisheit: ["bible_lookup", { book: "Weisheit", chapter: 1, verses: "1" }],
    // Gegenprobe zur Wortgrenze: kein apokrypher Titel, darf die Meldung nicht bekommen.
    weisheitsSprueche: ["bible_lookup", { book: "Weisheitssprüche", chapter: 1, verses: "1" }],
    // Verszählung: 140 der 1190 Kapitel zählen zwischen den Ausgaben verschieden.
    // 3. Mose 6 hat in LUT/SCH 30 Verse, in ELB/MB/SLT 23; dieselbe
    // Stellenangabe trifft dort also verschiedene Texte, und bis zum 06.08.2026
    // sagte die Antwort darüber nichts. Kapitel 7 hat überall 38 und ist die
    // Gegenprobe: dort darf der Satz nicht stehen.
    zaehlungLut: ["bible_lookup", { book: "3. Mose", chapter: 6, verses: "20", translation: "LUT" }],
    zaehlungElb: ["bible_lookup", { book: "3. Mose", chapter: 6, verses: "20", translation: "ELB" }],
    zaehlungGleich: ["bible_lookup", { book: "3. Mose", chapter: 7, verses: "1", translation: "ELB" }],
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
    // Dasselbe Muster eine Eingabeklasse weiter: Die Wertprüfung greift auf
    // `\d+` und sieht ein Segment ohne Ziffern nicht. „16,abc" kam bis zum
    // 06.08.2026 als Johannes 3,16 zurück, ohne Hinweis und ohne Fehler, und
    // „abc" allein bekam „No verses found … Check chapter and verse numbers",
    // eine Bedingung, die gar nicht geprüft worden war. Drei Fälle: gemischt,
    // allein, und die Gegenprobe, dass gültige Form weiter durchkommt.
    versesTeilUnlesbar: ["bible_lookup", { book: "Joh", chapter: 3, verses: "16,abc" }],
    versesGanzUnlesbar: ["bible_lookup", { book: "Joh", chapter: 3, verses: "abc" }],
    versesFormGueltig: ["bible_lookup", { book: "Joh", chapter: 3, verses: "16-17,20" }],
    versesTooLong: ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_TOO_LONG }],
    versesNotAString: ["bible_lookup", { book: "Ps", chapter: 119, verses: { kein: "string" } }],
    versesMaxValid: ["bible_lookup", { book: "Ps", chapter: 119, verses: VERSES_MAX_VALID }],
    // Die einzige Stellenangabe, die alle Wertprüfungen besteht und trotzdem auf
    // keinen Vers führt: Psalm 117 hat zwei. Sie erreicht als einziger Aufruf
    // dieses Bündels den Zweig, in dem die Versnutzlast null liefert. Ohne ihn
    // war die Meldung von keiner Zusicherung gedeckt, und eine Verfälschung des
    // Wortlauts blieb grün (gemessen 05.08.2026).
    keinVers: ["bible_lookup", { book: "Ps", chapter: 117, verses: "5" }],
    // Anwesenheit und Typ sind zwei Bedingungen: Beide Meldungen müssen
    // auseinandergehen, sonst sucht der Aufrufer bei einem falschen Typ nach
    // einem fehlenden Feld.
    buchZahl: ["bible_lookup", { book: 123, chapter: 3 }],
    buchFehlt: ["bible_lookup", { chapter: 3 }],
    // Die Länge war hier ungedeckt, obwohl sie seit dem 06.08.2026 mit den beiden
    // anderen Buchprüfungen in `requireBookName` liegt: Ein Einbau, der
    // MAX_BOOK_LENGTH aufhob, blieb in diesem Bündel grün (gemessen).
    buchZuLang: ["bible_lookup", { book: "J".repeat(60), chapter: 3 }],
    // Die nachsichtige Wandlung, absichtlich so gebaut: Sprachmodelle schicken
    // regelmäßig "3", wo das Schema eine Zahl vorsieht, und eine Zahl, wo es
    // eine Zeichenkette vorsieht. Bis zum 06.08.2026 schickte kein einziger
    // Aufruf der Suite einen solchen Wert; ein Rückbau auf eine strenge
    // Typprüfung hätte reale Clients gebrochen und wäre grün geblieben.
    lookupStrings: ["bible_lookup", { book: "Joh", chapter: "3", verses: 16 }],
    // Die Grenze selbst, nicht weit dahinter: 150 ist gültig und scheitert erst
    // am Bestand, 151 wird abgewiesen. Geprüft wurde bisher nur 999, was einen
    // Wechsel auf `>=` nicht bemerkt hätte.
    kapitelGrenze: ["bible_lookup", { book: "Joh", chapter: 150, verses: "1" }],
    kapitelUeberGrenze: ["bible_lookup", { book: "Joh", chapter: 151, verses: "1" }],
    // Dasselbe für MAX_VERSE: 200 besteht die Wertprüfung, 201 nicht. Geprüft
    // war bisher nur "1-500", was ein `>=` nicht bemerkt hätte.
    versGrenze: ["bible_lookup", { book: "Ps", chapter: 119, verses: "200" }],
    versUeberGrenze: ["bible_lookup", { book: "Ps", chapter: 119, verses: "201" }],
    // `translation` erreicht `requireTranslation` über den Werkzeugkanal. Geprüft
    // war bisher allein der Ressourcenweg, der die Meldung als JSON-RPC-Fehler
    // führt statt als `isError`-Ergebnis: zwei verschiedene Kanäle.
    lookupUnbekannteAusgabe: [
      "bible_lookup",
      { book: "Joh", chapter: 3, verses: "16", translation: "XYZ" },
    ],
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
      lookupChap999, hesekiel, sirach, weisheit, weisheitsSprueche,
      zaehlungLut, zaehlungElb, zaehlungGleich,
      joh316, mengeVers, mengeOhneKlammer,
      versesTooMany, versesSpanTooHigh, versesSpanWithComma, versesTooLong,
      versesNotAString, versesMaxValid, keinVers, buchZahl, buchFehlt, buchZuLang,
      noteEine, noteKeine, noteDrei, noteMehrvers,
      lookupStrings, kapitelGrenze, kapitelUeberGrenze, lookupUnbekannteAusgabe,
      versGrenze, versUeberGrenze,
      versesTeilUnlesbar, versesGanzUnlesbar, versesFormGueltig,
      kurzPs, kurzKor, kurzRuecklauf,
    } = res;

    // `reference` trägt den Buchnamen der Datenbank und ist keine Zitierform:
    // „Psalter", „2 Korinther". Ein fremder Client schrieb ihn deshalb selbst um
    // und erzeugte dabei „2 Korinther8,9.13-15" (06.08.2026). `kurzref` ist die
    // Vorlage, und der Versteil ist in beiden derselbe: Er entsteht einmal.
    eq("kurzref: Psalter wird zu Ps", kurzPs.json?.kurzref, "Ps 22,25");
    eq("kurzref: Versliste bleibt erhalten", kurzKor.json?.kurzref, "2Kor 8,9.13-15");
    eq("kurzref: Langform unverändert", kurzKor.json?.reference, "2 Korinther 8,9.13-15");
    // Der Rücklauf ist der eigentliche Zweck: Was herauskommt, geht wieder hinein.
    eq("kurzref: als 'book' wieder eingebbar", kurzRuecklauf.json?.reference, "2 Korinther 8,9");

    // Und das für alle 66, gegen die Aliastabelle statt gegen 66 Aufrufe. Ohne
    // diese Prüfung wäre „1Thes" durchgegangen: Die Registry führt „1Thess", und
    // die unscharfe Suche schlug auf „1Thes" ausgerechnet „Hesekiel" vor.
    const ohneAlias = BUCH_KUERZEL_LISTE.filter(
      ([id, kurz]) => stmtAlias.get(kurz.toLowerCase())?.book_id !== id
    ).map(([, kurz]) => kurz);
    eq("alle 66 Kurzformen sind Aliase", ohneAlias.join(", "), "");
    eq("Kurzformen: 66 Bücher abgedeckt", BUCH_KUERZEL_LISTE.length, 66);

    // 200 ist gültig und scheitert am Bestand (Ps 119 hat 176 Verse), 201 wird
    // von der Wertprüfung abgewiesen. Die beiden Meldungen müssen deshalb
    // auseinandergehen.
    eq(
      "verses=200: Grenze noch gültig",
      versGrenze.text,
      "No verses found for Ps 119,200. Check chapter and verse numbers."
    );
    eq(
      "verses=201: Grenze überschritten",
      versUeberGrenze.text,
      "Error: every verse number in 'verses' must be between 1 and 200"
    );

    eq("bible_lookup chapter", lookupChap999.text, KAPITEL_AUSSERHALB);

    // Die Wandlung greift, und sie liefert denselben Vers wie die typrichtige
    // Anfrage: Verglichen wird gegen `joh316`, nicht gegen ein Literal, damit
    // hier nicht ein zweites Mal Bibeltext gepflegt wird.
    eq("chapter als Zeichenkette, verses als Zahl: kein Fehler", lookupStrings.isError, false);
    eq("chapter als Zeichenkette: dieselbe Stelle", lookupStrings.json?.reference, "Johannes 3,16");
    eq("chapter als Zeichenkette: derselbe Wortlaut", lookupStrings.json?.text, joh316.json?.text);

    // 150 besteht die Wertprüfung und scheitert am Bestand: Die Meldung ist die
    // des fehlenden Verses, nicht die der Grenze. Genau das unterscheidet die
    // Grenze von einem `>=`.
    // Die Meldung gibt die Eingabe wieder ("Joh"), nicht den aufgelösten Namen:
    // Der Aufrufer soll seine eigene Angabe wiedererkennen.
    eq(
      "chapter=150: Grenze noch gültig",
      kapitelGrenze.text,
      "No verses found for Joh 150,1. Check chapter and verse numbers."
    );
    eq("chapter=151: Grenze überschritten", kapitelUeberGrenze.text, KAPITEL_AUSSERHALB);

    eq("unbekannte Übersetzung: isError", lookupUnbekannteAusgabe.isError, true);
    eq("unbekannte Übersetzung: kein JSON-RPC-Fehler", lookupUnbekannteAusgabe.code, NO_ERROR);
    has(
      "unbekannte Übersetzung: nennt den Wert",
      lookupUnbekannteAusgabe.text,
      'Unknown translation "XYZ"'
    );
    // Und zählt die erlaubten auf: Ohne diese Liste weiß der Aufrufer nicht, was
    // er stattdessen schicken soll, und rät.
    for (const code of ["LUT", "SCH", "ELB", "MB"]) {
      has(`unbekannte Übersetzung: nennt ${code}`, lookupUnbekannteAusgabe.text, `"${code}"`);
    }

    eq(
      "Ps 117,5: nicht vorhanden",
      keinVers.text,
      "No verses found for Ps 117,5. Check chapter and verse numbers."
    );
    eq("Ps 117,5: isError", keinVers.isError, true);

    eq("book=123: nennt den Typ", buchZahl.text, BUCH_KEINE_ZEICHENKETTE);
    // Zeichengleich statt als Teilstring: Die Beispiele in der Klammer sind der
    // Grund, warum diese eine Meldung nicht in `requireBookName` wandert, und ein
    // Teilstringtest deckt genau sie nicht ab.
    eq(
      "book fehlt: nennt die Anwesenheit samt eigenen Beispielen",
      buchFehlt.text,
      "Error: 'book' is required (e.g. 'Jesaja', '1. Mose', 'Römer')."
    );
    eq("book zu lang: nennt die Länge", buchZuLang.text, BUCH_ZU_LANG);

    has("Hesekiel-Zusatz: Vorschlag", hesekiel.text, 'Am nächsten kommt "Hesekiel"');
    has("Hesekiel-Zusatz: Kanonumfang", hesekiel.text, "66 Bücher");
    has("Sirach: als apokryph benannt", sirach.text, "apokryphen/deuterokanonischen");
    lacks("Sirach: kein Sacharja-Fehlvorschlag", sirach.text, "Sacharja");

    has("Weisheit: als apokryph benannt", weisheit.text, "apokryphen/deuterokanonischen");
    lacks("Weisheit: kein Buchvorschlag", weisheit.text, "Am nächsten kommt");
    lacks(
      "Weisheitssprüche: nicht als apokryph benannt",
      weisheitsSprueche.text,
      "apokryphen/deuterokanonischen"
    );

    // Der Satz nennt die eigene Länge und die der abweichenden Ausgaben, damit
    // ein Konsument die Differenz beziffern kann statt sie zu vermuten.
    has("3Mo 6,20 (LUT): Zählungssatz", hint(zaehlungLut.json), "zählen dieses Kapitel verschieden");
    has("3Mo 6,20 (LUT): nennt die eigene Länge", hint(zaehlungLut.json), "Luther 1912 hat hier 30 Verse");
    has("3Mo 6,20 (LUT): nennt die abweichende", hint(zaehlungLut.json), "Elberfelder 1871 23");
    has("3Mo 6,20 (ELB): Zählungssatz", hint(zaehlungElb.json), "Elberfelder 1871 hat hier 23 Verse");
    lacks("3Mo 7,1 (ELB): kein Zählungssatz", hint(zaehlungGleich.json), "zählen dieses Kapitel verschieden");
    // Der Anlass des Satzes, strukturell festgehalten: gleiche Stellenangabe,
    // verschiedener Text. Ginge das je verloren, wäre der Satz gegenstandslos.
    check(
      "3Mo 6,20: LUT und ELB liefern verschiedenen Text",
      zaehlungLut.json?.text !== zaehlungElb.json?.text
    );

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
      // Dieselbe Symmetrie für ein Segment ohne Ziffern: beide Wege dieselbe
      // Meldung, und sie nennt die Form, nicht die Existenz eines Verses.
      const nichtLesbar =
        "Error: each segment in 'verses' must be a verse number or a range, like \"4\", \"16-17\" or \"1-3,7\"";
      eq("16,abc: abgewiesen statt verschluckt", versesTeilUnlesbar.text, nichtLesbar);
      eq("16,abc: isError", versesTeilUnlesbar.isError, true);
      eq("abc allein: gleiche Meldung, nicht 'No verses found'", versesGanzUnlesbar.text, nichtLesbar);
      // Gegenprobe: Die gültige Form darf die neue Prüfung nicht treffen.
      eq("16-17,20: gültige Form kommt durch", versesFormGueltig.isError, false);
      eq("16-17,20: Stellenangabe", versesFormGueltig.json?.reference, "Johannes 3,16-17.20");
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
