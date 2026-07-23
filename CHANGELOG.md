# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei
dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
und dieses Projekt folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

## [0.1.0] - 2026-07-23

### Hinzugefügt

- Sechs MCP-Werkzeuge: `bible_lookup`, `bible_original`, `bible_concordance`, `bible_crossrefs`, `bible_search`, `bible_compare`
- Vier frei lizenzierte deutsche Übersetzungen (Luther 1912 als Voreinstellung, Schlachter 1951, Elberfelder 1871, Menge) mit Übersetzungswahl je Werkzeug
- Grundtext Wort für Wort über vier Editionen (hebräisch WLC; griechisch Byzantinisch/SBLGNT/TR) mit drei nativ dekodierten Morphologie-Schemata (Robinson, MorphGNT, OSHB)
- Bezeugung jedes Wortes über acht griechische Editionen (STEPBible TAGNT) in `bible_compare`
- Lexikondaten: Strong 1890 + STEPBible-Tyndale-Glossen + vollständige Abbott-Smith-Einträge (griechisch)
- Querverweise (OpenBible.info TSK, nach Stimmen gewichtet) mit deutschem Zieltext
- FTS5-Volltextsuche mit Umlautfaltung, Phrasen- und Präfixunterstützung
- Drei geführte MCP-Prompts: `word-study`, `variant-check`, `translation-compare`
- Herkunftsnachweis (Quell-URL, Anzahl Anfragen, SHA-256) für jeden Download
- Atomarer Datenbankaufbau (temporäre Kopie + Umbenennen), sicher bei parallelen Lesern
- Strikter Typecheck (`bun run typecheck`: `strict` + `noUncheckedIndexedAccess`) und GitHub-Actions-CI, die ihn zusammen mit den Startprüfungen und yamllint ausführt
