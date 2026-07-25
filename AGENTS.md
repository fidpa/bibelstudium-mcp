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
bun run download            # 4 deutsche Übersetzungen (verses) — MUSS zuerst laufen
bun run download SCH        # …oder eine einzelne Übersetzung (LUT/SCH/ELB/MB)
bun run download:byz        # Edition 'byzantine'
bun run download:sblgnt     # Edition 'sblgnt'
bun run download:tr         # Edition 'tr'
bun run download:heb        # Edition 'wlc'
bun run download:crossrefs  # Tabelle cross_references (OpenBible.info)
bun run download:tagnt      # Tabelle tagnt_words (STEPBible-Bezeugung)
bun run download:lexicon    # Tabelle strong_defs (Strong + STEPBible)
bun run build:fts           # FTS-Index — nur nötig, wenn download nicht lief
```

Die Skripte liegen in `scripts/`, angesprochen werden sie über diese
`package.json`-Aliase — der Pfad ist bewusst nicht Teil der Schnittstelle.

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
| `translations.ts` | Übersetzungs-Registry (LUT/SCH/ELB/MB), Aliase, `resolveTranslation` — die einzige Datei, die Laufzeit und Datenaufbau teilen |
| `scripts/schema.ts` | Schemata: `verses` (+ Migration), `original_words` (+ Migration), `cross_references`, `strong_defs` (+ Migration), `tagnt_words`, `provenance`; FTS-Neuaufbau |
| `scripts/atomic-db.ts` | `openAtomicDb()` — schreibt auf temporäre Kopie + atomarer `rename` |
| `scripts/provenance.ts` | `createSourceDigest()`/`writeProvenance()` — jeder Download protokolliert Quelle, Anzahl Anfragen, fortlaufende SHA-256 |
| `scripts/download.ts` | Deutsche Übersetzungen (Tabelle `verses`) von bolls.life; `books`/`aliases` schreibt der LUT-Lauf |
| `scripts/download-byz.ts` / `-morph.ts` / `-tr.ts` / `-heb.ts` | Editionen `byzantine` / `sblgnt` / `tr` / `wlc` → `original_words` |
| `scripts/download-crossrefs.ts` | OpenBible.info-Querverweise → `cross_references` |
| `scripts/download-tagnt.ts` | STEPBible TAGNT (Bezeugung über acht Editionen) → `tagnt_words` |
| `scripts/download-lexicon.ts` | Strong-Wörterbücher + STEPBible TBESG/TBESH → `strong_defs` |
| `scripts/build-fts.ts` | FTS5-Index über `verses` → `verses_fts` |
| `scripts/aliases.ts` | Deutsche Buchnamen/Abkürzungen → `book_id` |
| `data/bible.db` | SQLite (gitignored, lokal aufgebaut) |

Der Schnitt folgt der Laufzeit-Grenze: `server.ts` importiert nur
`translations.ts`, alles unter `scripts/` läuft ausschließlich beim
Datenaufbau. Die Skripte lösen ihren DB-Pfad relativ zur eigenen Datei auf und
steigen dafür eine Ebene hoch (`"..", "data/bible.db"`) — beim Verschieben
einer dieser Dateien mitziehen, sonst landet die DB still im falschen Ordner.

`server.ts` ist in Abschnitte gegliedert, jeder mit einem Banner
`// --- Titel ---` (78 Spalten). Reihenfolge: Setup, vorbereitete Statements
(ein Abschnitt je Tabelle), Editionen, die drei Morphologie-Dekoder, Helfer
(erst generische, dann je Werkzeug), Tool-Registrierung, Prompts, Dispatch,
Handler, Bootstrap. Die werkzeugspezifischen Helferblöcke stehen in derselben
Reihenfolge wie die Handler weiter unten — wer einen Handler ändert, findet
seine Helfer über den gleichnamigen Banner. Neue Deklarationen in den
passenden Abschnitt einsortieren, nicht ans Dateiende hängen.

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
- **Fehlermeldungen beginnen mit der Aussage, nicht mit "Error:".** Umgestellt am
  25.07.2026 — als Vorsichtsmaßnahme, **nicht** belegt. Die vermeintliche
  Messung (Apokryphen-Meldung wiedergegeben, Nicht-gefunden-Meldung verworfen)
  verglich in Wahrheit "Werkzeug aufgerufen" mit "nicht aufgerufen": bei
  Hesekiel-Zusatz kam gar kein Aufruf zustande. Ein späterer, ausdrücklich
  angeforderter Aufruf gab die alte `Error:`-Meldung samt Buchvorschlag korrekt
  wieder. Die Formulierung bleibt, weil sie ohnehin besser liest — als Beleg
  taugt der Fall nicht.
- **Tool-Beschreibungen steuern, ob überhaupt aufgerufen wird.** `bible_lookup`
  warb nur mit „für ALLE Bibelzitate" — eine Frage nach einem *nicht
  existierenden* Buch fiel nicht darunter, weil kein Zitat erwartet wurde, und
  wurde aus dem Gedächtnis beantwortet (25.07.2026, „Hesekiel-Zusatz 1,1"; nach
  ausdrücklicher Aufforderung lief der Aufruf und lieferte das Richtige). Die
  Beschreibung nennt jetzt Existenz- und Kanonfragen ausdrücklich. Wenn ein
  Werkzeug in der Praxis übergangen wird, zuerst seine `description` prüfen —
  nicht die Ausgabe.
