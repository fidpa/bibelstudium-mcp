# Fehlerbehebung

Alle Fehlerbilder unten sind reproduziert, nicht vermutet. Die Meldungen des
Servers gehen nach **stderr** (stdout gehört dem JSON-RPC-Protokoll) — im
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

**Ursache**: Die Datei existiert, enthält aber nicht die Grundtabellen — typisch
nach einem abgebrochenen ersten Durchlauf oder wenn eine leere Datei angelegt
wurde.

**Behebung**: `bun run download` erneut ausführen. Das Skript baut die
Übersetzungen vollständig neu auf; bereits vorhandene Zusatzdaten (Grundtext,
Lexika, Querverweise) bleiben erhalten.

### `The verses table has no 'translation' column (old database layout)`

**Ursache**: Eine Datenbank aus einer Fassung vor der Mehr-Übersetzungs-Umstellung.

**Behebung**: `bun run download` — die Migration greift automatisch und lädt
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
blieb der Aufruf aus — je sicherer eine Referenz als nicht existent gilt, desto
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
über dessen Werkzeuge — nie aus dem Gedächtnis.

Das gilt besonders, wenn eine Stelle unbekannt, falsch geschrieben oder
erfunden wirkt: Frage den Server, BEVOR du sagst, dass es ein Buch oder eine
Stelle nicht gibt. Er nennt das nächstliegende Buch und den Kanonumfang. Eine
verdächtige Referenz ist ein Grund nachzuschlagen, kein Grund es zu lassen.

Gib Warnungen und Hinweise der Werkzeuge (warnung, quellenkonflikte, hinweis,
lesehinweis) in der Antwort wieder, statt sie wegzulassen.

Zitiere den Grundtext buchstabengetreu: Mehrheitstext und Textus Receptus
liegen unakzentuiert vor — keine Akzente ergänzen, beim Hebräischen keine
Zeichen entfernen.
```

Ob aufgerufen wird, entscheidet am Ende der Client — auch das bleibt ein Anreiz,
keine Garantie.

## Datenaufbau

### `'unzip' not found in $PATH`

**Ursache**: `download-crossrefs.ts` entpackt das Archiv von OpenBible.info mit
dem System-`unzip`. Bun bringt keine Zip-Unterstützung mit, und das Repository
nimmt dafür bewusst keine Abhängigkeit auf.

**Behebung**: `sudo apt install unzip` (Debian/Ubuntu) bzw.
`sudo dnf install unzip` (Fedora). Auf macOS ist `unzip` vorinstalliert. Die
Prüfung läuft **vor** dem Download — es geht keine Übertragung verloren.

### `Retry 1/3 after 1000ms: …` während `download.ts`

**Ursache**: Aussetzer oder Drosselung der bolls.life-API. Das Skript wiederholt
dreimal mit exponentiell wachsender Wartezeit.

**Behebung**: Keine — abwarten. Erst wenn alle drei Versuche scheitern, bricht
das Skript ab und lässt die bestehende Datenbank unangetastet. Danach das Skript
einfach erneut starten.

### Der Aufbau dauert deutlich länger als angegeben

`download.ts` stellt vier Übersetzungen à 1.190 Kapitel-Anfragen mit 200 ms
Wartezeit dazwischen — die Untergrenze liegt damit bei rund 16 Minuten, gemessen
wurden ~20 Minuten. Die sieben übrigen Skripte laden je wenige Dateien und
brauchen zusammen etwa eine Minute. Der Aufbau ist netzwerk-, nicht CPU-gebunden:
Auf einem Raspberry Pi 5 und auf einem Mac mini ergaben sich praktisch dieselben
Zeiten.

### Daten eines Downloads sind nach einem weiteren Lauf verschwunden

**Ursache**: Zwei Download-Skripte liefen gleichzeitig. Jedes arbeitet auf einer
eigenen Kopie der Datenbank und tauscht sie am Ende atomar aus — beim parallelen
Lauf gewinnt der letzte Austausch, die Ergänzungen des anderen sind verloren.

**Behebung**: Skripte strikt nacheinander ausführen und den betroffenen Download
wiederholen.

### `disk I/O error` in einer anderen Sitzung während eines Downloads

**Ursache**: Ein laufender Server hielt die Datenbank offen, während sie ersetzt
wurde.

**Behebung**: Der Fehler ist mit dem atomaren Austausch (`atomic-db.ts`)
konstruktiv ausgeschlossen, solange die Datenbank nicht direkt bearbeitet wird.
Tritt er dennoch auf, den MCP-Client den Server neu starten lassen — er öffnet
die Datei dann frisch.

## Entwicklung

### `bun run typecheck` meldet `Script not found "tsc"`

**Ursache**: Nicht das Repository, sondern das Dateisystem. `node_modules/.bin/tsc`
ist ein Symlink; auf Ablagen ohne Symlink-Unterstützung (SSHFS- und manche
Netzlaufwerke, FAT/exFAT-USB-Medien, synchronisierte Cloud-Ordner) lässt er sich
nicht auflösen — obwohl `node_modules/typescript` installiert ist.

**Behebung**: Das Repository auf ein lokales Dateisystem legen. Zur Kontrolle:

```bash
ls -la node_modules/.bin/tsc   # meldet „Operation nicht erlaubt"? → Dateisystem
```

### Editor zeigt Fehler an korrektem Code

Ohne `tsconfig.json` kann ein Editor weder `bun:sqlite` noch `import.meta.path`
noch die `.ts`-Importendungen dieses Repositories auflösen. Die Datei liegt bei —
sie muss nur vom Editor gefunden werden, also das **Repository-Wurzelverzeichnis**
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
