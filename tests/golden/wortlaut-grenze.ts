/**
 * Die Wortlaut-Grenze: wie viele Verse eine Ausgabe je Abruf im Wortlaut gibt.
 *
 * Ein eigenes Bündel und keines der Werkzeuge, weil die Aussage gerade
 * werkzeugübergreifend ist: Drei Werkzeuge und eine Ressource müssen dieselbe
 * Zahl nennen, und die Zahl selbst steht in keiner Zusicherung. Sie wird aus
 * `gekuerzt.verse_max` einer Antwort genommen und alles andere daran gemessen.
 * Sonst kostete eine geänderte Zusage nicht eine Registry-Zeile, sondern ein
 * Dutzend Literale, und nach Werkzeugen aufgeteilt zerfiele genau die
 * Invariante, für die es diesen Block gibt.
 *
 * Einzeln lauffähig: `bun run tests/golden/wortlaut-grenze.ts`
 */
import { buendel, fahre } from "../lib/buendel.ts";
import { check, eq, has, hint, lacks, abschluss, type Json } from "../lib/zusicherungen.ts";
import type { ResourceResult, ToolResult } from "../lib/mcp-client.ts";

export const wortlautGrenzeBuendel = buendel({
  name: "wortlaut-grenze",
  calls: {
    // Geprüft wird an der Grenze und einen Vers darüber, dazu der lange Fall in
    // beiden begrenzten Ausgaben und die Gegenprobe in dreien ohne Grenze.
    grenzeGenau: ["bible_lookup", { book: "Psalter", chapter: 66, translation: "SLT" }], // genau 20 Verse
    grenzeEinsDarueber: ["bible_lookup", { book: "Psalter", chapter: 9, translation: "SLT" }], // 21 Verse, einer zu viel
    grenzePs119Slt: ["bible_lookup", { book: "Psalter", chapter: 119, translation: "SLT" }],
    // Das Kapitel, an dem der Notenfilter überhaupt etwas zu tun hat: Matthäus 5
    // hat 48 Verse, drei Noten bis Vers 20 und acht darüber (gemessen
    // 07.08.2026). Psalm 119 taugt dafür nicht, es führt eine einzige Note, und
    // die steht bei Vers 1: Ein Einbau, der den Apparat statt dem gelieferten
    // Versbestand dem gefundenen folgen ließ, blieb dort grün (gemessen
    // 07.08.2026). 189 Kapitel dieser Ausgabe führen Noten jenseits der Grenze
    // (gemessen 07.08.2026).
    grenzeNotenUeber: ["bible_lookup", { book: "Matthäus", chapter: 5, translation: "SLT" }],
    grenzePs119Sch: ["bible_lookup", { book: "Psalter", chapter: 119, translation: "SCH" }], // gilt auch für die 1951er
    grenzePs119Lut: ["bible_lookup", { book: "Psalter", chapter: 119, translation: "LUT" }],
    grenzePs119Elb: ["bible_lookup", { book: "Psalter", chapter: 119, translation: "ELB" }],
    grenzePs119Mb: ["bible_lookup", { book: "Psalter", chapter: 119, translation: "MB" }],
    grenzeSuche50: ["bible_search", { query: "Gott", translation: "SCH", limit: 50 }],
    grenzeSuche10: ["bible_search", { query: "Gott", translation: "SCH", limit: 10 }], // unter der Grenze
    grenzeSucheLut: ["bible_search", { query: "Gott", translation: "LUT", limit: 50 }],
    grenzeXrefSch: ["bible_crossrefs", { book: "Joh", chapter: 3, verse: 16, limit: 30, translation: "SCH" }],
    // Der Vers, an dem die Sperre in `nimmGanz` überhaupt etwas tut. Bei Joh 3,16
    // gehen die ersten 15 Verweise auf genau 20 Verse auf: Danach ist das Budget
    // punktgenau leer, und jede weitere Anfrage scheitert schon an der Zählung,
    // ob gesperrt oder nicht. Bei Epheser 2,8 bleibt nach der ersten Ablehnung
    // Platz, in den zwei kürzere Verweise hineinpassen. Ein Einbau, der die
    // Sperre entfernte, blieb am Fall Joh 3,16 grün und riss hier zwei Löcher
    // (Markus 16,16 und Lukas 7,50; gemessen 07.08.2026 an 11 von 30 geprüften
    // Versen).
    grenzeXrefLuecke: ["bible_crossrefs", { book: "Eph", chapter: 2, verse: 8, limit: 30, translation: "SCH" }],
    grenzeXrefLut: ["bible_crossrefs", { book: "Joh", chapter: 3, verse: 16, limit: 30, translation: "LUT" }],
  },
  resources: {
    // Dieselbe Grenze an der Ressource, die denselben Ausgabepfad benutzt.
    resGrenzeSch: "bible://kapitel/SCH/Psalter/119",
    resGrenzeLut: "bible://kapitel/LUT/Psalter/119",
    // Die Bestandsauskunft nennt die Bedingung dort, wo sie auch Lizenz und
    // Nennung nennt, und aus derselben Registry. Der Abruf steht auch im
    // Ressourcen-Bündel, dort für den Bestand selbst; ein zweiter Abruf kostet
    // nichts als eine Anfrage, während ein Zugriff auf ein fremdes Ergebnis die
    // beiden Bündel aneinanderbände.
    resUebersetzungen: "bible://uebersetzungen",
  },
  pruefe({ res, ressourcen }) {
    const {
      grenzeGenau, grenzeEinsDarueber, grenzePs119Slt, grenzePs119Sch, grenzePs119Lut,
      grenzePs119Elb, grenzePs119Mb, grenzeSuche50, grenzeSuche10, grenzeSucheLut,
      grenzeXrefSch, grenzeXrefLut, grenzeNotenUeber, grenzeXrefLuecke,
    } = res;
    const { resGrenzeSch, resGrenzeLut, resUebersetzungen } = ressourcen;

    type Gekuerzt = { verse_max: number; im_wortlaut: number; ohne_wortlaut: number };
    const gekuerzt = (r: ToolResult | ResourceResult | undefined): Gekuerzt | null =>
      (r?.json?.gekuerzt as Gekuerzt | undefined) ?? null;
    // Die Zahl der Verse im gefügten `text`: Jeder Vers trägt dort seine Nummer
    // vorweg, sobald es mehr als einer ist.
    const verseImText = (r: ToolResult | undefined): number =>
      typeof r?.json?.text === "string" ? (r.json.text.match(/(?:^|\s)\d+\s/g) ?? []).length : -1;

    const grenze = gekuerzt(grenzePs119Slt)?.verse_max ?? -1;
    check("Ps 119 in der 2000er meldet eine Grenze", grenze > 0, `verse_max=${grenze}`);

    // Genau an der Grenze wird nichts gekürzt, und dann darf auch nichts gemeldet
    // werden: Ps 66 hat 20 Verse, Ps 9 hat 21 (gemessen 05.08.2026).
    eq("an der Grenze: kein Feld gekuerzt", gekuerzt(grenzeGenau), null);
    lacks("an der Grenze: kein Grenzsatz", hint(grenzeGenau.json), "im Wortlaut aus");
    eq("an der Grenze: alle Verse", verseImText(grenzeGenau), grenze);

    const einsDarueber = gekuerzt(grenzeEinsDarueber);
    check("einer darüber: Feld gekuerzt steht da", einsDarueber !== null);
    eq("einer darüber: im Wortlaut bis zur Grenze", einsDarueber?.im_wortlaut, grenze);
    eq("einer darüber: genau einer fehlt", einsDarueber?.ohne_wortlaut, 1);
    eq("einer darüber: reference nennt die gelieferten Verse",
      grenzeEinsDarueber.json?.reference, `Psalter 9,1-${grenze}`);

    // Ps 119, der lange Fall, in beiden begrenzten Ausgaben.
    for (const [label, r] of [
      ["2000er", grenzePs119Slt],
      ["1951er", grenzePs119Sch],
    ] as const) {
      const g = gekuerzt(r);
      eq(`Ps 119 ${label}: im Wortlaut = Grenze`, g?.im_wortlaut, grenze);
      eq(`Ps 119 ${label}: die Summe ergibt das Kapitel`,
        (g?.im_wortlaut ?? 0) + (g?.ohne_wortlaut ?? 0), 176);
      eq(`Ps 119 ${label}: text trägt so viele Verse`, verseImText(r), grenze);
      eq(`Ps 119 ${label}: reference nennt sie`, r.json?.reference, `Psalter 119,1-${grenze}`);
      has(`Ps 119 ${label}: der Grenzsatz steht im hinweis`, hint(r.json), "im Wortlaut aus");
    }
    // Der Apparat folgt dem gelieferten Versbestand: keine Note zu einem Vers,
    // den die Antwort nicht enthält. Geprüft wird die Versnummer, nie der Text.
    for (const n of (grenzePs119Slt.json?.fussnoten ?? []) as Array<{ vers: number }>) {
      check("Ps 119: keine Note jenseits der Grenze", n.vers <= grenze, `vers=${n.vers}`);
    }
    // Dieselbe Aussage dort, wo sie etwas ausschließt. Die erste Prüfung ist die
    // Bedingung der zweiten: Ein leerer Apparat ließe sie bestehen, ohne dass sie
    // irgendetwas geprüft hätte.
    const notenUeber = (grenzeNotenUeber.json?.fussnoten ?? []) as Array<{ vers: number }>;
    check("Mt 5: der Apparat ist überhaupt besetzt", notenUeber.length > 0,
      `${notenUeber.length} Noten`);
    check("Mt 5: keine Note jenseits der Grenze",
      notenUeber.every((n) => n.vers <= grenze),
      `Verse: ${notenUeber.map((n) => n.vers).join(", ")}`);

    // Die drei gemeinfreien Ausgaben: unverändert, und das ist der eigentliche
    // Punkt der Registry. Eine global gezogene Grenze beschnitte sie mit.
    for (const [label, r] of [
      ["LUT", grenzePs119Lut],
      ["ELB", grenzePs119Elb],
      ["MB", grenzePs119Mb],
    ] as const) {
      eq(`Ps 119 ${label}: kein Feld gekuerzt`, gekuerzt(r), null);
      lacks(`Ps 119 ${label}: kein Grenzsatz`, hint(r.json), "im Wortlaut aus");
      eq(`Ps 119 ${label}: reference nennt das ganze Kapitel`,
        r.json?.reference, "Psalter 119,1-176");
    }

    // Die Suche kürzt nicht die Liste, sondern lässt ein Feld weg: Die
    // Stellenangabe bleibt, der Wortlaut entfällt. `treffer` zählt weiter alles.
    const suchVerse = (r: ToolResult | undefined) => (r?.json?.verse ?? []) as Array<Json>;
    eq("Suche über der Grenze: alle Treffer gelistet", suchVerse(grenzeSuche50).length, 50);
    eq("Suche über der Grenze: nur bis zur Grenze mit Text",
      suchVerse(grenzeSuche50).filter((v) => typeof v.text === "string").length, grenze);
    check("Suche über der Grenze: jeder Treffer trägt seine Stelle",
      suchVerse(grenzeSuche50).every((v) => typeof v.stelle === "string"));
    eq("Suche über der Grenze: Trefferzahl unberührt",
      grenzeSuche50.json?.treffer, grenzeSuche10.json?.treffer);
    eq("Suche unter der Grenze: kein Feld gekuerzt", gekuerzt(grenzeSuche10), null);
    eq("Suche unter der Grenze: alle mit Text",
      suchVerse(grenzeSuche10).filter((v) => typeof v.text === "string").length, 10);
    eq("Suche in einer Ausgabe ohne Grenze: alle mit Text",
      suchVerse(grenzeSucheLut).filter((v) => typeof v.text === "string").length, 50);
    eq("Suche in einer Ausgabe ohne Grenze: kein Feld gekuerzt", gekuerzt(grenzeSucheLut), null);

    // Querverweise: die Zahl der Verweise darf nicht an der Übersetzung hängen,
    // sonst sähe eine Antwort verschieden vollständig aus, ohne es zu sein.
    type Verweis = { stelle?: unknown; votes?: unknown; text?: unknown; verse_einzeln?: Array<Json> };
    const verweise = (r: ToolResult | undefined) => (r?.json?.verweise ?? []) as Verweis[];
    eq("Querverweise: gleich viele wie in einer Ausgabe ohne Grenze",
      verweise(grenzeXrefSch).length, verweise(grenzeXrefLut).length);
    check("Querverweise: jeder trägt stelle und votes",
      verweise(grenzeXrefSch).every((v) => typeof v.stelle === "string" && typeof v.votes === "number"));
    // Ein Verweis wird ganz oder gar nicht gegeben, und nach dem ersten
    // abgelehnten folgt kein bewilligter mehr: Sonst entstünden Löcher, und ein
    // halbierter Verweis behielte seine Stellenangabe über den ganzen Abschnitt.
    const ersteLuecke = verweise(grenzeXrefSch).findIndex((v) => typeof v.text !== "string");
    check("Querverweise: die Grenze greift überhaupt", ersteLuecke !== -1);
    check("Querverweise: ab der ersten Lücke trägt keiner mehr Text",
      verweise(grenzeXrefSch).slice(ersteLuecke).every((v) => typeof v.text !== "string"));
    // Dieselbe Aussage an dem Vers, an dem sie etwas ausschließt. Nach der ersten
    // Ablehnung bleibt hier Platz, den ein späterer, kürzerer Verweis füllen
    // könnte; genau das darf nicht geschehen, denn die Antwort trüge dann Löcher.
    const luecken = verweise(grenzeXrefLuecke);
    const ersteLueckeEph = luecken.findIndex((v) => typeof v.text !== "string");
    check("Eph 2,8: die Grenze greift überhaupt", ersteLueckeEph !== -1);
    // Echt kleiner, nicht kleinergleich: `im_wortlaut <= verse_max` gilt jeder
    // Antwort und wäre keine Aussage über diesen Fall. Erst der Rest unterscheidet
    // ihn von Joh 3,16, wo die Zahl punktgenau aufgeht (18 gegen 20; gemessen
    // 07.08.2026). Bliebe kein Rest, könnte auch kein späterer Verweis
    // hineinrutschen, und der Fall prüfte die Sperre gar nicht mehr.
    check("Eph 2,8: nach der Ablehnung bleibt Platz im Budget",
      (gekuerzt(grenzeXrefLuecke)?.im_wortlaut ?? grenze) < grenze,
      JSON.stringify(gekuerzt(grenzeXrefLuecke)));
    check("Eph 2,8: ab der ersten Lücke trägt keiner mehr Text",
      luecken.slice(ersteLueckeEph).every((v) => typeof v.text !== "string"),
      luecken.slice(ersteLueckeEph).filter((v) => typeof v.text === "string")
        .map((v) => String(v.stelle)).join(", "));

    const verseMitText = verweise(grenzeXrefSch)
      .filter((v) => typeof v.text === "string")
      .reduce((n, v) => n + (v.verse_einzeln?.length ?? 1), 0);
    check("Querverweise: höchstens so viele Verse wie erlaubt", verseMitText <= grenze,
      `${verseMitText} Verse im Wortlaut`);
    for (const v of verweise(grenzeXrefSch)) {
      // Eine Spanne, die weniger Einzelverse trägt, als ihre Stellenangabe nennt,
      // wäre die stille Teilkürzung, gegen die `nimmGanz` gebaut ist.
      const spanne = /,(\d+)-(\d+)$/.exec(String(v.stelle));
      if (spanne && Array.isArray(v.verse_einzeln)) {
        const erwartet = Math.min(Number(spanne[2]) - Number(spanne[1]) + 1, 4);
        eq(`Querverweise: ${v.stelle} vollständig`, v.verse_einzeln.length, erwartet);
      }
    }
    eq("Querverweise in einer Ausgabe ohne Grenze: kein Feld gekuerzt",
      gekuerzt(grenzeXrefLut), null);
    check("Querverweise in einer Ausgabe ohne Grenze: alle mit Text",
      verweise(grenzeXrefLut).every((v) => typeof v.text === "string"));
    // Ein leerer Text ist keine Aussage: Wo kein Vers gefunden wurde, fehlt das
    // Feld, genau wie jenseits der Grenze. Sonst stünden zwei Bedeutungen
    // nebeneinander, und die eine sähe aus wie die andere.
    for (const [label, r] of [["mit Grenze", grenzeXrefSch], ["ohne Grenze", grenzeXrefLut]] as const) {
      check(`Querverweise ${label}: kein leerer Text`,
        verweise(r).every((v) => v.text !== ""));
    }

    // Alle drei Werkzeuge nennen dieselbe Zahl. Läuft eine auseinander, steht die
    // Grenze doch an mehr als einer Stelle.
    eq("Suche nennt dieselbe Grenze", gekuerzt(grenzeSuche50)?.verse_max, grenze);
    eq("Querverweise nennen dieselbe Grenze", gekuerzt(grenzeXrefSch)?.verse_max, grenze);

    // Die Ressource ist derselbe Ausgabepfad wie das Werkzeug, also muss sie
    // zeichengleich melden. Geprüft gegen die Antwort des Werkzeugs, nicht gegen
    // ein Literal: Ein Literal beschriebe nur, was der Test erwartet.
    const resSch = resGrenzeSch.json as Json | null;
    eq("Ressource: so viele Verse wie das Werkzeug",
      (resSch?.verse_einzeln as Array<Json> | undefined)?.length, grenze);
    eq("Ressource: dasselbe Feld gekuerzt",
      JSON.stringify(resSch?.gekuerzt), JSON.stringify(grenzePs119Sch.json?.gekuerzt));
    eq("Ressource: zeichengleicher Hinweis wie das Werkzeug",
      hint(resSch), hint(grenzePs119Sch.json));
    eq("Ressource ohne Grenze: das ganze Kapitel",
      ((resGrenzeLut.json as Json | null)?.verse_einzeln as Array<Json> | undefined)?.length, 176);
    eq("Ressource ohne Grenze: kein Feld gekuerzt",
      (resGrenzeLut.json as Json | null)?.gekuerzt, undefined);

    const ausgaben = (resUebersetzungen.json?.uebersetzungen ?? []) as Array<{
      kuerzel: string;
      verse_max: number | null;
    }>;
    check("Bestandsauskunft: jede Ausgabe sagt etwas über ihre Grenze",
      ausgaben.every((u) => u.verse_max === null || typeof u.verse_max === "number"));
    for (const u of ausgaben) {
      const erwartet = u.kuerzel === "SCH" || u.kuerzel === "SLT" ? grenze : null;
      eq(`Bestandsauskunft: ${u.kuerzel}`, u.verse_max, erwartet);
    }
  },
});

if (import.meta.main) {
  await fahre([wortlautGrenzeBuendel]);
  abschluss();
}
