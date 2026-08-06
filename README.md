# Bibelstudium MCP

[![Release](https://img.shields.io/github/v/release/fidpa/bibelstudium-mcp)](https://github.com/fidpa/bibelstudium-mcp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2%2B-black?logo=bun)](https://bun.sh/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](https://bun.sh/)
[![Maintenance](https://img.shields.io/badge/Maintained-yes-brightgreen.svg)](https://github.com/fidpa/bibelstudium-mcp/commits/)
![Last Commit](https://img.shields.io/github/last-commit/fidpa/bibelstudium-mcp)

Lokaler MCP-Server für wortgetreue Bibelarbeit auf Deutsch: vier frei lizenzierte Übersetzungen, der Grundtext Wort für Wort über vier Editionen mit vollständiger Morphologie, Konkordanz, Querverweise, Volltextsuche und textkritischer Editionsvergleich. Komplett offline, in einer einzigen SQLite-Datei.

> **Sprachhinweis**: Diese Dokumentation ist durchgehend deutsch, weil sich der
> Server an den deutschsprachigen Raum richtet. Tool-Namen und Feldbezeichner
> bleiben englisch bzw. deutsch wie im Code: Sie sind API-Oberfläche, keine
> Prosa (siehe [Designentscheidungen](#designentscheidungen)).

## Das Problem

Sprachmodelle zitieren die Schrift aus dem Gedächtnis. Sie mischen Übersetzungen, paraphrasieren und erfinden gelegentlich ganze Verse: genau das, was nicht passieren darf, wenn es auf den Wortlaut ankommt. Und sobald eine Frage den Grundtext berührt („steht da Singular oder Plural?", „welche Handschriften enthalten diesen Vers?"), kann ein Modell ohne Daten nur raten.

Dieser Server gibt dem Modell stattdessen die Daten: exakten deutschen Verstext, den griechischen bzw. hebräischen Grundtext mit aufgelöster Morphologie und die Bezeugung jedes einzelnen Wortes über acht Editionen: jede Aussage gegen eine lokale Datenbank prüfbar.

## Funktionen

- **Exakter deutscher Verstext** (`bible_lookup`) – vier frei lizenzierte Übersetzungen: Luther 1912 (Voreinstellung), Schlachter 1951, Elberfelder 1871, Menge 1939. Der gehostete Dienst unter `mcp.bibelstudium-mcp.de` führt zusätzlich die **Schlachter 2000**
- **Grundtext Wort für Wort** (`bible_original`) – ganze Bibel: hebräischer Westminster Leningrad Codex (AT), griechischer Byzantinischer Mehrheitstext / SBLGNT / Textus Receptus (NT); jedes Wort mit Grundform, Strong-Nummer und vollständig dekodierter Morphologie (drei native Morphologie-Schemata: Robinson, MorphGNT, OSHB)
- **Konkordanz / Wortstudie** (`bible_concordance`): alle Vorkommen eines Grundtext-Wortes nach Strong-Nummer oder Grundform, mit Verteilung je Buch, Flexionsformen und Lexikondaten (Tyndale-Gloss, Strong-Definition, vollständiger Abbott-Smith-Eintrag fürs Griechische)
- **Querverweise** (`bible_crossrefs`): Treasury of Scripture Knowledge (erweitert, OpenBible.info), nach Community-Stimmen gewichtet, mit deutschem Zieltext; mehrversige Ziele zusätzlich versweise aufgeschlüsselt (`verse_einzeln`). In einer Ausgabe mit Wortlaut-Grenze tragen die bestbewerteten Verweise ihren Text, die übrigen nur `stelle` und `votes`; die Zahl der Verweise bleibt gleich
- **Volltextsuche** (`bible_search`): FTS5 mit Umlautfaltung, Phrasen- und Präfixsuche, filterbar nach Übersetzung und Buch; `treffer` zählt Verse, `vorkommen_gesamt` die Wortvorkommen, `verteilung` schlüsselt sie je Buch bzw. je Kapitel auf, Fundstellen im Verstext mit `⟦…⟧` markiert
- **Editionsvergleich** (`bible_compare`): Wort-für-Wort-Diff eines NT-Verses über drei vollständige griechische Editionen **plus Bezeugung jedes Wortes über acht Editionen** (NA27/28, Tyndale House, SBL, Westcott-Hort, Tregelles, TR, Byzantinisch; STEPBible TAGNT). Zeigt Varianten wie das Comma Johanneum mit ihrem vollständigen Zeugenbestand, samt Wortzahl je Edition und je Variante
- **Geführte Arbeitsabläufe**: drei MCP-Prompts (`word-study`, `variant-check`, `translation-compare`), die die Werkzeuge zu vollständigen Studien-Abläufen verketten
- **Herkunftsnachweis eingebaut**: jeder Download protokolliert Quell-URL, Anzahl der Anfragen und SHA-256-Prüfsumme in der Datenbank
- **Namensnennung in jeder Antwort**: das Feld `quellen` nennt Werk, Lizenz und die von der Lizenz verlangte Nennung, und zwar nur für die Quellen, die die jeweilige Antwort tatsächlich benutzt hat

## Bekannte Grenzen

> **WICHTIG**: Die Datenbank wird nicht mitgeliefert, sondern einmalig von den
> Originalquellen geladen (rund 30 Sekunden, ~145 MB fertige Datenbank). Das ist
> Absicht, die Gründe stehen unter [Designentscheidungen](#designentscheidungen).
> Nötig ist dafür kein Terminal: Der Server kann den Aufbau selbst übernehmen.
>
> - Die **Lexikondaten** (Strong, Abbott-Smith, Glossen) sind **englisch**: Ein frei lizenziertes deutsches Lexikon vergleichbarer Tiefe existiert nicht
> - Die NT-Voreinstellung ist der **Byzantinische Mehrheitstext**, eine dokumentierte redaktionelle Entscheidung, keine Aussage über den Forschungskonsens; SBLGNT (kritisch) und Textus Receptus sind einen Parameter entfernt
> - Die vier frei lizenzierten deutschen Übersetzungen sind älteren Datums (1871–1951); zeitgenössische Übersetzungen sind nicht frei lizenziert. Die Ausnahme ist die Schlachter 2000 über den gehosteten Dienst
> - Die beiden **Schlachter**-Ausgaben geben je Abruf höchstens 20 Verse im Wortlaut aus, gleich mit welchem Werkzeug: ein Entgegenkommen gegenüber der Genfer Bibelgesellschaft, die die Texte freigegeben hat. Greift die Grenze, sagt die Antwort es im Feld `gekuerzt` und im `hinweis`; welche Verse enthalten sind, nennt `reference`. Die drei gemeinfreien Übersetzungen sind davon nicht betroffen, und `bible://uebersetzungen` nennt zu jeder Ausgabe ihr `verse_max`
> - Tool-Namen und Tool-Beschreibungen sind **englisch** (Entwickler-Oberfläche), die Ausgabefelder deutsch (`bedeutung`, `bezeugung`, `verweise`, …)

## Voraussetzungen

Für **Claude Desktop** genügt das fertige Bundle (siehe [unten](#claude-desktop-bundle-statt-konfigurationsdatei)): Es bringt die Laufzeit mit, Bun muss nicht installiert sein.

| Anforderung | Gilt für | Zweck |
|-------------|----------|-------|
| [Bun](https://bun.sh/) 1.2+ | Betrieb aus dem Repository | Führt TypeScript direkt aus, SQLite eingebaut: kein Build-Schritt, kein Compiler. 1.2 ist die Untergrenze, weil das Repository das Text-`bun.lock` mitliefert |
| `unzip` | beide Wege | Für den Querverweis-Download. Auf macOS vorinstalliert, in minimalen Linux-Images nicht (`sudo apt install unzip`). Fehlt es, scheitert nur dieser eine Schritt; der Rest der Datenbank entsteht trotzdem |
| ~1 GB freier Speicher | beide Wege | ~145 MB fertige Datenbank plus temporäre Kopie beim Aufbau |
| Internetzugang | beide Wege | Nur für den einmaligen Datenaufbau, danach läuft der Server vollständig offline |

## Schnellstart

```bash
git clone https://github.com/fidpa/bibelstudium-mcp.git
cd bibelstudium-mcp
bun install                    # eine Laufzeit-Abhängigkeit: @modelcontextprotocol/sdk

# Datenbank aufbauen, alle acht Schritte auf einmal (~30 s):
bun run setup

# …oder einzeln, streng der Reihe nach, niemals parallel:
bun run download            # 4 deutsche Übersetzungen (~5 s), MUSS zuerst laufen
bun run download:byz        # Griechisch: Byzantinischer Mehrheitstext (Edition 'byzantine')
bun run download:sblgnt     # Griechisch: SBLGNT + MorphGNT (Edition 'sblgnt')
bun run download:tr         # Griechisch: Textus Receptus (Edition 'tr')
bun run download:heb        # Hebräisch: Westminster Leningrad Codex (Edition 'wlc')
bun run download:crossrefs  # Querverweise (OpenBible.info)
bun run download:tagnt      # Bezeugung über acht Editionen (STEPBible TAGNT)
bun run download:lexicon    # Lexika (Strong + STEPBible-Glossen/Abbott-Smith)
```

Warum sequentiell? Jedes Skript arbeitet auf einer Kopie der aktuellen Datenbank und tauscht sie am Ende atomar aus. Laufen zwei gleichzeitig, gewinnt der letzte Austausch. Die Daten des anderen sind weg.

Server im MCP-Client registrieren, z. B. `.mcp.json` für Claude Code:

```json
{
  "mcpServers": {
    "bibelstudium": {
      "command": "bun",
      "args": ["run", "/pfad/zu/bibelstudium-mcp/src/server.ts"]
    }
  }
}
```

Wo die Datenbank liegt, entscheidet `db-path.ts`: `BIBLE_DB_PATH` hat Vorrang, sonst `data/bible.db` neben dem Repository, und bei einem installierten Bundle der Benutzerordner (unter macOS `~/Library/Application Support/bibelstudium-mcp/`). Das Arbeitsverzeichnis des Clients spielt in keinem Fall eine Rolle.

### Claude Desktop: Bundle statt Konfigurationsdatei

Für Claude Desktop lässt sich der Server als MCPB-Bundle installieren, statt `claude_desktop_config.json` von Hand zu bearbeiten:

```bash
bun run build:mcpb          # erzeugt tmp/bibelstudium-mcp-<version>-<plattform>.mcpb
```

Installation über *Einstellungen › Extensions › Advanced settings › Extension Developer › Install Extension…*.

Der Installationsdialog fragt nach einer vorhandenen `bible.db`. **Dieses Feld darf leer bleiben**. Der Server lädt die Daten dann selbst: Bei der ersten Bibelfrage meldet er, dass sie fehlen, und fragt, ob er sie holen soll. Nach einer Bestätigung lädt er rund 145 MB von den Originalquellen (gemessen: 26 Sekunden) und legt sie im Benutzerordner ab. Danach ist einmal ein Neustart von Claude Desktop nötig, weil der laufende Serverprozess die neue Datei nicht mehr aufgreifen kann.

Damit braucht es für die Einrichtung **kein Terminal, kein Bun und keine Skripte**. Wer die Datenbank bereits gebaut hat, trägt sie stattdessen im Dialog ein und überspringt den Download.

Fällt eine der acht Quellen aus, laufen die übrigen trotzdem durch: Der Bericht nennt dann, welcher Schritt scheiterte, welche Funktion dadurch fehlt und mit welchem Befehl er sich nachholen lässt. Nur die deutschen Übersetzungen sind zwingend, ohne sie entsteht keine Datenbank.

Zwei Vorteile gegenüber dem JSON-Weg: Das Bundle bringt ein eigenständiges Binary mit, der Rechner braucht kein installiertes Bun, und es ist unempfindlich dagegen, dass Claude Desktop die Konfigurationsdatei beim Beenden zurückschreibt und unbekannte Schlüssel dabei verwirft.

Ein Bundle enthält genau ein Binary und läuft deshalb nur auf der Plattform und Architektur, für die es gebaut wurde. Für andere Ziele: `bun run build:mcpb bun-windows-x64` (bekannte Ziele nennt das Skript bei einer unbekannten Eingabe). Das Packen selbst nutzt `npx @anthropic-ai/mcpb`, braucht also einmalig Node.

Wer einen Client bedienen muss, der keinen Kindprozess starten kann, schaltet den HTTP-Transport frei:

```bash
MCP_HTTP_PORT=8931 bun run src/server.ts # /mcp und /health, gebunden an 127.0.0.1
```

Die Bindung an `127.0.0.1` ist Absicht. Für den Zugriff von außen gehören TLS und ein Zugriffsschutz davor: Der Server bringt beides nicht mit.

Drei Unterschiede zum stdio-Betrieb. **`bible_setup` gibt es im HTTP-Modus nicht** (es lädt 145 MB von fremden Quellen und ersetzt die Datenbank, und das gehört der Betreiberseite, nicht einem beliebigen Aufrufer). `/health` fragt bei jedem Aufruf die Datenbank, statt den Startzustand zu wiederholen: **503** mit Grund, wenn sie nicht antwortet, sonst 200. Beide Pfade nehmen nur die Methoden an, die sie brauchen (`/mcp` nur `POST`, `/health` nur `GET` und `HEAD`, dazu je `OPTIONS`) und prüfen den `Origin`-Kopf, sofern einer mitkommt; alles andere beantworten sie mit 405 beziehungsweise 403, jeweils mit den erlaubten Methoden in der Kopfzeile `Allow`. Und der Server vermerkt auf stderr, in welcher Protokollfassung ein Aufrufer spricht, eine Zeile je Fassung und nicht je Anfrage: Das ist ein Zugriffsprotokoll ausdrücklich nicht, sondern die Vorwarnung für den Tag, an dem ein Client eine Revision spricht, die diese Fassung des Servers nicht bedient. Die Datenbank baut auf einem Server also `bun run setup` auf, oder, wenn dort kein Bun liegt, das Binary selbst:

```bash
./bibelstudium-server --setup             # dieselben acht Schritte, danach beendet sich der Prozess
```

**Empfohlen:** In Claude Desktop zusätzlich den Text aus
[docs/anweisungen/claude-desktop.txt](docs/anweisungen/claude-desktop.txt) unter
*Einstellungen › Anweisungen für Claude* einsetzen. Ob ein Werkzeug aufgerufen und
wie sein Ergebnis wiedergegeben wird, entscheidet der Client: Der Server kann es
nur anbieten. Die Anweisungen schärfen Zitiertreue, Zahlenangaben und den Umgang
mit den Vorbehalten des Servers.

## Verwendung

Im Normalfall rufst du die Werkzeuge nicht selbst auf: Du stellst dem Assistenten eine Frage, und er holt sich die Daten. Ein paar Beispiele, was damit möglich wird:

> „Was steht in Johannes 1,1 wörtlich im Griechischen?"

Der Assistent ruft `bible_original` auf und bekommt jedes Wort einzeln aufgeschlüsselt (gekürzt):

```json
{
  "reference": "Johannes 1,1",
  "texttyp": "byzantine",
  "edition": "Byzantinischer Mehrheitstext (Robinson-Pierpont 2005)",
  "woerter": [
    { "wort": "εν",     "grundform": "ἐν",    "morphologie": "Präposition",                                   "strong": "G1722" },
    { "wort": "αρχη",   "grundform": "ἀρχή",  "morphologie": "Substantiv Dativ Singular feminin",             "strong": "G746"  },
    { "wort": "ην",     "grundform": "εἰμί",  "morphologie": "Verb Imperfekt Aktiv Indikativ 3. Person Sing.", "strong": "G1510" },
    { "wort": "λογος",  "grundform": "λόγος", "morphologie": "Substantiv Nominativ Singular maskulin",        "strong": "G3056" }
  ]
}
```

> „Ist das Comma Johanneum in 1. Johannes 5,7 echt?"

`bible_compare` stellt die Editionen gegenüber und liefert die Bezeugung dazu: Der Zusatz steht nur im Textus Receptus, alle betroffenen Wörter tragen `typ: "K"` (KJV-/TR-Tradition) und als Bezeugung ausschließlich `TR`:

```json
{
  "reference": "1 Johannes 5,7",
  "vergleiche": [
    { "paar": "byzantine ↔ sblgnt", "ergebnis": "identisch (nach Normalisierung)" },
    { "paar": "byzantine ↔ tr",
      "unterschiede": ["nur in tr: \"εν τω ουρανω ο πατηρ ο λογος και το αγιον πνευμα …\""] }
  ],
  "bezeugung": {
    "woerter_gesamt": 22,
    "von_allen_acht_bezeugt": 5,
    "abweichend": [
      { "wort": "οὐρανῷ", "typ": "K", "editionen": "TR" },
      { "wort": "πατήρ",  "typ": "K", "editionen": "TR" }
    ]
  }
}
```

Weitere typische Fragen: „Wo kommt ἀγάπη im Neuen Testament überall vor?" (`bible_concordance`) · „Zeig mir Johannes 3,16 in allen vier Übersetzungen" (Prompt `translation-compare`) · „Welche Verse sprechen von Gnade?" (`bible_search`) · „Welche Querverweise gibt es zu Römer 8,1?" (`bible_crossrefs`).

Zum Testen ohne MCP-Client lassen sich JSON-RPC-Zeilen direkt in den Server leiten:

```bash
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bible_lookup","arguments":{"book":"Johannes","chapter":3,"verses":"16"}}}'
} | bun run src/server.ts
```

## Werkzeuge

| Werkzeug | Zweck |
|----------|-------|
| `bible_lookup` | Exakter Verstext nach Stellenangabe (Buch/Kapitel/Verse, Übersetzung wählbar); in Ausgaben mit Wortlaut-Grenze bis zu deren `verse_max` |
| `bible_original` | Ein Vers Wort für Wort auf Hebräisch/Griechisch mit Grundform, Strong-Nummer, dekodierter Morphologie |
| `bible_concordance` | Alle Vorkommen eines Grundtext-Wortes (Strong/Grundform) mit Statistik und Lexikondaten |
| `bible_crossrefs` | Querverweise zu einem Vers, nach Stimmen gewichtet, mit deutschem Zieltext, soweit die Wortlaut-Grenze der Ausgabe ihn zulässt |
| `bible_search` | Volltextsuche (Wörter, „Phrasen", Präfix*), umlautfaltend, je Übersetzung/Buch |
| `bible_compare` | Wort-Diff eines NT-Verses über 3 griechische Editionen + Bezeugung über 8 Editionen |
| `bible_server_info` | Fassung dieses Servers, welche Bibeldaten er geladen hat und welche Ressourcen er anbietet. Liefert keinen Bibeltext |
| `bible_setup` | Lädt die Bibeldaten, wenn noch keine da sind. Erscheint **nur** über stdio und nur, solange die Datenbank fehlt; lädt erst nach ausdrücklicher Bestätigung |

## Prompts

| Prompt | Anzeigename | Argumente | Ablauf |
|--------|-------------|-----------|--------|
| `word-study` | Wortstudie | `word` (Pflicht), `reference` | Grundtext-Wort → Konkordanz → Schlüsselstellen → Bedeutungsspektrum |
| `variant-check` | Textvarianten prüfen | `reference` (Pflicht) | Editions-Diff → Bezeugung → Lesarten je Edition → nüchterne Einordnung |
| `translation-compare` | Übersetzungen vergleichen | `reference` (Pflicht) | Alle geladenen Übersetzungen nebeneinander, gegen den Grundtext geprüft |

Der Anzeigename steht im `title`-Feld und ist das, was ein Client im Auswahlmenü zeigt; angesprochen wird ein Prompt weiterhin über seinen Bezeichner in der ersten Spalte.

## Ressourcen

Werkzeuge und Prompts wählt das Modell, eine Ressource hängt der Nutzer selbst an. Vier feste Einträge beschreiben den Bestand:

| URI | Inhalt |
|-----|--------|
| `bible://buecher` | Die 66 Bücher mit Nummer, Name, Kapitelzahl, Testament |
| `bible://uebersetzungen` | Geladene Übersetzungen mit Lizenz, geforderter Namensnennung und `verse_max` |
| `bible://editionen` | Geladene Grundtext-Editionen mit Sprache, Eigenheiten der Schreibung, Lizenz |
| `bible://quellen` | Alle Quellen, aus denen diese Instanz tatsächlich Daten führt |

Der Bibeltext selbst kommt über URI-Vorlagen. Sonderzeichen im Buchnamen werden prozentkodiert (`R%C3%B6mer`), Abkürzungen sind erlaubt:

| Vorlage | Inhalt | Beispiel |
|---------|--------|----------|
| `bible://kapitel/{uebersetzung}/{buch}/{kapitel}` | Ganzes Kapitel, Vers für Vers; in Ausgaben mit Wortlaut-Grenze bis zu deren `verse_max` | `bible://kapitel/LUT/Psalter/23` |
| `bible://vers/{uebersetzung}/{buch}/{kapitel}/{verse}` | Einzelvers, Bereich oder Liste | `bible://vers/SCH/Johannes/3/16-17` |
| `bible://grundtext/{edition}/{buch}/{kapitel}/{vers}` | Ein Vers Wort für Wort | `bible://grundtext/wlc/1%20Mose/1/1` |

Jede Ressource, die Text ausliefert, trägt ihre `quellen` mit, genau wie eine Werkzeugantwort. Ohne aufgebaute Datenbank sind beide Listen leer und ein Abruf wird abgewiesen.

In Claude Code werden Ressourcen mit `@` angehängt (`@bibelstudium:bible://quellen`). Dass eine angebotene Ressource dabei ohne Inhalt ankommt, hat zwei bekannte Ursachen, beide samt Ausweg in [`docs/FEHLERBEHEBUNG.md`](docs/FEHLERBEHEBUNG.md).

## Übersetzungen

| Kürzel | Übersetzung | Lizenz |
|--------|-------------|--------|
| `LUT` | Luther 1912 (Voreinstellung) | Public Domain |
| `SCH` | Schlachter 1951 | CC BY 4.0 (Genfer Bibelgesellschaft) |
| `ELB` | Elberfelder 1871 | Public Domain |
| `MB` | Menge 1939 | Public Domain |
| `SLT` | Schlachter 2000 | © 2000 Genfer Bibelgesellschaft |

Die ersten vier lädt `bible_setup` von ihren Originalquellen, sie stehen also
jeder Installation zur Verfügung. Die **Schlachter 2000** gibt es über den
gehosteten Dienst; eine selbst aufgebaute Datenbank führt sie nicht, und `SLT`
läuft dort in die Meldung „nicht geladen". Welche Ausgaben eine laufende Instanz
tatsächlich führt, sagt `bible_server_info`.

## Editionen & Voreinstellungen

`bible_original` deckt die ganze Bibel ab und leitet nach Buch weiter:

| `texttyp` | Edition | Umfang | Rolle |
|-----------|---------|--------|-------|
| `wlc` | Westminster Leningrad Codex (masoretisch, OSHB-Morphologie) | AT (Bücher 1–39) | einzige AT-Quelle → primär |
| `byzantine` | Mehrheitstext (Robinson-Pierpont 2005) | NT (40–66) | **NT-Voreinstellung** |
| `sblgnt` | SBL Greek New Testament (kritisch, Nestle-Aland-nah) | NT | sekundär / Vergleich |
| `tr` | Textus Receptus (Scrivener-/Stephanus-Tradition) | NT | Vergleich (TR-eigene Lesarten) |

`bible_compare` meldet zusätzlich je Wort, welche von acht Editionen es bezeugen (NA28, NA27, Tyndale House, SBL, Westcott-Hort, Tregelles, TR, Byzantinisch; Daten aus STEPBible TAGNT).

Die Variantennotizen von TAGNT nennen nur die Zeugen des eigenen Apparats, und dessen „Byz" ist nicht deckungsgleich mit dem hier geladenen Robinson-Pierpont 2005. Der Server gleicht deshalb jede Notiz gegen die tatsächlich vorhandenen Editionstexte ab: `in_dieser_db` nennt je Form die Editionen, die sie wirklich lesen, `abgleich` die Widersprüche. Beispiel 1. Timotheus 3,16: TAGNT vermerkt `TR: ἀνελήφθη`, obwohl der Mehrheitstext hier ebenso liest; ohne diesen Abgleich lädt die Notiz zum Fehlschluss ein, der Mehrheitstext folge dem kritischen Text. Über 400 zufällige NT-Verse gemessen betrifft das rund 11 % der Verse. Widersprüche stehen zusätzlich als `warnung`/`quellenkonflikte` ganz oben in der Antwort, damit sie beim Wiedergeben nicht untergehen.

## Architektur

| Datei | Aufgabe |
|-------|---------|
| `src/server.ts` | MCP-Server: Ausgabeschemata, Werkzeugliste, drei Prompts, vier Ressourcen und drei URI-Vorlagen, Verteilung der Anfragen, `bible_setup`, Start |
| `src/handlers/*.ts` | Ein Werkzeug je Datei: `lookup`, `original`, `crossrefs`, `concordance`, `search`, `compare` |
| `src/werkzeug-helfer.ts` | Was mehrere Werkzeuge teilen: Ergebnisformen, Buchauflösung samt Grenzen und Meldungen, Versnutzlast, Testament-Routing des Grundtextes |
| `src/db.ts` | Datenbankverbindung, Unversehrtheitsprüfung und alle vorbereiteten Abfragen |
| `src/editions.ts` | Die vier Grundtext-Editionen: Namen, Lesehinweise, Lizenzen, Auflösung des Texttyps |
| `src/translations.ts` | Übersetzungs-Registry (Kürzel, Namen, Lizenzen, Aliase) |
| `src/morphology.ts` | Die drei Morphologie-Schemata: MorphGNT, Robinson, OSHB |
| `src/verse-budget.ts` | Wie viele Verse eine Ausgabe je Antwort im Wortlaut trägt, und wie das Kürzen gemeldet wird |
| `src/greek-diff.ts` | Wortvergleich zweier Grundtext-Editionen, Abgleich mit der Bezeugungsnotiz |
| `src/db-path.ts` | Wo die Datenbank liegt, geteilt von Server und Datenaufbau |
| `scripts/setup.ts` | Führt die acht Downloads nacheinander aus; ein Teilausfall bricht den Lauf nicht ab |
| `scripts/schema.ts` | Tabellen-Schemata + FTS-Neuaufbau |
| `scripts/atomic-db.ts` | Atomare Datenbank-Schreibvorgänge (temporäre Kopie + Umbenennen), sicher bei parallelen Lesern |
| `scripts/provenance.ts` | Quellen-/Prüfsummen-Protokoll für jeden Download |
| `scripts/aliases.ts` | Deutsche Buchnamen/Abkürzungen → Buch-IDs |
| `scripts/download*.ts` | Ein Skript je Datenquelle, additiv, atomarer Austausch |
| `scripts/build-mcpb.ts` | Baut das MCPB-Bundle für Claude Desktop |
| `mcpb/manifest.json` | Manifest-Quelle des Bundles |
| `data/bible.db` | SQLite (gitignored, lokal aufgebaut) |

### Designentscheidungen

**Warum keine mitgelieferte Datenbank?** Drei Gründe: STEPBible bittet darum, ihre Datendateien nur aus dem eigenen Repository zu verbreiten; eine selbst aufgebaute Datenbank mit `provenance`-Tabelle (Quell-URL + SHA-256 je Download) ist auf eine Weise überprüfbar, wie es ein heruntergeladener Datenklumpen nie sein kann; und die Aufbau-Skripte dokumentieren zugleich, woher jedes einzelne Wort stammt. Der Preis dafür war früher ein Terminal-Schritt. Den nimmt seit `bible_setup` der Server ab.

**Warum baut der Server die Daten erst auf Nachfrage?** Der Aufbau lädt rund 145 MB von acht fremden Quellen. Das gehört nicht angestoßen, weil ein Modell nach einem Vers gefragt hat, sondern erst, wenn die Nutzerin zugestimmt hat. Ohne Bestätigung nennt `bible_setup` nur, was es täte.

**Warum Luther 1912 als Voreinstellung?** Es ist die bekannteste gemeinfreie deutsche Übersetzung. Schlachter 1951 (CC BY), Elberfelder 1871 und Menge 1939 sind einen Parameter entfernt, und `translation-compare` stellt sie nebeneinander.

**Warum ist der Byzantinische Mehrheitstext die NT-Voreinstellung?** Der Server dient wortgetreuer Arbeit, und die hier mitgelieferten deutschen Übersetzungen stehen in der Mehrheitstext-Tradition (Luther und Schlachter folgen der TR-/byzantinischen Linie). Der kritische SBLGNT ist über `texttyp: "sblgnt"` vollständig verfügbar, und `bible_compare` zeigt genau, wo die Editionen auseinandergehen, samt Bezeugung zur Beurteilung jeder Lesart.

**Warum sind alle Werkzeuge als `readOnlyHint` markiert?** Jedes der sieben liest ausschließlich aus der lokalen SQLite-Datei, die read-only geöffnet wird: kein Schreibzugriff, keine Seiteneffekte, kein Netzwerk. Ohne Angabe würde die Spezifikation das Gegenteil annehmen (`readOnlyHint: false`, `openWorldHint: true`). `destructiveHint` und `idempotentHint` fehlen bewusst: Sie sind laut Schema nur bedeutsam, wenn ein Werkzeug schreibt.

**Warum steht die Antwort zweimal drin?** Die sieben Lesewerkzeuge deklarieren ein `outputSchema` und liefern ihr Ergebnis zusätzlich als `structuredContent` (MCP-Revision 2025-06-18). Der Textblock bleibt dabei unverändert: Ein Client, der die Neuerung nicht kennt, sieht genau dasselbe wie vorher. Das kostet je Antwort 63 bis 80 Prozent mehr Zeichen, und dafür ist ein Feld wie `vorkommen_gesamt` oder `warnung` maschinell auffindbar, statt nur lesbar. Fehlerantworten bleiben reiner Text, sie tragen kein `structuredContent`.

**Warum stehen bei den Ressourcen Vorlagen statt einer Liste?** Diese Datenbank führt 31 102 Verse in 1190 Kapiteln. Sie aufzuzählen hieße, bei jedem Sitzungsbeginn einen Katalog über die Leitung zu schicken; schon die 66 Bücher wären rund 13 000 zusätzliche Zeichen neben den 15 171 von `tools/list`. So kostet `resources/list` 939 Zeichen und `resources/templates/list` 947. Claude Code zeigt die Vorlagen in der `@`-Vervollständigung an, hängt eine daraus gebildete URI aber nicht als Inhalt an, anders als eine feste (gemessen am 02.08.2026 über stdio gegen einen Kontrollserver und über HTTP gegen diesen Server); das Ressourcen-Werkzeug des Modells listet dort ohnehin nur die vier festen Einträge, und für Claude Desktop und claude.ai ist beides nicht belegt. Deshalb nennt `bible_server_info` die Vorlagen zusätzlich. Ein ganzes Buch gibt es aus demselben Grund nicht: Das größte misst 260 990 Zeichen (Menge, Jeremia) und läge jenseits dessen, was ein Client als Ergebnis annimmt. Aus derselben Rechnung steht der Grundtext je Vers und nicht je Kapitel: Das größte Kapitel hat 1285 Wörter, bei 161 Zeichen Grenzkosten je Wort wären das rund 208 000 Zeichen.

**Warum trägt eine Text-Ressource `verse_einzeln` statt `text`?** Weil sie angehängt und daraus zitiert wird. Ein zusammengesetzter String mit eingebetteten Versnummern ist genau die Form, die bei `bible_crossrefs` gemessen an beiden Enden abgeschnitten wurde. Beides zu führen kostete das 2,57-Fache (Psalm 119, Luther: 13 562 → 34 876 Zeichen), `verse_einzeln` allein das 1,58-Fache. `bible_lookup` behält den zusammengesetzten Text: Dort zählte der Aufschlag doppelt, weil die Nutzlast zusätzlich als `structuredContent` mitfährt.

**Warum englische Tool-Namen bei deutscher Ausgabe?** MCP-Tool-Namen sind Entwickler-Oberfläche (englische Konvention); der Inhalt, den ein Mensch liest, ist deutsch, weil der ausgelieferte Bibeltext deutsch ist.

**Warum nur eine Abhängigkeit und kein Build-Schritt?** `bun:sqlite` steckt in Bun, und Bun führt TypeScript direkt aus. Die einzige Laufzeit-Abhängigkeit ist das MCP-SDK. Weniger Angriffsfläche, nichts zu kompilieren, nichts, was kaputtgehen kann.

## Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [docs/anweisungen/claude-desktop.txt](docs/anweisungen/claude-desktop.txt) | Fertiger Text für *Einstellungen › Anweisungen für Claude* in Claude Desktop: schärft Zitiertreue, Zahlenangaben und den Umgang mit den Hinweisen des Servers |
| [docs/ENTSCHEIDUNGEN.md](docs/ENTSCHEIDUNGEN.md) | Warum der Code so aussieht: gemessene Befunde, verworfene Alternativen, Erfahrungen mit Clients und fremden Quellen |
| [docs/FEHLERBEHEBUNG.md](docs/FEHLERBEHEBUNG.md) | Fehlerbilder beim Datenaufbau und Serverstart, jeweils mit Ursache und Behebung |
| [docs/TYPESCRIPT.md](docs/TYPESCRIPT.md) | Code-Stil-Regeln, Typecheck, bewusst nicht übernommene Konventionen |
| [docs/UEBERSETZUNGEN.md](docs/UEBERSETZUNGEN.md) | Geprüfte Optionen für weitere Übersetzungen: Lizenzlage, freie Kandidaten, Kosten einer Aufnahme |
| [mcpb/manifest.json](mcpb/manifest.json) | Manifest-Quelle des MCPB-Bundles für Claude Desktop; gebaut wird es mit `bun run build:mcpb` |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Mitwirken: Grundregeln, Prüfschritte, Pull-Request-Ablauf |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | Vollständige Quellen- und Lizenztabelle aller Bibeldaten |
| [SECURITY.md](SECURITY.md) | Sicherheitsmodell und Meldeweg für Schwachstellen |

## Datenquellen & Lizenzen

Alle Datenquellen sind Public Domain oder CC-BY(-SA); die vollständige Tabelle steht in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), einschließlich der vorgeschriebenen Namensnennung für Schlachter 1951 (CC BY 4.0, © Genfer Bibelgesellschaft) und des STEPBible-Hinweises zur Weiterverbreitung.

## Mitwirken

Beiträge sind willkommen, siehe [CONTRIBUTING.md](CONTRIBUTING.md). Bitte beachte die Datenqualitäts-Regel: Jede Aussage über den Text muss gegen die Datenbank überprüfbar sein (die Hausregel lautet „Belege statt Behauptungen").

## Lizenz

MIT-Lizenz, siehe [LICENSE](LICENSE). Die Lizenz deckt den Code; die Bibeldaten werden lokal heruntergeladen und unterliegen ihren eigenen Lizenzen (siehe oben).

## Autor

**Marc Allgeier** ([@fidpa](https://github.com/fidpa))

**Warum ich das gebaut habe**: Ich wollte einen KI-Assistenten, der mit der Schrift so umgeht wie ein sorgfältiger Leser: exakt zitieren, im Grundtext nachsehen statt zu raten, und ehrlich benennen, wo die Handschriften auseinandergehen. Im öffentlichen MCP-Ökosystem gab es englische Server mit guten Lexika, aber nichts Deutsches, nichts Offline-Fähiges mit mehreren Grundtext-Editionen und nichts, was Textvarianten mit ihren Zeugen zeigen konnte. Diese Lücke schließt der Server.

## Siehe auch

- [lydia-bible-bot](https://github.com/fidpa/lydia-bible-bot): Sicherheitsgehärteter KI-Bibelassistent für Telegram-Gruppen (nutzt eine frühere, eingebettete Fassung dieses Servers)
- [cc-telegram-bot](https://github.com/fidpa/cc-telegram-bot): Telegram-Bot-Grundgerüst für Claude Code
- [bash-production-toolkit](https://github.com/fidpa/bash-production-toolkit): Produktionsreife Bash-Patterns
