# Fehlerbehebung

Alle Fehlerbilder unten sind reproduziert, nicht vermutet. Die Meldungen des
Servers gehen nach **stderr** (stdout gehört dem JSON-RPC-Protokoll), im
MCP-Client stehen sie im Server-Log.

## Serverstart

### `unable to open database file`

```
Failed to open Bible database at …/data/bible.db: SQLiteError: unable to open database file
Run 'bun run download' first to download the data.
```

**Ursache**: Es gibt noch keine Datenbank. Das Repository liefert bewusst keine
mit (siehe README § Bekannte Grenzen).

**Behebung**: Den Datenaufbau aus dem Schnellstart durchlaufen lassen, beginnend
mit `bun run download`.

### `Bible database is incomplete (missing tables: …)`

**Ursache**: Die Datei existiert, enthält aber nicht die Grundtabellen, typisch
nach einem abgebrochenen ersten Durchlauf oder wenn eine leere Datei angelegt
wurde.

**Behebung**: `bun run download` erneut ausführen. Das Skript baut die
Übersetzungen vollständig neu auf; bereits vorhandene Zusatzdaten (Grundtext,
Lexika, Querverweise) bleiben erhalten.

### `The verses table has no 'translation' column (old database layout)`

**Ursache**: Eine Datenbank aus einer Fassung vor der Mehr-Übersetzungs-Umstellung.

**Behebung**: `bun run download`: Die Migration greift automatisch und lädt
die Verse neu.

### Server startet, aber ein Werkzeug meldet fehlende Daten

| Meldung | Fehlendes Skript |
|---------|------------------|
| `Urtext-Daten nicht geladen…` | `bun run download:byz` (bzw. `download:sblgnt`, `download:tr`, `download:heb`) |
| `Volltext-Index nicht gebaut…` | `bun run build:fts` |
| `Mindestens zwei NT-Editionen nötig…` | mindestens zwei von `download:byz` / `download:sblgnt` / `download:tr` |

Der Server startet absichtlich auch mit unvollständigen Daten: Alles, wofür
Daten vorhanden sind, funktioniert; die übrigen Werkzeuge melden gezielt, welches
Skript fehlt.

### Der Client ruft die Werkzeuge nicht auf

