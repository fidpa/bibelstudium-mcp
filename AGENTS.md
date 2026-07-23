# AGENTS.md — bibelstudium-mcp

Hinweise für KI-Coding-Agenten (Claude Code u. a.), die an diesem Repository
arbeiten.

Ein **MCP-Server** (TypeScript/Bun, lokales SQLite) für wortgetreue Bibelarbeit.
Kein Bot, keine Persona — ein reines Werkzeug. Sechs Tools (`bible_lookup`,
`bible_original`, `bible_crossrefs`, `bible_concordance`, `bible_search`,
`bible_compare`) und drei Prompts (`word-study`, `variant-check`,
`translation-compare`). Die Nutzerdokumentation steht in `README.md`; diese
Datei ist für die Arbeit **am Code**.

## Befehle

```bash
bun install                      # einmalig (eine Laufzeit-Abhängigkeit: das MCP-SDK)
bun run typecheck                # tsc --noEmit, strict — das erzwingt die CI
bun run server.ts                # stdio-Server starten
```

Datenbankaufbau — **streng sequentiell**, niemals parallel (jedes Skript kopiert
die aktuelle DB, ergänzt seine Daten und tauscht atomar per `rename`; zwei
parallele Läufe überschreiben sich, der letzte `rename` gewinnt):

```bash
bun run download.ts            # 4 deutsche Übersetzungen (verses) — MUSS zuerst laufen
bun run download.ts SCH        # …oder eine einzelne Übersetzung (LUT/SCH/ELB/MB)
bun run download-byz.ts        # Edition 'byzantine'
bun run download-morph.ts      # Edition 'sblgnt'
bun run download-tr.ts         # Edition 'tr'
bun run download-heb.ts        # Edition 'wlc'
bun run download-crossrefs.ts  # Tabelle cross_references (OpenBible.info)
bun run download-tagnt.ts      # Tabelle tagnt_words (STEPBible-Bezeugung)
bun run download-lexicon.ts    # Tabelle strong_defs (Strong + STEPBible)
bun run build-fts.ts           # FTS-Index — nur nötig, wenn download.ts nicht lief
```

## Harte Vorgaben

- **Belege statt Behauptungen.** Jede Aussage über den Text gegen echte Daten
  prüfen (SQL gegen `data/bible.db` oder ein frischer stdio-Aufruf des Servers)
  — niemals aus dem Gedächtnis. Bei Fragen zum Grundtext die Edition tatsächlich
  abrufen.
- **Eine laufende MCP-Server-Instanz in einer Agenten-Sitzung ist veraltet** —
  Codeänderungen wirken erst nach Neustart. Änderungen immer über einen frischen
  `bun run server.ts`-Aufruf prüfen, nicht über das womöglich veraltete Tool aus
  der Sitzung.
- **Tool-Namen und Ausgabefelder sind öffentliche Schnittstelle.**
  Umbenennungen und Feldänderungen sind Breaking Changes; Ergänzungen sind
  unproblematisch.
- **`bun run typecheck` muss grün bleiben.** `strict` +
  `noUncheckedIndexedAccess`; die CI scheitert bei jedem Fehler.
- **Datenlizenzen:** Alle Quellen sind PD/CC-BY(-SA) — siehe
  THIRD_PARTY_LICENSES.md. Neue Quellen brauchen zuerst eine geprüfte Lizenz.
  `data/` niemals einchecken (gitignored; STEPBible bittet darum, ihre Dateien
  nicht weiterzuverbreiten).
- Code-Stil: `docs/TYPESCRIPT.md`.

## Architektur

