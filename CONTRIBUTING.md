# Mitwirken an bibelstudium-mcp

Danke, dass du über einen Beitrag nachdenkst. Willkommen ist alles: Fehlerberichte, Funktionswünsche, Verbesserungen an der Dokumentation und Codeänderungen.

## Verhaltenskodex

Für dieses Projekt und alle Beteiligten gilt unser [Verhaltenskodex](CODE_OF_CONDUCT.md). Mit deiner Teilnahme erklärst du dich bereit, ihn einzuhalten.

## Erste Schritte

1. **Repository forken** auf GitHub
2. **Fork lokal klonen**:
   ```bash
   git clone https://github.com/DEIN_BENUTZERNAME/bibelstudium-mcp.git
   cd bibelstudium-mcp
   ```
3. **Installieren und Datenbank aufbauen**:
   ```bash
   bun install
   bun run download        # und die übrigen Download-Skripte, siehe README
   ```

## Grundregeln

- **Belege statt Behauptungen.** Jede Aussage über den Bibeltext muss gegen die tatsächliche Datenbank (SQL-Abfrage) oder einen frischen stdio-Lauf des Servers geprüft sein, niemals aus dem Gedächtnis. Das gilt für Codekommentare, Dokumentation und Pull-Request-Beschreibungen gleichermaßen.
- **Tool-Namen und Ausgabefelder sind öffentliche Schnittstelle.** Ein Werkzeug umzubenennen oder ein Ausgabefeld zu ändern bzw. zu entfernen ist ein Breaking Change; Ergänzungen sind unproblematisch.
- **Lizenzfragen sind nicht verhandelbar.** Neue Datenquellen brauchen eine geprüfte freie Lizenz, bevor sie eingebunden werden (und einen Eintrag in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)). Mitgelieferte Datendateien gibt es nicht; Daten werden von Skripten geladen, mit Herkunftsnachweis.
- **Den Footprint halten.** Eine Laufzeit-Abhängigkeit (das MCP-SDK), kein Build-Schritt, Bun-nativ. Ein Pull Request, der eine Abhängigkeit hinzufügt, braucht einen sehr guten Grund.
- **Code-Stil**: siehe [docs/TYPESCRIPT.md](docs/TYPESCRIPT.md).

## Aufbau

Wo was liegt. Die Importe gehen in eine Richtung: `server.ts` kennt die
Module unter `src/`, keines davon kennt `server.ts`. Alles unter `scripts/`
läuft ausschließlich beim Datenaufbau.

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
| `scripts/build-fts.ts` | Baut den Volltext-Index neu; nötig nur, wenn er fehlt oder beschädigt ist |
| `scripts/import-schlachter2000.ts` | Einspielen der Schlachter 2000 aus einer USX-Lieferung. Die Lieferung ist **nicht** Teil dieses Repositories und `bible_setup` kennt das Skript nicht; eine selbst aufgebaute Datenbank führt die Ausgabe darum nie |
| `scripts/build-mcpb.ts` | Baut das MCPB-Bundle für Claude Desktop. Seine Größe hängt an der Bun-Fassung, mit der kompiliert wird; die veröffentlichten Bundles baut die CI gegen die in `release.yml` benannte Fassung (siehe [docs/ENTSCHEIDUNGEN.md](docs/ENTSCHEIDUNGEN.md)) |
| `tests/golden/*.ts` | Ein Prüfbündel je Werkzeug, dazu die Fälle, die zu keinem gehören; jedes einzeln lauffähig |
| `tests/test-http.ts` | Transportverhalten über HTTP (Statuscodes, `Allow`, Origin); braucht keine Datenbank |
| `tests/schema-coverage.ts` | Breitentest: jede Antwort gegen ihr deklariertes `outputSchema` |
| `mcpb/manifest.json` | Manifest-Quelle des Bundles |
| `data/bible.db` | SQLite (gitignored, lokal aufgebaut) |

## Änderungen prüfen

Zuerst der Typecheck. Er braucht keine Datenbank und ist das, was die CI erzwingt:

```bash
bun run typecheck
```

Dann die Tests. Es gibt kein Test-Framework, und es gibt keine Fixture-Datenbank. Eine erfundene Datenbank kann Bibeldaten nicht überprüfen, deshalb wird gegen den echten Server und die echte Datenbank verifiziert.

```bash
bun run test:http     # Transportverhalten über HTTP, braucht KEINE Datenbank
bun run test          # Zusicherungen gegen einen frischen Server über stdio
bun run test:schemas   # jede Antwort gegen ihr deklariertes outputSchema
```

`test:http` läuft überall, auch in der CI. Die beiden anderen brauchen eine gebaute Datenbank (`bun run setup`); ohne sie brechen sie ab, und das ist kein Fehler des Codes.

`bun run test` fährt zwölf Bündel, eines je Werkzeug plus die Fälle, die zu keinem gehören. Jedes Bündel ist auch einzeln lauffähig, was beim Suchen hilft:

```bash
bun run tests/golden/lookup.ts
```

Wer eine Zusicherung ergänzt, hängt sie in das Bündel des betroffenen Werkzeugs und zieht die Mindestzahl in `tests/test-golden.ts` mit.

Was die Tests nicht abdecken, bleibt Handarbeit:

1. Betroffene Daten mit dem passenden `download-*.ts`-Skript neu aufbauen
2. Stichprobe per SQL: `sqlite3 data/bible.db "…"`
3. Rauchtest über stdio: JSON-RPC-Zeilen `initialize` → `notifications/initialized` → `tools/call` in `bun run src/server.ts` leiten
4. Bei Änderungen an der Morphologie: Imperativ, Partizip, Infinitiv **und** Nicht-Verben testen, in allen betroffenen Editionen

Häufige Fehlerbilder samt Ursache stehen in [docs/FEHLERBEHEBUNG.md](docs/FEHLERBEHEBUNG.md).

## Änderungen einreichen

1. Feature-Branch anlegen (`git checkout -b feature/meine-aenderung`)
2. Änderungen in nachvollziehbaren Commits umsetzen
3. Wie oben verifizieren und die Belege in die Pull-Request-Beschreibung aufnehmen
4. Pull Request gegen `main` eröffnen

## Sprache

Die Dokumentation dieses Repositories ist deutsch, weil sich der Server an den deutschsprachigen Raum richtet. **Die Codekommentare sind es ebenfalls**, seit sie am 03.08.2026 umgestellt wurden; Konventionen dazu in [docs/TYPESCRIPT.md](docs/TYPESCRIPT.md) unter „Kommentare". Englisch bleiben: Bezeichner, Commit-Nachrichten, Tool-Namen, die Tool-Beschreibungen im MCP-Protokoll und wörtliche Zitate fremder Meldungen. Issues und Pull Requests darfst du auf Deutsch oder Englisch verfassen.

## git blame

Die Umstellung der Kommentare auf Deutsch hat fast jede Datei angefasst, ohne eine Zeile Code zu ändern. Damit sie in `git blame` nicht jede Zeile überschreibt:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Einmal je Klon gesetzt, danach übergeht `git blame` die dort gelisteten reinen Formatierungs-Commits.