Der Server ist verbunden und die Werkzeuge erscheinen, das Modell antwortet aber
aus dem Gedächtnis statt nachzuschlagen. Gemessen am 25.07.2026 in Claude
Desktop: Bei einer erfundenen Stelle („Schlag mir ‚Hesekiel-Zusatz 1,1' nach")
blieb der Aufruf aus, je sicherer eine Referenz als nicht existent gilt, desto
weniger Anlass scheint zu bestehen, sie zu prüfen. Bei „Sirach 1,1", einem real
existierenden, nur kanonfremden Buch, wurde von selbst aufgerufen. Auf
ausdrückliche Aufforderung lief der Aufruf und lieferte das Richtige.

Die Tool-Beschreibungen weisen inzwischen ausdrücklich auf Existenz- und
Kanonfragen hin; das allein genügte nicht. Wirksamer sind Anweisungen auf
Client-Seite (Claude Desktop: *Einstellungen › Anweisungen für Claude*,
Claude Code: `CLAUDE.md` des konsumierenden Repos):

```text
Bibelstellen: Wenn der MCP-Server "bibelstudium" verbunden ist, beantworte
Fragen zu Bibeltext, Grundtext, Querverweisen oder Textvarianten ausschließlich
über dessen Werkzeuge, nie aus dem Gedächtnis.

Das gilt besonders, wenn eine Stelle unbekannt, falsch geschrieben oder
erfunden wirkt: Frage den Server, BEVOR du sagst, dass es ein Buch oder eine
Stelle nicht gibt. Er nennt das nächstliegende Buch und den Kanonumfang. Eine
verdächtige Referenz ist ein Grund nachzuschlagen, kein Grund es zu lassen.

Gib Warnungen und Hinweise der Werkzeuge (warnung, quellenkonflikte, hinweis,
lesehinweis) in der Antwort wieder, statt sie wegzulassen.

Zitiere den Grundtext buchstabengetreu: Mehrheitstext und Textus Receptus
liegen unakzentuiert vor: keine Akzente ergänzen, beim Hebräischen keine
Zeichen entfernen.
```

Ob aufgerufen wird, entscheidet am Ende der Client, auch das bleibt ein Anreiz,
keine Garantie.

### Eine Ressource lässt sich nicht anhängen

Ressourcen erscheinen in Claude Code in der `@`-Vervollständigung neben den
Dateien, referenziert als `@server:protocol://resource/path`. Zwei Dinge
verhindern, dass der Inhalt beim Modell ankommt, beide gemessen am 02.08.2026 in
einer Sitzung.

**Der Servername darf keine Leerzeichen enthalten.** Als Connector heißt dieser
Server `claude.ai Bibelstudium MCP`, das Präfix setzt der Client. Wegen der
Leerzeichen setzt die Vervollständigung ein Anführungszeichen, das die
dokumentierte Form nicht kennt; in vier Versuchen kam nur die getippte Zeile an,
ohne Inhalt. Ausweg ist ein lokaler Eintrag desselben Endpunkts unter einem
kurzen Namen:

```bash
claude mcp add --transport http bibelstudium https://mcp.bibelstudium-mcp.de/mcp
```

Danach kommt `@bibelstudium:bible://quellen` vollständig an. Ein frisch
eingetragener Server wird erst nach einem Neustart der Sitzung wirksam; davor
sieht der Versuch wie ein Fehlschlag aus.

**Die URI-Vorlagen sind über `@` nicht erreichbar.** Sie werden angeboten, eine
daraus gebildete URI wird aber nicht aufgelöst:
`@bibelstudium:bible://kapitel/LUT/Psalter/23` kam nicht an, während
`@bibelstudium:bible://quellen` unmittelbar davor ankam; ein Kontrollserver über
stdio zeigte dasselbe Bild. Für Kapitel, Verse und Grundtext führt der Weg
deshalb über die Werkzeuge (`bible_lookup`, `bible_original`). Abrufbar bleiben
die Vorlagen trotzdem, über `resources/read` und über das Ressourcen-Werkzeug
des Clients; nur die Geste mit `@` erreicht sie nicht.

Für Claude Desktop und claude.ai ist beides nicht gemessen.

### Ein fehlerhafter Ressourcen-Abruf meldet nur „Resource not found"

Wird eine Ressource mit falscher URI abgerufen, zeigt Claude Code seit 0.5.11
eine eigene Meldung statt der des Servers:

```
Resource not found: bible://kapitel/LUT/Gibtsnicht/1 — it may have been
deleted or the URI is stale. Re-run ListMcpResourcesTool to refresh.
```

Der Rat führt hier in die Irre: Die Liste neu zu laden ändert nichts, wenn das
Buch nicht existiert oder die URI zu wenige Segmente hat. Der Server sagt genau
das, seine Antwort erreicht den Nutzer in diesem Client aber nicht mehr.

**Ursache**: Seit 0.5.11 tragen Fehler des Aufrufers den Code `-32602`
(Invalid params) statt `-32603` (Internal error), wie es die Spezifikation
vorsieht. Bei `resources/read` deutet dieser Client den Code als „nicht
gefunden" und ersetzt den Meldungstext. Gemessen am 02.08.2026 gegen denselben
Endpunkt vor und nach dem Ausrollen: unter 0.5.10 kam
`MCP error -32603: "Gibtsnicht" ist kein Buch dieser Bibel-Datenbank …` samt
Kanonerklärung und nächstliegendem Buch an, unter 0.5.11 die generische Meldung
oben, bei zeichengleichem Servertext. Zwei Fehlerarten geprüft (unbekanntes
Buch, zu wenige Segmente), beide gleich; ein gültiger Abruf funktioniert
unverändert.

**Behebung**: Dieselbe Frage über das Werkzeug stellen. `bible_lookup` liefert
den vollen Text, weil Werkzeugfehler als Ergebnis mit `isError` zurückkommen und
nicht als JSON-RPC-Fehler:

```text
bible_lookup mit book="Gibtsnicht", chapter=1
→ "Gibtsnicht" ist kein Buch dieser Bibel-Datenbank. Diese Datenbank enthält
  die 66 Bücher des protestantischen Kanons; apokryphe/deuterokanonische
  Schriften fehlen. Erwartet wird der deutsche Buchname (z. B. "Jesaja",
  "1. Mose", "Römer") oder eine Abkürzung (z. B. "Jes", "1Mo", "Röm").
```

Liegt ein bekanntes Buch nahe genug, nennt die Meldung es zusätzlich
(„Hesekiel-Zusatz" führt auf „Hesekiel"); bei einem Namen ohne Ähnlichkeit wie
oben entfällt dieser Teil.

Betroffen sind nur Ressourcen und nur dieser Client. Prompts geben ihre Meldung
weiterhin im Wortlaut aus, Werkzeuge ohnehin. Für Claude Desktop und claude.ai
ist es nicht gemessen.

## HTTP-Modus

Der Modus startet nur mit gesetztem `MCP_HTTP_PORT` und bindet ohne
`MCP_HTTP_HOST` an `127.0.0.1`. Zwei Endpunkte: `/mcp` und `/health`.

### `/health` antwortet mit 503

Der Prozess läuft, die Datenbank nicht. Der Grund steht im Rumpf:

| Grund | Behebung |
|-------|----------|
| `Es ist noch keine Bibeldatenbank vorhanden.` | Daten aufbauen (siehe nächster Punkt) |
| `Der Datenbank fehlen Tabellen (…)` | `bun run download` |
| `Die Datenbank enthält keine Verse.` | `bun run download` |
| `Die Tabelle 'verses' hat keine Spalte 'translation' (alter Aufbau).` | `bun run download`, siehe [oben](#the-verses-table-has-no-translation-column-old-database-layout) |
| `Die Datenbank antwortet, enthält aber keine Bücher.` | `bun run download` |
| `Die Datenbank ist nicht lesbar: …` | Datei beschädigt oder halb geschrieben; neu aufbauen |

Das sind alle Gründe, die der Server erzeugen kann.

`/health` fragt die Datenbank bei jedem Aufruf, nicht nur beim Start: Ein Schaden
im laufenden Betrieb wird deshalb sichtbar. Nach einem Neuaufbau ist ein Neustart
nötig, weil der Prozess über seinen Dateideskriptor weiter die alte Datei hält.

### `bible_setup` fehlt in der Werkzeugliste

Kein Fehler, sondern Absicht: Das Werkzeug lädt rund 145 MB von acht fremden
Quellen und ersetzt die Datenbankdatei, und das gehört nicht in die Hand eines
beliebigen Aufrufers. Im HTTP-Modus wird es weder angeboten noch ausgeführt.

Die Daten baut stattdessen die Betreiberseite auf, entweder mit `bun run setup`
oder, wenn auf dem Zielrechner kein Bun liegt, mit dem Binary selbst:

```bash
./bibelstudium-server --setup      # baut die Datenbank und beendet sich
```

Wo die Datei landet, entscheidet `BIBLE_DB_PATH` (siehe `db-path.ts`).

### Anfragen kommen mit `403 Forbidden origin` zurück

Der Aufrufer schickt einen `Origin`-Kopf, der nicht freigegeben ist. Die
Spezifikation verlangt diese Prüfung gegen DNS-Rebinding. MCP-Clients sind keine
Browser und schicken keinen Origin, sind also nicht betroffen. Für einen
browserbasierten Client die erlaubten Herkünfte ausdrücklich freigeben:

```bash
MCP_HTTP_ALLOWED_ORIGINS=https://example.com MCP_HTTP_PORT=8931 bun run server.ts
```

### `413` bei einer großen Anfrage

Der Rumpf ist größer als 1 MB. Das ist die Obergrenze und liegt weit über jedem
echten Werkzeugaufruf; kommt sie vor, stimmt etwas mit dem Client nicht.

## Datenaufbau

### `'unzip' not found in $PATH`

**Ursache**: `download-crossrefs.ts` entpackt das Archiv von OpenBible.info mit
dem System-`unzip`. Bun bringt keine Zip-Unterstützung mit, und das Repository
nimmt dafür bewusst keine Abhängigkeit auf.

**Behebung**: `sudo apt install unzip` (Debian/Ubuntu) bzw.
`sudo dnf install unzip` (Fedora). Auf macOS ist `unzip` vorinstalliert. Die
Prüfung läuft **vor** dem Download: Es geht keine Übertragung verloren.

### `Retry 1/3 after 1000ms: …` während `download.ts`

**Ursache**: Aussetzer oder Drosselung der bolls.life-API. Das Skript wiederholt
dreimal mit exponentiell wachsender Wartezeit.

**Behebung**: Keine, abwarten. Erst wenn alle drei Versuche scheitern, bricht
das Skript ab und lässt die bestehende Datenbank unangetastet. Danach das Skript
einfach erneut starten.

### Der Aufbau dauert deutlich länger als angegeben

Zu erwarten ist **unter einer Minute** für alle acht Schritte: `download.ts`
holt je Übersetzung einen statischen Export, die sieben übrigen Skripte je wenige
Dateien. Gemessen wurden 26 s auf einem Mac mini und 46 s auf einem
NAS (x86-64, Ubuntu). Der Aufbau ist netzwerk-, nicht CPU-gebunden.

Dauert er **rund 20 Minuten**, läuft ein Checkout vor 0.3.0: Bis dahin stellte
`download.ts` je Übersetzung 1.190 Kapitel-Anfragen mit 200 ms Wartezeit
dazwischen, also 4.760 insgesamt. Genau davon rät die API-Dokumentation von
bolls.life ausdrücklich ab; der Umbau auf den vorgesehenen Export-Endpunkt
brachte dieselben Verse byteweise identisch in 3,2 s. In diesem Fall nicht
warten, sondern aktualisieren.

Dauert er merklich länger als eine Minute, ohne dass es an der Fassung liegt,
sind die Wiederholungen die wahrscheinliche Ursache (siehe voriger Punkt).

### Daten eines Downloads sind nach einem weiteren Lauf verschwunden

**Ursache**: Zwei Download-Skripte liefen gleichzeitig. Jedes arbeitet auf einer
eigenen Kopie der Datenbank und tauscht sie am Ende atomar aus, beim parallelen
Lauf gewinnt der letzte Austausch, die Ergänzungen des anderen sind verloren.

**Behebung**: Skripte strikt nacheinander ausführen und den betroffenen Download
wiederholen.

### `disk I/O error` in einer anderen Sitzung während eines Downloads

**Ursache**: Ein laufender Server hielt die Datenbank offen, während sie ersetzt
wurde.

**Behebung**: Der Fehler ist mit dem atomaren Austausch (`atomic-db.ts`)
konstruktiv ausgeschlossen, solange die Datenbank nicht direkt bearbeitet wird.
Tritt er dennoch auf, den MCP-Client den Server neu starten lassen, er öffnet
die Datei dann frisch.

## Entwicklung

### `bun run typecheck` meldet `Script not found "tsc"`

**Ursache**: Nicht das Repository, sondern das Dateisystem. `node_modules/.bin/tsc`
ist ein Symlink; auf Ablagen ohne Symlink-Unterstützung (SSHFS- und manche
Netzlaufwerke, FAT/exFAT-USB-Medien, synchronisierte Cloud-Ordner) lässt er sich
nicht auflösen, obwohl `node_modules/typescript` installiert ist.

**Behebung**: Das Repository auf ein lokales Dateisystem legen. Zur Kontrolle:

```bash
ls -la node_modules/.bin/tsc   # meldet „Operation nicht erlaubt"? → Dateisystem
```

### Editor zeigt Fehler an korrektem Code

Ohne `tsconfig.json` kann ein Editor weder `bun:sqlite` noch `import.meta.path`
noch die `.ts`-Importendungen dieses Repositories auflösen. Die Datei liegt bei.
Sie muss nur vom Editor gefunden werden, also das **Repository-Wurzelverzeichnis**
öffnen, nicht einen Unterordner.

## Daten prüfen

Die Datenbank ist eine gewöhnliche SQLite-Datei und lässt sich direkt befragen:

```bash
# Woher stammen die Daten? (Quelle, Anzahl Anfragen, Prüfsumme, Zeitpunkt)
sqlite3 data/bible.db "SELECT script, source, files, fetched_at FROM provenance ORDER BY script"

# Vollständigkeit je Übersetzung (erwartet: rund 31.100 Verse je Übersetzung)
sqlite3 data/bible.db "SELECT translation, COUNT(*) FROM verses GROUP BY translation"

# Vollständigkeit je Grundtext-Edition
sqlite3 data/bible.db "SELECT edition, COUNT(*) FROM original_words GROUP BY edition"

# Unversehrtheit der Datei
sqlite3 data/bible.db "PRAGMA integrity_check"
```

Weichen zwei Datenbanken voneinander ab, obwohl sie aus denselben Quellen
stammen, zeigt der Vergleich der `provenance`-Prüfsummen, welche Quelle sich
verändert hat.
