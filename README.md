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

## Warum es ihn gibt

Sprachmodelle zitieren die Schrift aus dem Gedächtnis. Sie mischen Übersetzungen, paraphrasieren und erfinden gelegentlich ganze Verse. Genau das darf nicht passieren, wenn es auf den Wortlaut ankommt. Und sobald eine Frage den Grundtext berührt („steht da Singular oder Plural?", „welche Handschriften enthalten diesen Vers?"), kann ein Modell ohne Daten nur raten.

Dieser Server gibt dem Modell stattdessen die Daten, nämlich exakten deutschen Verstext, den griechischen bzw. hebräischen Grundtext mit aufgelöster Morphologie und die Bezeugung jedes einzelnen Wortes über acht Editionen. Jede Aussage bleibt damit gegen eine lokale Datenbank prüfbar.

## Funktionen

- **Exakter deutscher Verstext** (`bible_lookup`): Luther 1912, Schlachter 1951, Elberfelder 1871 und Menge 1939 in jeder Installation, über den gehosteten Dienst zusätzlich die Schlachter 2000
- **Grundtext Wort für Wort** (`bible_original`): ganze Bibel, hebräischer Westminster Leningrad Codex (AT), griechischer Byzantinischer Mehrheitstext / SBLGNT / Textus Receptus (NT); jedes Wort mit Grundform, Strong-Nummer und vollständig dekodierter Morphologie aus drei nativen Schemata (Robinson, MorphGNT, OSHB)
- **Konkordanz und Wortstudie** (`bible_concordance`): alle Vorkommen eines Grundtext-Wortes nach Strong-Nummer oder Grundform, mit Verteilung je Buch, Flexionsformen und Lexikondaten (Tyndale-Gloss, Strong-Definition, vollständiger Abbott-Smith-Eintrag fürs Griechische)
- **Querverweise und Parallelstellen** (`bible_crossrefs`): Treasury of Scripture Knowledge (erweitert, OpenBible.info), nach Community-Stimmen gewichtet, mit deutschem Zieltext; mehrversige Ziele zusätzlich versweise aufgeschlüsselt
- **Volltextsuche** (`bible_search`): FTS5 mit Umlautfaltung, Phrasen- und Präfixsuche, filterbar nach Übersetzung und Buch; `treffer` zählt Verse, `vorkommen_gesamt` die Wortvorkommen, `verteilung` schlüsselt sie je Buch bzw. je Kapitel auf, Fundstellen im Verstext mit `⟦…⟧` markiert
- **Editionsvergleich** (`bible_compare`): Wort-für-Wort-Diff eines NT-Verses über drei vollständige griechische Editionen, dazu die Bezeugung jedes Wortes über acht Editionen (die Liste steht unter [Editionen und Voreinstellungen](#editionen-und-voreinstellungen)). Zeigt Varianten wie das Comma Johanneum mit ihrem vollständigen Zeugenbestand, samt Wortzahl je Edition und je Variante
- **Geführte Arbeitsabläufe**: drei MCP-Prompts (`word-study`, `variant-check`, `translation-compare`), die die Werkzeuge zu vollständigen Studien-Abläufen verketten
- **Herkunftsnachweis eingebaut**: jeder Download protokolliert Quell-URL, Anzahl der Anfragen und SHA-256-Prüfsumme in der Datenbank, und `bun run pruefe:quellen` stellt sie gegen die im Repository hinterlegten Sollwerte in `quellen-pruefsummen.json`
- **Namensnennung in jeder Antwort**: das Feld `quellen` nennt Werk, Lizenz und die von der Lizenz verlangte Nennung, und zwar nur für die Quellen, die die jeweilige Antwort tatsächlich benutzt hat. Verlangt die Ausgabe eine Nennung, sagt der `hinweis` derselben Antwort zusätzlich, dass sie in jedes Dokument mitgeht, das den Wortlaut übernimmt

Die Parallelstellen verdienen eine eigene Erklärung, weil sie eine andere Frage
beantworten als der gewichtete Verweis und deshalb nicht mit ihm vermischt
werden. Wo die UBS Parallel Passage Database einen Vers führt, nennt
`bible_crossrefs` zusätzlich dessen **Parallelgruppe**: den geschlossenen Satz
paralleler Stellen, also Synoptiker-Perikopen, Königs- und Chronik-Dubletten,
AT-Zitate im NT, formelhafte Wiederholungen. Zu Markus 2,12 nennen die zehn
bestbewerteten Verweise weder Lukas 5,25-26 noch Johannes 5,9, die
Parallelgruppe nennt beide. Wo die Antwort kürzt, sagt sie es und nennt die
Zahl, die sie ausgelassen hat.

## Bekannte Grenzen

> **WICHTIG**: Die Datenbank wird nicht mitgeliefert, sondern einmalig von den
> Originalquellen geladen (rund 145 MB fertige Datenbank). Das ist Absicht, die
> Gründe stehen unter [Designentscheidungen](#designentscheidungen). Nötig ist
> dafür kein Terminal, denn der Server kann den Aufbau selbst übernehmen.
>
> - Die **Lexikondaten** (Strong, Abbott-Smith, Glossen) sind **englisch**, weil ein frei lizenziertes deutsches Lexikon vergleichbarer Tiefe nicht existiert
> - Die NT-Voreinstellung ist der **Byzantinische Mehrheitstext**, eine dokumentierte redaktionelle Entscheidung, keine Aussage über den Forschungskonsens; SBLGNT (kritisch) und Textus Receptus sind einen Parameter entfernt
> - Die vier frei lizenzierten deutschen Übersetzungen sind älteren Datums (1871 bis 1951); zeitgenössische Übersetzungen sind nicht frei lizenziert. Die Ausnahme ist die Schlachter 2000 über den gehosteten Dienst
> - Die beiden **Schlachter**-Ausgaben geben je Abruf höchstens 20 Verse im Wortlaut aus (`VERSE_MAX_GBG` in `src/translations.ts`), gleich mit welchem Werkzeug. Das ist ein Entgegenkommen gegenüber der Genfer Bibelgesellschaft, die die Texte freigegeben hat. Greift die Grenze, sagt die Antwort es im Feld `gekuerzt` und im `hinweis`; welche Verse enthalten sind, nennt `reference`. Die drei gemeinfreien Übersetzungen sind davon nicht betroffen, und `bible://uebersetzungen` nennt zu jeder Ausgabe ihr `verse_max`
> - Die Ausgaben **zählen nicht überall gleich**. In 140 der 1190 Kapitel weicht die Verszahl voneinander ab (3. Mose 6 hat in Elberfelder, Menge und Schlachter 2000 23 Verse, in Luther und Schlachter 1951 dagegen 30). Dieselbe Stellenangabe trifft dort je Ausgabe eine andere Textstelle; `bible_lookup` sagt es im `hinweis` und nennt die Länge je Ausgabe. Eine Zuordnung von Vers zu Vers liegt nicht vor, der Abgleich geht über den Wortlaut
> - Tool-Namen und Tool-Beschreibungen sind **englisch** (Entwickler-Oberfläche), die Ausgabefelder deutsch (`bedeutung`, `bezeugung`, `verweise` und so fort)

### Wofür der Server nicht gedacht ist

- **Keine Auslegung.** Er liefert Text, Morphologie und Bezeugung. Was ein Vers
  bedeutet, entscheidet der Mensch, der ihn liest; der Server liefert nur die
  Grundlage dafür.
- **Kein Mehrbenutzerdienst.** Er ist für den Betrieb durch einen einzelnen
  Nutzer über stdio gebaut. Der HTTP-Transport bringt weder TLS noch
  Zugriffsschutz mit und bindet aus diesem Grund an `127.0.0.1`; wer ihn
  erreichbar machen will, stellt beides selbst davor (siehe
  [SECURITY.md](SECURITY.md)).
- **Keine Bibel-App.** Es gibt keine Oberfläche, kein Leseprogramm, keine
  Notizen. Der Server ist ein Werkzeugkasten für einen MCP-Client.
- **Keine zeitgenössischen Übersetzungen in der eigenen Installation.** Was frei
  lizenziert ist, ist alt; siehe [docs/UEBERSETZUNGEN.md](docs/UEBERSETZUNGEN.md)
  für die geprüften Optionen und ihre Kosten.

## Voraussetzungen

Für **Claude Desktop** genügt das fertige Bundle (siehe [unten](#claude-desktop-bundle-statt-konfigurationsdatei)). Es bringt die Laufzeit mit, Bun muss also nicht installiert sein.

| Anforderung | Gilt für | Zweck |
|-------------|----------|-------|
| [Bun](https://bun.sh/) 1.2+ | Betrieb aus dem Repository | Führt TypeScript direkt aus und bringt SQLite mit, also kein Build-Schritt und kein Compiler. 1.2 ist die Untergrenze, weil das Repository das Text-`bun.lock` mitliefert, und sie ist gemessen. Auf 1.2.0 lief am 08.08.2026 der gesamte Testbestand durch |
| `unzip` | beide Wege | Für den Querverweis-Download. Auf macOS vorinstalliert, in minimalen Linux-Images nicht (`sudo apt install unzip`). Fehlt es, scheitert nur dieser eine Schritt; der Rest der Datenbank entsteht trotzdem |
| ~1 GB freier Speicher | beide Wege | ~145 MB fertige Datenbank plus temporäre Kopie beim Aufbau |
| Internetzugang | beide Wege | Nur für den einmaligen Datenaufbau, danach läuft der Server vollständig offline |

Was auf welcher Plattform geprüft ist:

| Plattform | Stand |
|-----------|-------|
| Linux (x64) | **Läuft geprüft.** Typecheck, Startverhalten ohne und mit unvollständiger Datenbank sowie `test:http` laufen bei jedem Push auf `ubuntu-latest` (siehe `.github/workflows/lint.yml`) |
| macOS (arm64) | **Läuft geprüft.** Entwicklungsplattform; das MCPB-Bundle ist bisher allein für `bun-darwin-arm64` gebaut und installiert worden |
| Windows (x64) | **Sollte laufen, ungetestet.** `src/db-path.ts` kennt den `APPDATA`-Pfad, und `bun run build:mcpb bun-windows-x64` erzeugt ein Bundle. Ausprobiert hat es niemand |

Der Golden-Test (`bun run test`) braucht eine aufgebaute Datenbank und läuft
deshalb nicht in der CI, sondern von Hand.

## Schnellstart

```bash
git clone https://github.com/fidpa/bibelstudium-mcp.git
cd bibelstudium-mcp
bun install                    # eine Laufzeit-Abhängigkeit: @modelcontextprotocol/sdk

# Datenbank aufbauen, alle neun Schritte auf einmal:
bun run setup

# ...oder einzeln, streng der Reihe nach, niemals parallel:
bun run download            # 4 deutsche Übersetzungen, MUSS zuerst laufen
bun run download:byz        # Griechisch: Byzantinischer Mehrheitstext (Edition 'byzantine')
bun run download:sblgnt     # Griechisch: SBLGNT + MorphGNT (Edition 'sblgnt')
bun run download:tr         # Griechisch: Textus Receptus (Edition 'tr')
bun run download:heb        # Hebräisch: Westminster Leningrad Codex (Edition 'wlc')
bun run download:crossrefs  # Querverweise (OpenBible.info)
bun run download:parallels  # Parallelstellen (UBS Parallel Passage Database)
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

### Gehosteter Dienst: ohne Installation

Es gibt eine öffentlich betriebene Instanz. Sie braucht kein Bun, keinen Download
und keine Datenbank:

```
https://mcp.bibelstudium-mcp.de/mcp
```

Der Transport ist Streamable HTTP. Wo ein Client einen eigenen MCP-Server per URL
aufnimmt (bei claude.ai unter *Connectors*), genügt diese Adresse. In der
offiziellen [MCP-Registry](https://registry.modelcontextprotocol.io) steht der
Dienst als `de.bibelstudium-mcp/bibelstudium`.

Drei Unterschiede zur eigenen Installation:

- **Voreinstellung ist die Schlachter 2000**, die es in einer selbst aufgebauten
  Datenbank nicht gibt. Die vier frei lizenzierten Ausgaben sind dort ebenfalls
  vorhanden, über den Parameter `translation`.
- **Ohne Authentifizierung, und zwar absichtlich:** Nur so nehmen Clients einen
  Server als Connector auf. Davor liegen ein Tunnel und eine Ratenbegrenzung,
  gebunden ist der Dienst an `127.0.0.1`; Einzelheiten in
  [SECURITY.md](SECURITY.md). Ausgeliefert wird ausschließlich Bibeltext.
- **Keine Zusage auf Verfügbarkeit.** Wer sich darauf verlassen muss, betreibt
  den Server selbst; dafür ist er gebaut.

### Claude Desktop: Bundle statt Konfigurationsdatei

Für Claude Desktop lässt sich der Server als MCPB-Bundle installieren, statt `claude_desktop_config.json` von Hand zu bearbeiten:

```bash
bun run build:mcpb          # erzeugt tmp/bibelstudium-mcp-<version>-<plattform>.mcpb
```

Installation über *Einstellungen > Extensions > Advanced settings > Extension Developer > Install Extension*.

Der Installationsdialog fragt nach einer vorhandenen `bible.db`. **Dieses Feld darf leer bleiben**. Der Server lädt die Daten dann selbst: Bei der ersten Bibelfrage meldet er, dass sie fehlen, und fragt, ob er sie holen soll. Nach einer Bestätigung lädt er rund 145 MB von den Originalquellen und legt sie im Benutzerordner ab. Danach ist einmal ein Neustart von Claude Desktop nötig, weil der laufende Serverprozess die neue Datei nicht mehr aufgreifen kann.

Damit braucht es für die Einrichtung **kein Terminal, kein Bun und keine Skripte**. Wer die Datenbank bereits gebaut hat, trägt sie stattdessen im Dialog ein und überspringt den Download.

Wie lange das dauert: Der zuletzt gemessene Vollaufbau lief in 26 Sekunden durch, damals über acht Schritte und noch ohne die Parallelstellen. Die Zeit hängt an der Anbindung der neun fremden Quellen und ist keine Zusage.

Fällt eine der neun Quellen aus, laufen die übrigen trotzdem durch. Der Bericht nennt dann, welcher Schritt scheiterte, welche Funktion dadurch fehlt und mit welchem Befehl er sich nachholen lässt. Nur die deutschen Übersetzungen sind zwingend, ohne sie entsteht keine Datenbank.

Zwei Vorteile gegenüber dem JSON-Weg: Das Bundle bringt ein eigenständiges Binary mit, der Rechner braucht kein installiertes Bun, und es ist unempfindlich dagegen, dass Claude Desktop die Konfigurationsdatei beim Beenden zurückschreibt und unbekannte Schlüssel dabei verwirft.

Ein Bundle enthält genau ein Binary und läuft deshalb nur auf der Plattform und Architektur, für die es gebaut wurde. Für andere Ziele: `bun run build:mcpb bun-windows-x64` (bekannte Ziele nennt das Skript bei einer unbekannten Eingabe). Das Packen selbst nutzt `npx @anthropic-ai/mcpb`, braucht also einmalig Node.

**Empfohlen:** In Claude Desktop zusätzlich den Text aus
[docs/anweisungen/claude-desktop.txt](docs/anweisungen/claude-desktop.txt) unter
*Einstellungen > Anweisungen für Claude* einsetzen. Ob ein Werkzeug aufgerufen und
wie sein Ergebnis wiedergegeben wird, entscheidet der Client, denn der Server
kann es nur anbieten. Was der Text bewirkt, steht in
[docs/anweisungen/README.md](docs/anweisungen/README.md).

## Betrieb

Wer einen Client bedienen muss, der keinen Kindprozess starten kann, schaltet den HTTP-Transport frei:

```bash
MCP_HTTP_PORT=8931 bun run src/server.ts # /mcp und /health, gebunden an 127.0.0.1
```

Die Bindung an `127.0.0.1` ist Absicht. Für den Zugriff von außen gehören TLS und ein Zugriffsschutz davor, denn der Server bringt beides nicht mit.

Sieben Umgebungsvariablen steuern den Betrieb, alle optional:

| Variable | Wirkung | Ohne Angabe |
|----------|---------|-------------|
| `BIBLE_DB_PATH` | Wo die Datenbank liegt | `data/` neben dem Repository, bei einem installierten Bundle der Benutzerordner |
| `BIBLE_DEFAULT_TRANSLATION` | Welche Ausgabe ein Abruf ohne `translation` liefert. Ist der Wert unbekannt oder die Ausgabe nicht geladen, bleibt es bei Luther, und der Server vermerkt das auf stderr | `LUT` (Luther 1912) |
| `MCP_HTTP_PORT` | Gesetzt schaltet den HTTP-Transport frei | stdio |
| `MCP_HTTP_HOST` | Adresse, an die der HTTP-Transport bindet | `127.0.0.1` |
| `MCP_HTTP_ALLOWED_ORIGINS` | Kommaliste zusätzlich erlaubter `Origin`-Werte für den HTTP-Transport. Nötig, wenn ein Browser-Client wie claude.ai sonst in ein `403` läuft (siehe [docs/FEHLERBEHEBUNG.md](docs/FEHLERBEHEBUNG.md)) | leer, es gelten nur die eingebauten Regeln |
| `MCP_METRICS_PORT` | Gesetzt öffnet einen zweiten Port mit `/metrics` für Prometheus | kein Metrik-Port |
| `MCP_METRICS_HOST` | Adresse, an die der Metrik-Port bindet | `127.0.0.1` |

**Der Metrik-Port ist bewusst ein eigener Port und kein Pfad neben `/mcp`.** Wo ein Tunnel oder Reverse Proxy einen ganzen Hostnamen auf den MCP-Port leitet, wäre ein `/metrics` dort öffentlich abrufbar, und eine Herkunftsprüfung hilft nicht, weil der Proxy von `127.0.0.1` verbindet.

Gezählt werden ausschließlich Aufrufe je Werkzeug, Prompt und Ressourcenart, jeweils zusammengefasst: keine Argumente, keine Bibelstelle, kein Suchbegriff, keine Ressourcen-URI und keine Quelladresse. Daneben stehen zwei Angaben über den Prozess selbst, Startzeitpunkt und Version; sie sagen, seit wann die Zähler laufen und welcher Stand sie gefüllt hat. Lässt sich der Port nicht binden, sagt der Server das auf stderr und läuft weiter.

**`bible_setup` gibt es im HTTP-Modus nicht:** Es lädt 145 MB von fremden Quellen und ersetzt die Datenbank, und das gehört der Betreiberseite, nicht einem beliebigen Aufrufer. `/health` fragt bei jedem Aufruf die Datenbank und antwortet mit 503 samt Grund, wenn sie nicht mehr da ist. Wie der Endpunkt sich sonst verhält (erlaubte Methoden, Origin-Prüfung, Protokollversionen), steht in [docs/ENTSCHEIDUNGEN.md](docs/ENTSCHEIDUNGEN.md).

Die Datenbank baut auf einem Server `bun run setup` auf, oder, wenn dort kein Bun liegt, das Binary selbst:

```bash
./bibelstudium-server --setup             # dieselben neun Schritte, danach beendet sich der Prozess
```

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
| `bible_crossrefs` | Querverweise zu einem Vers, nach Stimmen gewichtet, dazu die Parallelgruppen der UBS-Datenbank, mit deutschem Zieltext, soweit die Wortlaut-Grenze der Ausgabe ihn zulässt |
| `bible_search` | Volltextsuche (Wörter, „Phrasen", Präfix*), umlautfaltend, je Übersetzung/Buch |
| `bible_compare` | Wort-Diff eines NT-Verses über 3 griechische Editionen plus Bezeugung über 8 Editionen |
| `bible_server_info` | Fassung dieses Servers, welche Bibeldaten er geladen hat und welche Ressourcen er anbietet, dazu je Ausgabe Lizenz, geforderte Namensnennung und `verse_max` sowie der Kanonumfang. Liefert keinen Bibeltext |
| `bible_setup` | Lädt die Bibeldaten, wenn noch keine da sind. Erscheint **nur** über stdio und nur, solange die Datenbank fehlt; lädt erst nach ausdrücklicher Bestätigung |

## Prompts

| Prompt | Anzeigename | Argumente | Ablauf |
|--------|-------------|-----------|--------|
| `word-study` | Wortstudie | `word` (Pflicht), `reference` | Grundtext-Wort, dann Konkordanz, dann Schlüsselstellen, dann Bedeutungsspektrum |
| `variant-check` | Textvarianten prüfen | `reference` (Pflicht) | Editions-Diff, dann Bezeugung, dann Lesarten je Edition, dann nüchterne Einordnung |
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
| `SLT` | **Schlachter 2000** | Mit Genehmigung der Genfer Bibelgesellschaft | gehosteter Dienst (dort Voreinstellung) |
| `LUT` | Luther 1912 | Public Domain | überall (eingebaute Voreinstellung) |
| `SCH` | Schlachter 1951 | CC BY 4.0 (Genfer Bibelgesellschaft / ebible.org) | überall |
| `ELB` | Elberfelder 1871 | Public Domain | überall |
| `MB` | Menge 1939 | Public Domain | überall |

Die Spalte „Lizenz" gibt das Feld `license` aus `src/translations.ts` wieder,
also genau das, was auch in jeder Antwort unter `quellen` steht.

Die vier frei lizenzierten Ausgaben lädt `bible_setup` von ihren Originalquellen.
Die Schlachter 2000 kommt aus keinem Download: Eine selbst aufgebaute Datenbank
führt sie nicht, und `SLT` läuft dort in die Meldung „nicht geladen". Welche
Ausgaben eine laufende Instanz tatsächlich führt, sagt `bible_server_info`.

## Editionen und Voreinstellungen

`bible_original` deckt die ganze Bibel ab und leitet nach Buch weiter:

| `texttyp` | Edition | Umfang | Rolle |
|-----------|---------|--------|-------|
| `wlc` | Westminster Leningrad Codex (masoretisch, OSHB-Morphologie) | AT (Bücher 1 bis 39) | einzige AT-Quelle, damit primär |
| `byzantine` | Mehrheitstext (Robinson-Pierpont 2005) | NT (40 bis 66) | **NT-Voreinstellung** |
| `sblgnt` | SBL Greek New Testament (kritisch, Nestle-Aland-nah) | NT | sekundär, Vergleich |
| `tr` | Textus Receptus (Scrivener-/Stephanus-Tradition) | NT | Vergleich (TR-eigene Lesarten) |

`bible_compare` meldet zusätzlich je Wort, welche von acht Editionen es bezeugen. Die acht sind NA28, NA27, Tyndale House, SBL, Westcott-Hort, Tregelles, Textus Receptus und Byzantinisch; sie stammen aus den Bezeugungsnotizen von STEPBible TAGNT und stehen als Muster in `TAGNT_WITNESS_RE` in `src/greek-diff.ts`. Vier davon sind vollständige Texte in dieser Datenbank, die übrigen vier nur Zeugen im Apparat.

Die Bezeugungsnotizen von TAGNT nennen nur die Zeugen des eigenen Apparats, und dessen „Byz" ist nicht dasselbe wie der hier geladene Robinson-Pierpont 2005. Über 400 zufällig gezogene NT-Verse gemessen widerspricht die Notiz in rund 11 % der Fälle dem Editionstext. Der Server gleicht beides ab und stellt den Widerspruch als `warnung` an den Anfang der Antwort, statt ihn in einer Fußnote zu verstecken. Für die Frage „was steht in dieser Edition" gilt der Editionstext.

## Architektur

TypeScript auf Bun, eine einzige Laufzeit-Abhängigkeit (das MCP-SDK), kein
Build-Schritt. Die Daten liegen in einer SQLite-Datei, die nur lesend geöffnet
wird; alles unter `scripts/` läuft ausschließlich beim einmaligen Datenaufbau
und nie im Serverbetrieb. Der HTTP-Transport liegt in einer eigenen Datei und
weiß von den Werkzeugen nichts. Welche Datei was tut, steht in
[CONTRIBUTING.md](CONTRIBUTING.md).

### Designentscheidungen

**Warum keine mitgelieferte Datenbank?** Drei Gründe. STEPBible bittet darum, ihre Datendateien nur aus dem eigenen Repository zu verbreiten. Eine selbst aufgebaute Datenbank mit `provenance`-Tabelle (Quell-URL und SHA-256 je Download) ist nachrechenbar, wie es ein heruntergeladener Datenklumpen nie sein kann: `bun run pruefe:quellen` vergleicht jede Prüfsumme mit `quellen-pruefsummen.json` und meldet in beide Richtungen, was fehlt oder zu viel ist. Und die Aufbau-Skripte dokumentieren zugleich, woher jedes einzelne Wort stammt.

Der Preis dafür war früher ein Terminal-Schritt. Den nimmt seit `bible_setup` der Server ab.

**Warum baut der Server die Daten erst auf Nachfrage?** Der Aufbau lädt rund 145 MB von neun fremden Quellen. Das gehört nicht angestoßen, weil ein Modell nach einem Vers gefragt hat, sondern erst, wenn die Nutzerin zugestimmt hat. Ohne Bestätigung nennt `bible_setup` nur, was es täte.

**Warum Luther 1912 als Voreinstellung?** Es ist die bekannteste gemeinfreie deutsche Übersetzung, und sie ist in **jeder** Installation vorhanden, weil `bun run download` sie ohne Ausnahme mitlädt. Das ist der eigentliche Grund, denn eine Voreinstellung, die eine Instanz nicht geladen hat, ließe jeden Abruf ohne `translation` in eine Fehlermeldung laufen. Schlachter 1951 (CC BY), Elberfelder 1871 und Menge 1939 sind einen Parameter entfernt, und `translation-compare` stellt sie nebeneinander.

Ein Endpunkt darf davon abweichen, ohne den Code zu ändern: `BIBLE_DEFAULT_TRANSLATION` setzt die Vorgabe auf ein anderes Kürzel, sofern die Ausgabe geladen ist. Welche Vorgabe tatsächlich gilt, nennt `bible://uebersetzungen` im Feld `voreinstellung`; der gehostete Dienst führt darüber die Schlachter 2000.

**Warum ist der Byzantinische Mehrheitstext die NT-Voreinstellung?** Der Server dient wortgetreuer Arbeit, und die hier mitgelieferten deutschen Übersetzungen stehen in der Mehrheitstext-Tradition (Luther und Schlachter folgen der TR-/byzantinischen Linie). Der kritische SBLGNT ist über `texttyp: "sblgnt"` vollständig verfügbar, und `bible_compare` zeigt genau, wo die Editionen auseinandergehen, samt Bezeugung zur Beurteilung jeder Lesart.

**Warum englische Tool-Namen bei deutscher Ausgabe?** MCP-Tool-Namen sind Entwickler-Oberfläche (englische Konvention); der Inhalt, den ein Mensch liest, ist deutsch, weil der ausgelieferte Bibeltext deutsch ist.

**Warum nur eine Abhängigkeit und kein Build-Schritt?** `bun:sqlite` steckt in Bun, und Bun führt TypeScript direkt aus. Die einzige Laufzeit-Abhängigkeit ist das MCP-SDK. Weniger Angriffsfläche, nichts zu kompilieren, nichts, was kaputtgehen kann.

## Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [docs/README.md](docs/README.md) | Index über die Dokumentation: welcher Zweig wofür da ist, was `status:` bedeutet, wo Frontmatter steht und wo nicht |
| [docs/anweisungen/claude-desktop.txt](docs/anweisungen/claude-desktop.txt) | Fertiger Text für *Einstellungen > Anweisungen für Claude* in Claude Desktop |
| [docs/anweisungen/README.md](docs/anweisungen/README.md) | Wozu die Client-Anweisungen dienen, wohin sie gehören, und warum sie knapp bleiben müssen, denn sie werden in jeder Sitzung geladen, auch ohne biblische Frage |
| [docs/BEISPIELE.md](docs/BEISPIELE.md) | Wie die Antworten aussehen: Grundtext, Textkritik, Verstext, und ein Weg, den Server ohne MCP-Client auszuprobieren |
| [docs/ENTSCHEIDUNGEN.md](docs/ENTSCHEIDUNGEN.md) | Warum der Code so aussieht: gemessene Befunde, verworfene Alternativen, Erfahrungen mit Clients und fremden Quellen |
| [docs/FEHLERBEHEBUNG.md](docs/FEHLERBEHEBUNG.md) | Fehlerbilder beim Datenaufbau und Serverstart, jeweils mit Ursache und Behebung |
| [docs/TYPESCRIPT.md](docs/TYPESCRIPT.md) | Code-Stil-Regeln, Typecheck, bewusst nicht übernommene Konventionen |
| [docs/UEBERSETZUNGEN.md](docs/UEBERSETZUNGEN.md) | Geprüfte Optionen für weitere Übersetzungen: Lizenzlage, freie Kandidaten, Kosten einer Aufnahme |
| [mcpb/manifest.json](mcpb/manifest.json) | Manifest-Quelle des MCPB-Bundles für Claude Desktop; gebaut wird es mit `bun run build:mcpb` |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Mitwirken: Grundregeln, Prüfschritte, Pull-Request-Ablauf |
| [CHANGELOG.md](CHANGELOG.md) | Was sich je Fassung geändert hat, mit Begründung und Messwerten |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | Vollständige Quellen- und Lizenztabelle aller Bibeldaten |
| [SECURITY.md](SECURITY.md) | Sicherheitsmodell und Meldeweg für Schwachstellen |

## Datenquellen und Lizenzen

Alle Datenquellen, die dieses Repository lädt, sind Public Domain oder CC-BY(-SA); die vollständige Tabelle steht in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), einschließlich der vorgeschriebenen Namensnennung für Schlachter 1951 (CC BY 4.0, © Genfer Bibelgesellschaft) und des STEPBible-Hinweises zur Weiterverbreitung. Die Schlachter 2000 steht auf eigener Grundlage: Sie ist nicht Teil dieses Repositories und wird allein über den gehosteten Dienst angeboten, mit Genehmigung der Genfer Bibelgesellschaft.

## Mitwirken

Beiträge sind willkommen, siehe [CONTRIBUTING.md](CONTRIBUTING.md). Bitte beachte die Datenqualitäts-Regel: Jede Aussage über den Text muss gegen die Datenbank überprüfbar sein (die Hausregel lautet „Belege statt Behauptungen").

## Lizenz

MIT-Lizenz, siehe [LICENSE](LICENSE). Die Lizenz deckt den Code; die Bibeldaten werden lokal heruntergeladen und unterliegen ihren eigenen Lizenzen (siehe oben).

## Autor

**Marc Allgeier** ([@fidpa](https://github.com/fidpa))

**Warum ich das gebaut habe**: Ich wollte einen KI-Assistenten, der mit der Schrift so umgeht wie ein sorgfältiger Leser: exakt zitieren, im Grundtext nachsehen statt zu raten, und ehrlich benennen, wo die Handschriften auseinandergehen. Im öffentlichen MCP-Ökosystem gab es englische Server mit guten Lexika, aber nichts Deutsches, nichts Offline-Fähiges mit mehreren Grundtext-Editionen und nichts, was Textvarianten mit ihren Zeugen zeigen konnte. Diese Lücke schließt der Server.

## Siehe auch

- [lydia-bible-bot](https://github.com/fidpa/lydia-bible-bot): sicherheitsgehärteter KI-Bibelassistent für Telegram-Gruppen, der seinen Bibeltext über den gehosteten Dienst dieses Servers bezieht
