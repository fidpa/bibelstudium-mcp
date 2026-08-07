# Bibelstudium MCP

[![Release](https://img.shields.io/github/v/release/fidpa/bibelstudium-mcp)](https://github.com/fidpa/bibelstudium-mcp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2%2B-black?logo=bun)](https://bun.sh/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](https://bun.sh/)
[![Maintenance](https://img.shields.io/badge/Maintained-yes-brightgreen.svg)](https://github.com/fidpa/bibelstudium-mcp/commits/)
![Last Commit](https://img.shields.io/github/last-commit/fidpa/bibelstudium-mcp)

MCP-Server für wortgetreue Bibelarbeit auf Deutsch. Er liefert den Grundtext Wort für Wort über vier Editionen mit vollständiger Morphologie, dazu Konkordanz, Querverweise, Volltextsuche und textkritischen Editionsvergleich. Lokal betrieben mit vier frei lizenzierten Übersetzungen, komplett offline in einer einzigen SQLite-Datei; über den gehosteten Dienst zusätzlich mit der **Schlachter 2000**.

> **Sprachhinweis**: Diese Dokumentation ist durchgehend deutsch, weil sich der
> Server an den deutschsprachigen Raum richtet. Tool-Namen und Feldbezeichner
> bleiben englisch bzw. deutsch wie im Code, denn sie sind API-Oberfläche und
> keine Prosa (siehe [Designentscheidungen](#designentscheidungen)).

## Das Problem

Sprachmodelle zitieren die Schrift aus dem Gedächtnis. Sie mischen Übersetzungen, paraphrasieren und erfinden gelegentlich ganze Verse. Genau das darf nicht passieren, wenn es auf den Wortlaut ankommt. Und sobald eine Frage den Grundtext berührt („steht da Singular oder Plural?", „welche Handschriften enthalten diesen Vers?"), kann ein Modell ohne Daten nur raten.

Dieser Server gibt dem Modell stattdessen die Daten, nämlich exakten deutschen Verstext, den griechischen bzw. hebräischen Grundtext mit aufgelöster Morphologie und die Bezeugung jedes einzelnen Wortes über acht Editionen. Jede Aussage bleibt damit gegen eine lokale Datenbank prüfbar.

## Funktionen

- **Exakter deutscher Verstext** (`bible_lookup`) – über den gehosteten Dienst unter `mcp.bibelstudium-mcp.de` die **Schlachter 2000** (dort Voreinstellung), in jeder Installation Luther 1912, Schlachter 1951, Elberfelder 1871 und Menge 1939
- **Grundtext Wort für Wort** (`bible_original`) – ganze Bibel: hebräischer Westminster Leningrad Codex (AT), griechischer Byzantinischer Mehrheitstext / SBLGNT / Textus Receptus (NT); jedes Wort mit Grundform, Strong-Nummer und vollständig dekodierter Morphologie (drei native Morphologie-Schemata: Robinson, MorphGNT, OSHB)
- **Konkordanz / Wortstudie** (`bible_concordance`) – alle Vorkommen eines Grundtext-Wortes nach Strong-Nummer oder Grundform, mit Verteilung je Buch, Flexionsformen und Lexikondaten (Tyndale-Gloss, Strong-Definition, vollständiger Abbott-Smith-Eintrag fürs Griechische)
- **Querverweise** (`bible_crossrefs`) – Treasury of Scripture Knowledge (erweitert, OpenBible.info), nach Community-Stimmen gewichtet, mit deutschem Zieltext; mehrversige Ziele zusätzlich versweise aufgeschlüsselt. Wo die Antwort kürzt, sagt sie es und nennt die Zahl, die sie ausgelassen hat
- **Volltextsuche** (`bible_search`) – FTS5 mit Umlautfaltung, Phrasen- und Präfixsuche, filterbar nach Übersetzung und Buch; `treffer` zählt Verse, `vorkommen_gesamt` die Wortvorkommen, `verteilung` schlüsselt sie je Buch bzw. je Kapitel auf, Fundstellen im Verstext mit `⟦…⟧` markiert
- **Editionsvergleich** (`bible_compare`) – Wort-für-Wort-Diff eines NT-Verses über drei vollständige griechische Editionen **plus Bezeugung jedes Wortes über acht Editionen** (NA27/28, Tyndale House, SBL, Westcott-Hort, Tregelles, TR, Byzantinisch; STEPBible TAGNT). Zeigt Varianten wie das Comma Johanneum mit ihrem vollständigen Zeugenbestand, samt Wortzahl je Edition und je Variante
- **Geführte Arbeitsabläufe** – drei MCP-Prompts (`word-study`, `variant-check`, `translation-compare`), die die Werkzeuge zu vollständigen Studien-Abläufen verketten
- **Herkunftsnachweis eingebaut** – jeder Download protokolliert Quell-URL, Anzahl der Anfragen und SHA-256-Prüfsumme in der Datenbank
- **Namensnennung in jeder Antwort** – das Feld `quellen` nennt Werk, Lizenz und die von der Lizenz verlangte Nennung, und zwar nur für die Quellen, die die jeweilige Antwort tatsächlich benutzt hat. Verlangt die Ausgabe eine Nennung, sagt der `hinweis` derselben Antwort zusätzlich, dass sie in jedes Dokument mitgeht, das den Wortlaut übernimmt

## Bekannte Grenzen

> **WICHTIG**: Die Datenbank wird nicht mitgeliefert, sondern einmalig von den
> Originalquellen geladen (rund 30 Sekunden, ~145 MB fertige Datenbank). Das ist
> Absicht, die Gründe stehen unter [Designentscheidungen](#designentscheidungen).
> Nötig ist dafür kein Terminal, denn der Server kann den Aufbau selbst übernehmen.
>
> - Die **Lexikondaten** (Strong, Abbott-Smith, Glossen) sind **englisch**, weil ein frei lizenziertes deutsches Lexikon vergleichbarer Tiefe nicht existiert
> - Die NT-Voreinstellung ist der **Byzantinische Mehrheitstext**, eine dokumentierte redaktionelle Entscheidung, keine Aussage über den Forschungskonsens; SBLGNT (kritisch) und Textus Receptus sind einen Parameter entfernt
> - Die vier frei lizenzierten deutschen Übersetzungen sind älteren Datums (1871–1951); zeitgenössische Übersetzungen sind nicht frei lizenziert. Die Ausnahme ist die Schlachter 2000 über den gehosteten Dienst
> - Die beiden **Schlachter**-Ausgaben geben je Abruf höchstens 20 Verse im Wortlaut aus, gleich mit welchem Werkzeug. Das ist ein Entgegenkommen gegenüber der Genfer Bibelgesellschaft, die die Texte freigegeben hat. Greift die Grenze, sagt die Antwort es im Feld `gekuerzt` und im `hinweis`; welche Verse enthalten sind, nennt `reference`. Die drei gemeinfreien Übersetzungen sind davon nicht betroffen, und `bible://uebersetzungen` nennt zu jeder Ausgabe ihr `verse_max`
> - Die Ausgaben **zählen nicht überall gleich**. In 140 der 1190 Kapitel weicht die Verszahl voneinander ab (3. Mose 6 hat in Elberfelder, Menge und Schlachter 2000 23 Verse, in Luther und Schlachter 1951 dagegen 30). Dieselbe Stellenangabe trifft dort je Ausgabe eine andere Textstelle; `bible_lookup` sagt es im `hinweis` und nennt die Länge je Ausgabe. Eine Zuordnung von Vers zu Vers liegt nicht vor, der Abgleich geht über den Wortlaut
> - Tool-Namen und Tool-Beschreibungen sind **englisch** (Entwickler-Oberfläche), die Ausgabefelder deutsch (`bedeutung`, `bezeugung`, `verweise`, …)

## Voraussetzungen

Für **Claude Desktop** genügt das fertige Bundle (siehe [unten](#claude-desktop-bundle-statt-konfigurationsdatei)). Es bringt die Laufzeit mit, Bun muss also nicht installiert sein.

| Anforderung | Gilt für | Zweck |
|-------------|----------|-------|
| [Bun](https://bun.sh/) 1.2+ | Betrieb aus dem Repository | Führt TypeScript direkt aus und bringt SQLite mit, also kein Build-Schritt und kein Compiler. 1.2 ist die Untergrenze, weil das Repository das Text-`bun.lock` mitliefert |
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

Wo die Datenbank liegt, entscheidet `db-path.ts`. `BIBLE_DB_PATH` hat Vorrang, sonst gilt `data/bible.db` neben dem Repository, und bei einem installierten Bundle der Benutzerordner (unter macOS `~/Library/Application Support/bibelstudium-mcp/`). Das Arbeitsverzeichnis des Clients spielt in keinem Fall eine Rolle.

### Claude Desktop: Bundle statt Konfigurationsdatei

Für Claude Desktop lässt sich der Server als MCPB-Bundle installieren, statt `claude_desktop_config.json` von Hand zu bearbeiten:

```bash
bun run build:mcpb          # erzeugt tmp/bibelstudium-mcp-<version>-<plattform>.mcpb
```

Installation über *Einstellungen › Extensions › Advanced settings › Extension Developer › Install Extension…*.

Der Installationsdialog fragt nach einer vorhandenen `bible.db`. **Dieses Feld darf leer bleiben**. Der Server lädt die Daten dann selbst. Bei der ersten Bibelfrage meldet er, dass sie fehlen, und fragt, ob er sie holen soll. Nach einer Bestätigung lädt er rund 145 MB von den Originalquellen (gemessen: 26 Sekunden) und legt sie im Benutzerordner ab. Danach ist einmal ein Neustart von Claude Desktop nötig, weil der laufende Serverprozess die neue Datei nicht mehr aufgreifen kann.

Damit braucht es für die Einrichtung **kein Terminal, kein Bun und keine Skripte**. Wer die Datenbank bereits gebaut hat, trägt sie stattdessen im Dialog ein und überspringt den Download.

Fällt eine der acht Quellen aus, laufen die übrigen trotzdem durch. Der Bericht nennt dann, welcher Schritt scheiterte, welche Funktion dadurch fehlt und mit welchem Befehl er sich nachholen lässt. Nur die deutschen Übersetzungen sind zwingend, ohne sie entsteht keine Datenbank.

Zwei Vorteile gegenüber dem JSON-Weg: Das Bundle bringt ein eigenständiges Binary mit, der Rechner braucht kein installiertes Bun, und es ist unempfindlich dagegen, dass Claude Desktop die Konfigurationsdatei beim Beenden zurückschreibt und unbekannte Schlüssel dabei verwirft.

Ein Bundle enthält genau ein Binary und läuft deshalb nur auf der Plattform und Architektur, für die es gebaut wurde. Für andere Ziele: `bun run build:mcpb bun-windows-x64` (bekannte Ziele nennt das Skript bei einer unbekannten Eingabe). Das Packen selbst nutzt `npx @anthropic-ai/mcpb`, braucht also einmalig Node.

Wer einen Client bedienen muss, der keinen Kindprozess starten kann, schaltet den HTTP-Transport frei:

```bash
MCP_HTTP_PORT=8931 bun run src/server.ts # /mcp und /health, gebunden an 127.0.0.1
```

Die Bindung an `127.0.0.1` ist Absicht. Für den Zugriff von außen gehören TLS und ein Zugriffsschutz davor, denn der Server bringt beides nicht mit.

Drei Umgebungsvariablen steuern den Betrieb:

| Variable | Wirkung |
|----------|---------|
| `BIBLE_DB_PATH` | Wo die Datenbank liegt. Ohne sie: `data/` neben dem Repository, bei einem installierten Bundle der Benutzerordner |
| `MCP_HTTP_PORT` | Gesetzt schaltet den HTTP-Transport frei; ohne sie bleibt es bei stdio. `MCP_HTTP_HOST` überschreibt die Bindung an `127.0.0.1` |
| `BIBLE_DEFAULT_TRANSLATION` | Welche Ausgabe ein Abruf ohne `translation` liefert. Ohne sie Luther 1912. Ist der Wert unbekannt oder die Ausgabe nicht geladen, bleibt es bei Luther, und der Server vermerkt das auf stderr |

**`bible_setup` gibt es im HTTP-Modus nicht:** Es lädt 145 MB von fremden Quellen und ersetzt die Datenbank, und das gehört der Betreiberseite, nicht einem beliebigen Aufrufer. `/health` fragt bei jedem Aufruf die Datenbank und antwortet mit 503 samt Grund, wenn sie nicht mehr da ist. Wie der Endpunkt sich sonst verhält (erlaubte Methoden, Origin-Prüfung, Protokollversionen), steht in [docs/ENTSCHEIDUNGEN.md](docs/ENTSCHEIDUNGEN.md).

Die Datenbank baut auf einem Server `bun run setup` auf, oder, wenn dort kein Bun liegt, das Binary selbst:

```bash
./bibelstudium-server --setup             # dieselben acht Schritte, danach beendet sich der Prozess
```

**Empfohlen:** In Claude Desktop zusätzlich den Text aus
[docs/anweisungen/claude-desktop.txt](docs/anweisungen/claude-desktop.txt) unter
*Einstellungen › Anweisungen für Claude* einsetzen. Ob ein Werkzeug aufgerufen und
wie sein Ergebnis wiedergegeben wird, entscheidet der Client, denn der Server
kann es nur anbieten. Die Anweisungen schärfen Zitiertreue, Zahlenangaben und den Umgang
mit den Vorbehalten des Servers.

## Verwendung

Du rufst die Werkzeuge nicht selbst auf. Du stellst dem Assistenten eine Frage, und er holt sich die Daten.

> „Was steht in Johannes 1,1 wörtlich im Griechischen?"
> „Ist das Comma Johanneum in 1. Johannes 5,7 echt?"
> „Wo kommt ἀγάπη im Neuen Testament überall vor?"
> „Zeig mir Johannes 3,16 in allen Übersetzungen."
> „Welche Querverweise gibt es zu Römer 8,1?"

Auf die erste Frage bekommt er jedes Wort einzeln, mit Grundform, aufgelöster Morphologie und Strong-Nummer. Auf die zweite die drei griechischen Editionen nebeneinander, dazu für jedes Wort, welche von acht Editionen es bezeugen. Der Zusatz steht allein im Textus Receptus, und das sagt die Antwort mit Zeugenbestand statt mit einer Einschätzung.

Wie die Antworten aussehen, zeigt [docs/BEISPIELE.md](docs/BEISPIELE.md), samt einem Weg, den Server ohne MCP-Client auszuprobieren.

## Werkzeuge

| Werkzeug | Zweck |
|----------|-------|
| `bible_lookup` | Exakter Verstext nach Stellenangabe (Buch/Kapitel/Verse, Übersetzung wählbar); in Ausgaben mit Wortlaut-Grenze bis zu deren `verse_max`. Die Antwort nennt die Stelle zweimal: `reference` mit dem Buchnamen der Datenbank, `kurzref` in der deutschen Kurzform zum Zitieren |
| `bible_original` | Ein Vers Wort für Wort auf Hebräisch/Griechisch mit Grundform, Strong-Nummer, dekodierter Morphologie |
| `bible_concordance` | Alle Vorkommen eines Grundtext-Wortes (Strong/Grundform) mit Statistik und Lexikondaten |
| `bible_crossrefs` | Querverweise zu einem Vers, nach Stimmen gewichtet, mit deutschem Zieltext, soweit die Wortlaut-Grenze der Ausgabe ihn zulässt |
| `bible_search` | Volltextsuche (Wörter, „Phrasen", Präfix*), umlautfaltend, je Übersetzung/Buch |
| `bible_compare` | Wort-Diff eines NT-Verses über 3 griechische Editionen + Bezeugung über 8 Editionen |
| `bible_server_info` | Fassung dieses Servers, welche Bibeldaten er geladen hat und welche Ressourcen er anbietet, dazu je Ausgabe Lizenz, geforderte Namensnennung und `verse_max` sowie der Kanonumfang. Liefert keinen Bibeltext |
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

| Kürzel | Übersetzung | Lizenz | Verfügbar |
|--------|-------------|--------|-----------|
| `SLT` | **Schlachter 2000** | © 2000 Genfer Bibelgesellschaft | gehosteter Dienst (dort Voreinstellung) |
| `LUT` | Luther 1912 | Public Domain | überall (eingebaute Voreinstellung) |
| `SCH` | Schlachter 1951 | CC BY 4.0 (Genfer Bibelgesellschaft) | überall |
| `ELB` | Elberfelder 1871 | Public Domain | überall |
| `MB` | Menge 1939 | Public Domain | überall |

Die **Schlachter 2000** ist die einzige zeitgenössische Übersetzung hier und
steht über den gehosteten Dienst unter `mcp.bibelstudium-mcp.de` zur Verfügung,
mit freundlicher Genehmigung der Genfer Bibelgesellschaft. Sie kommt aus keinem
Download. Eine selbst aufgebaute Datenbank führt sie nicht, und `SLT` läuft dort
in die Meldung „nicht geladen".

Die vier übrigen lädt `bible_setup` von ihren Originalquellen, sie stehen also
jeder Installation zur Verfügung. Welche Ausgaben eine laufende Instanz
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

Die Bezeugungsnotizen von TAGNT nennen nur die Zeugen des eigenen Apparats, und dessen „Byz" ist nicht dasselbe wie der hier geladene Robinson-Pierpont 2005. In rund 11 % der NT-Verse widerspricht die Notiz deshalb dem Editionstext. Der Server gleicht beides ab und stellt den Widerspruch als `warnung` an den Anfang der Antwort, statt ihn in einer Fußnote zu verstecken. Für die Frage „was steht in dieser Edition" gilt der Editionstext.

## Architektur

TypeScript auf Bun, eine einzige Laufzeit-Abhängigkeit (das MCP-SDK), kein
Build-Schritt. Die Daten liegen in einer SQLite-Datei, die nur lesend geöffnet
wird; alles unter `scripts/` läuft ausschließlich beim einmaligen Datenaufbau
und nie im Serverbetrieb. Welche Datei was tut, steht in
[CONTRIBUTING.md](CONTRIBUTING.md).

### Designentscheidungen

**Warum keine mitgelieferte Datenbank?** Drei Gründe: STEPBible bittet darum, ihre Datendateien nur aus dem eigenen Repository zu verbreiten; eine selbst aufgebaute Datenbank mit `provenance`-Tabelle (Quell-URL + SHA-256 je Download) ist auf eine Weise überprüfbar, wie es ein heruntergeladener Datenklumpen nie sein kann; und die Aufbau-Skripte dokumentieren zugleich, woher jedes einzelne Wort stammt. Der Preis dafür war früher ein Terminal-Schritt. Den nimmt seit `bible_setup` der Server ab.

**Warum baut der Server die Daten erst auf Nachfrage?** Der Aufbau lädt rund 145 MB von acht fremden Quellen. Das gehört nicht angestoßen, weil ein Modell nach einem Vers gefragt hat, sondern erst, wenn die Nutzerin zugestimmt hat. Ohne Bestätigung nennt `bible_setup` nur, was es täte.

**Warum Luther 1912 als Voreinstellung?** Es ist die bekannteste gemeinfreie deutsche Übersetzung, und sie ist in **jeder** Installation vorhanden. Das ist der eigentliche Grund, denn eine Voreinstellung, die eine Instanz nicht geladen hat, ließe jeden Abruf ohne `translation` in eine Fehlermeldung laufen. Schlachter 1951 (CC BY), Elberfelder 1871 und Menge 1939 sind einen Parameter entfernt, und `translation-compare` stellt sie nebeneinander.

Ein Endpunkt darf davon abweichen, ohne den Code zu ändern: `BIBLE_DEFAULT_TRANSLATION` setzt die Vorgabe auf ein anderes Kürzel, sofern die Ausgabe geladen ist. Ist sie es nicht oder ist das Kürzel unbekannt, bleibt es bei Luther, und der Server vermerkt das auf stderr. Welche Vorgabe tatsächlich gilt, nennt `bible://uebersetzungen` im Feld `voreinstellung`; der gehostete Dienst führt darüber die Schlachter 2000.

**Warum ist der Byzantinische Mehrheitstext die NT-Voreinstellung?** Der Server dient wortgetreuer Arbeit, und die hier mitgelieferten deutschen Übersetzungen stehen in der Mehrheitstext-Tradition (Luther und Schlachter folgen der TR-/byzantinischen Linie). Der kritische SBLGNT ist über `texttyp: "sblgnt"` vollständig verfügbar, und `bible_compare` zeigt genau, wo die Editionen auseinandergehen, samt Bezeugung zur Beurteilung jeder Lesart.

**Warum englische Tool-Namen bei deutscher Ausgabe?** MCP-Tool-Namen sind Entwickler-Oberfläche (englische Konvention); der Inhalt, den ein Mensch liest, ist deutsch, weil der ausgelieferte Bibeltext deutsch ist.

**Warum nur eine Abhängigkeit und kein Build-Schritt?** `bun:sqlite` steckt in Bun, und Bun führt TypeScript direkt aus. Die einzige Laufzeit-Abhängigkeit ist das MCP-SDK. Weniger Angriffsfläche, nichts zu kompilieren, nichts, was kaputtgehen kann.

## Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [docs/anweisungen/claude-desktop.txt](docs/anweisungen/claude-desktop.txt) | Fertiger Text für *Einstellungen › Anweisungen für Claude* in Claude Desktop; er schärft Zitiertreue, Zahlenangaben und den Umgang mit den Hinweisen des Servers |
| [docs/anweisungen/README.md](docs/anweisungen/README.md) | Wozu die Client-Anweisungen dienen, wohin sie gehören, und warum sie knapp bleiben müssen, denn sie werden in jeder Sitzung geladen, auch ohne biblische Frage |
| [docs/BEISPIELE.md](docs/BEISPIELE.md) | Wie die Antworten aussehen: Grundtext, Textkritik, Verstext, und ein Weg, den Server ohne MCP-Client auszuprobieren |
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

- [lydia-bible-bot](https://github.com/fidpa/lydia-bible-bot) – sicherheitsgehärteter KI-Bibelassistent für Telegram-Gruppen, der seinen Bibeltext über den gehosteten Dienst dieses Servers bezieht