| Datei | Aufgabe |
|-------|---------|
| `server.ts` | MCP-Server: sechs Tools, drei Prompts, drei Morphologie-Dekoder, `EDITION_META`/Aliase, Testament-Routing |
| `translations.ts` | Übersetzungs-Registry (LUT/SCH/ELB/MB), Aliase, `resolveTranslation` |
| `schema.ts` | Schemata: `verses` (+ Migration), `original_words` (+ Migration), `cross_references`, `strong_defs` (+ Migration), `tagnt_words`, `provenance`; FTS-Neuaufbau |
| `atomic-db.ts` | `openAtomicDb()` — schreibt auf temporäre Kopie + atomarer `rename` |
| `provenance.ts` | `createSourceDigest()`/`writeProvenance()` — jeder Download protokolliert Quelle, Anzahl Anfragen, fortlaufende SHA-256 |
| `download.ts` | Deutsche Übersetzungen (Tabelle `verses`) von bolls.life; `books`/`aliases` schreibt der LUT-Lauf |
| `download-byz.ts` / `download-morph.ts` / `download-tr.ts` / `download-heb.ts` | Editionen `byzantine` / `sblgnt` / `tr` / `wlc` → `original_words` |
| `download-crossrefs.ts` | OpenBible.info-Querverweise → `cross_references` |
| `download-tagnt.ts` | STEPBible TAGNT (Bezeugung über acht Editionen) → `tagnt_words` |
| `download-lexicon.ts` | Strong-Wörterbücher + STEPBible TBESG/TBESH → `strong_defs` |
| `build-fts.ts` | FTS5-Index über `verses` → `verses_fts` |
| `aliases.ts` | Deutsche Buchnamen/Abkürzungen → `book_id` |
| `data/bible.db` | SQLite (gitignored, lokal aufgebaut) |

**Konventionen:** `book_id` 1–39 = AT, 40–66 = NT (bolls.life-Nummerierung;
40=Mt … 66=Offb). Primärschlüssel von `verses` ist
`(translation, book_id, chapter, verse)`. `bible_original` leitet nach Buch
weiter: AT → `wlc`, NT → gemäß `texttyp` (Voreinstellung `byzantine`; die
Priorität steht in `resolveEdition`, im Routing und im `hinweis` jeder Antwort
— bei Änderungen konsistent halten).

## Testen

Der Server spricht **stdio JSON-RPC** (MCP). Zum Testen ohne echten MCP-Client
JSON-RPC-Zeilen nach stdin leiten:

```bash
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bible_lookup","arguments":{"book":"Johannes","chapter":3,"verses":"16"}}}'
} | bun run server.ts
```

Schnelle Datenprüfungen laufen direkt über `sqlite3 data/bible.db "…"`.

## Fallstricke (gemessen, nicht vermutet)

- **Drei Morphologie-Schemata, nicht eines.** `sblgnt` nutzt MorphGNT-Codes
  (8 Zeichen, `decodeParse`), `byzantine`/`tr` nutzen Robinson-Codes
  (`decodeRobinson`), `wlc` nutzt OSHB-Codes (`decodeHebrew`). **Robinson-
  Imperativ = `M`, MorphGNT-Imperativ = `D`** — nicht verwechseln. Bei
  Robinson-Nicht-Verben ist ein angehängtes `-N`/`-I` ein Funktionsmarker
  (Negation/Interrogativ), **kein** Kasus.
- **Beta-Code + CRLF.** Die TR-Quelle (`greektext-textus-receptus`) ist
  transliteriert (Beta-Code, unakzentuiert) mit `\r\n`-Zeilenenden — vor dem
  Parsen normalisieren, sonst greifen `$`-Anker nicht. `v` = Schlusssigma,
  `s` = medial.
- **Parallele Leser.** Die DB niemals an Ort und Stelle überschreiben oder
  WAL-Sidecars unter einem offenen Leser löschen — das erzeugt „disk I/O error"
  in anderen Sitzungen. `atomic-db.ts` nutzen; die veröffentlichte Datei liegt
  im DELETE-Journal-Modus (selbstgenügsam, nur lesende Leser brauchen keine
  Sidecars).
- **FTS speichert HTML-bereinigten Text.** `verses` kann `<i>`-Tags enthalten;
  im FTS-Index würden sie Phrasen zerreißen (verirrte „i"-Tokens).
  `rebuildVersesFts` entfernt sie beim Indizieren — bei Änderungen beibehalten.
- **Vollständig verifizieren.** Morphologie-Dekoder gegen Imperativ, Partizip,
  Infinitiv **und** Nicht-Verben testen, nicht gegen einen Einzelfall.
  Übersetzungs-parametrisierte Tools gegen mehr als die Voreinstellung testen.
