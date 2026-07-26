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
- **Lizenzfragen sind nicht verhandelbar.** Neue Datenquellen brauchen eine geprüfte freie Lizenz, bevor sie eingebunden werden (und einen Eintrag in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)). Keine mitgelieferten Datendateien: Daten werden von Skripten geladen, mit Herkunftsnachweis.
- **Den Footprint halten.** Eine Laufzeit-Abhängigkeit (das MCP-SDK), kein Build-Schritt, Bun-nativ. Ein Pull Request, der eine Abhängigkeit hinzufügt, braucht einen sehr guten Grund.
- **Code-Stil**: siehe [docs/TYPESCRIPT.md](docs/TYPESCRIPT.md).

## Änderungen prüfen

Zuerst der Typecheck. Er braucht keine Datenbank und ist das, was die CI erzwingt:

```bash
bun run typecheck
```

Darüber hinaus gibt es keine Testsuite: Eine Fixture-Datenbank kann Bibeldaten nicht überprüfen, deshalb wird gegen den echten Server und die echte Datenbank verifiziert.

1. Betroffene Daten mit dem passenden `download-*.ts`-Skript neu aufbauen
2. Stichprobe per SQL: `sqlite3 data/bible.db "…"`
3. Rauchtest über stdio: JSON-RPC-Zeilen `initialize` → `notifications/initialized` → `tools/call` in `bun run server.ts` leiten
4. Bei Änderungen an der Morphologie: Imperativ, Partizip, Infinitiv **und** Nicht-Verben testen, in allen betroffenen Editionen

Häufige Fehlerbilder samt Ursache stehen in [docs/FEHLERBEHEBUNG.md](docs/FEHLERBEHEBUNG.md).

## Änderungen einreichen

1. Feature-Branch anlegen (`git checkout -b feature/meine-aenderung`)
2. Änderungen in nachvollziehbaren Commits umsetzen
3. Wie oben verifizieren und die Belege in die Pull-Request-Beschreibung aufnehmen
4. Pull Request gegen `main` eröffnen

## Sprache

Die Dokumentation dieses Repositories ist deutsch, weil sich der Server an den deutschsprachigen Raum richtet. Englisch bleiben: Code, Bezeichner, Commit-Nachrichten, Tool-Namen und die Tool-Beschreibungen im MCP-Protokoll. Issues und Pull Requests darfst du auf Deutsch oder Englisch verfassen.
