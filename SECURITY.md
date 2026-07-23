# Sicherheitsrichtlinie

## Schwachstellen melden

Wenn du eine Sicherheitslücke findest, melde sie bitte verantwortungsvoll:

1. **Kein öffentliches Issue** eröffnen
2. **GitHub Security Advisories nutzen**: im [Security-Tab](https://github.com/fidpa/bibelstudium-mcp/security/advisories) auf „Report a vulnerability" klicken
3. **Angaben machen**:
   - Beschreibung der Schwachstelle
   - Schritte zur Reproduktion
   - Mögliche Auswirkung
   - Lösungsvorschlag (falls vorhanden)

## Reaktionszeiten

- **Erste Rückmeldung**: innerhalb von 72 Stunden
- **Statusmeldung**: innerhalb von 7 Tagen
- **Behebung**: abhängig vom Schweregrad (kritische Fälle zuerst)

## Unterstützte Versionen

| Version | Unterstützt        |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Sicherheitsmodell

Dieser Server ist dafür ausgelegt, **lokal über stdio** für einen einzelnen
Nutzer zu laufen:

- Die Datenbank wird vom Server **nur lesend** geöffnet; ausschließlich die
  Download-Skripte schreiben, und zwar auf eine temporäre Kopie, die atomar
  eingetauscht wird
- Alle Tool-Argumente werden validiert (`unknown` + Typprüfungen), bevor sie
  SQL berühren; jede Abfrage nutzt vorbereitete Statements mit gebundenen
  Parametern
- Der Server stellt **keine Netzwerkanfragen** — das tun nur die
  Download-Skripte, ausschließlich an die dokumentierten Datenquellen (siehe
  [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)), und sie protokollieren
  jeden Abruf mit SHA-256-Prüfsumme in der Tabelle `provenance`
- Setze den stdio-Server **keinen** nicht vertrauenswürdigen Eingaben aus und
  stelle ihn nicht ohne eigene Authentifizierung und Ratenbegrenzung als
  öffentlichen Netzwerkdienst bereit — dafür ist er nicht ausgelegt