- **Fehlermeldungen brauchen einen Ausweg.** „Book not found" allein sagt nicht,
  ob ein Tippfehler vorliegt oder das Buch außerhalb des Kanons steht.
  `bookNotFound` nennt jetzt das nächstliegende bekannte Buch (Containment oder
  Editierdistanz ≤1, bei Namen ab 6 Zeichen ≤2) und benennt apokryphe Titel
  ausdrücklich als nicht enthalten. Zu großzügige Distanz schadet: „Sirach"
  landete zwischenzeitlich als „Meinten Sie Sacharja?" — ein falscher Treffer im
  Gewand einer Hilfe (25.07.2026).
- **Keine Beispiele in Hinweistexten.** Der `hinweis` von `bible_compare` nannte
  „(z. B. bewegliches Ny)" als Beispiel für eine Schreibvariante — der Begriff
  wurde als Etikett aufgegriffen und auf einen unpassenden Fall gesetzt
  (`ἐπέβαλον`/`ἐπέβαλαν` in Mk 14,46 ist thematische gegen Alpha-Aoristendung,
  kein bewegliches Ny; 25.07.2026). Hinweise sollen auf das klassifizierende
  Feld zeigen, nicht einen Fachbegriff einstreuen, der zufällig passt.
- **Vorbehalte als Tatsache formulieren, nicht als Anweisung.** `quellenkonflikte`
  nennt zuerst, was die Edition liest, dann die widersprechende Notiz. Umgekehrt
  formuliert („TAGNT nennt … — der Text liest anders") las es sich wie eine
  Randbemerkung zur Datenqualität und entfiel beim Wiedergeben, selbst als es
  schon oben in der Antwort stand.
- **Warnungen gehören nach oben.** Ein Widerspruch zwischen Bezeugungsnotiz und
  Editionstext stand nur in `bezeugung.abweichend[].abgleich`; Konsumenten, die
  die Bezeugung als optionales Detail behandeln, übersahen ihn (Mk 14,46 am
  25.07.2026 ohne den Vorbehalt wiedergegeben). `bible_compare` wiederholt ihn
  jetzt als `warnung`/`quellenkonflikte` vor den Daten, die er einschränkt. Bei
  neuen Vorbehalten genauso verfahren — tief verschachtelt heißt ungelesen.
- **Zusammengesetzte Textfelder werden angeschnitten.** `bible_crossrefs`
  lieferte mehrversige Ziele nur als einen String mit eingebetteten
  Versnummern (`"25 Jesus spricht… 26 und jeder…"`); Konsumenten schnitten beim
  Zitieren Anfang und Ende weg (beobachtet am 25.07.2026 an Joh 11,25-26).
  Deshalb zusätzlich `verse_einzeln` je Vers. Bei neuen Feldern, die mehrere
  Verse in einen String legen, gleich mitdenken.
- **Treffermarker dürfen nicht im Text vorkommen.** `bible_search` markiert
  Fundstellen mit `⟦…⟧`. Vorher standen dort `«…»` — die Übersetzungen führen
  diese Zeichen aber selbst als Anführungszeichen (Menge 8339 Verse, Schlachter
  887) und verschachteln sie andersherum (`»Zitat«`), sodass ein schließendes
  `«` wie ein Marker aussah. Beim Ändern der Delimiter zuerst gegen alle
  Übersetzungen prüfen, dass das Zeichen im Text nicht vorkommt.
- **`treffer` zählt Verse, nicht Wortvorkommen.** Ein Vers kann mehrfach
  passen; `vorkommen_gesamt` nennt die Vorkommen. Ohne diese Trennung leiten
  Konsumenten Vorkommenszahlen aus der Verszahl ab und schätzen sie (beobachtet
  am 25.07.2026).
- **Das Feld `wort` ist quellentreu, nicht hübsch.** `byzantine`/`tr` liegen
  unakzentuiert vor, `sblgnt` akzentuiert, `wlc` mit Teamim und dem
  OSHB-Morphemtrenner `/` (`בְּ/רֵאשִׁ֖ית`). Konsumierende Modelle ergänzen sonst beim
  Zitieren Akzente oder glätten Zeichen weg — beobachtet am 24.07.2026 in beide
  Richtungen. Der `hinweis` jeder Edition sagt das inzwischen ausdrücklich; beim
  Ändern von `EDITION_META` beibehalten.
- **TAGNT-Bezeugung ≠ Editionstext.** Die Notizen `spelling_variant`/
  `meaning_variant` in `tagnt_words` nennen nur die Zeugen des STEPBible-
  Apparats — TAGNTs „Byz" ist **nicht** Robinson-Pierpont 2005. Bei 1Tim 3,16
  steht dort `TR: ἀνελήφθη ;`, obwohl `byzantine` in `original_words` ebenso
  liest (Fehlschluss: „Byz liest ἀνελήμφθη"); umgekehrt nennt TAGNT bei
  Mk 14,46 `Byz` für ἐπέβαλαν, während Robinson-Pierpont ἐπέβαλον hat. Gemessen
  über 400 zufällige NT-Verse: in **10,8 %** gehen Notiz und Editionstext
  auseinander. `crossCheckVariant` gleicht beides ab und hängt `in_dieser_db`
  (+ `abgleich` bei Widerspruch) an die `bezeugung`. Für die Frage „was steht in
  dieser Edition" gilt der Editionstext, nicht die Notiz. Reine
  Elisionsunterschiede (`ἀλλ᾽`/`ἀλλά`) sind von `abgleich` ausgenommen — sonst
  ersäufen die echten Fälle im Rauschen.
- **Vollständig verifizieren.** Morphologie-Dekoder gegen Imperativ, Partizip,
  Infinitiv **und** Nicht-Verben testen, nicht gegen einen Einzelfall.
  Übersetzungs-parametrisierte Tools gegen mehr als die Voreinstellung testen.
