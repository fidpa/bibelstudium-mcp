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
bun run setup                    # alle acht Downloads nacheinander, mit Bericht
bun run build:mcpb [target]      # MCPB-Bundle für Claude Desktop nach tmp/
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
| `scripts/setup.ts` | Orchestriert die acht Downloads für `bible_setup` und `bun run setup`; Teilfehler brechen den Lauf nicht ab |
| `db-path.ts` | Auflösung des Datenbankpfads, geteilt von Server und Skripten |
| `scripts/build-mcpb.ts` | MCPB-Bundle: `bun build --compile` + Manifest aus `mcpb/manifest.json` → `tmp/` |
| `mcpb/manifest.json` | Manifest-Quelle des Bundles; Version, Ziel und Plattform setzt das Build-Skript |
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

```bash
bun run test        # 58 Zusicherungen gegen einen frischen Server über stdio
```

`scripts/test-golden.ts` ist der Regressionstest nach Änderungen an `server.ts`:
Grenzwertmeldungen, Werkzeug-Annotationen, Buchauflösung, Klammerhinweise,
Comma Johanneum, TAGNT-Quellenkonflikt, hebräische Morphologie, Treffer- gegen
Vorkommenszahlen, `verse_einzeln`. Er braucht eine gebaute Datenbank und läuft
deshalb **nicht** in der CI — dort steht nur `typecheck` samt den
Startup-Guards. Lokal vor jedem Commit an `server.ts` laufen lassen.

Für einzelne Aufrufe von Hand spricht der Server **stdio JSON-RPC** (MCP);
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

- **Zwei Transporte, eine Serverfabrik.** `createServer()` liefert je Anfrage
  eine eigene Instanz, weil ein `Server` genau einen Transport bindet. Der
  HTTP-Modus läuft **zustandslos** (`sessionIdGenerator: undefined`): dieser
  Server schiebt keine Benachrichtigungen und hat nichts fortzusetzen, Sitzungen
  brächten ihm also nichts und kosteten eine Registratur, die verfallen und
  gedeckelt werden müsste. Eine frühere sitzungsbehaftete Fassung lief genau
  dort aus (21 Anfragen, 21 Sitzungen, die nie verschwanden). Gemessen über
  1200 Anfragen ist der Speicher stabil. Datenbank,
  vorbereitete Statements und die Werkzeugliste liegen auf Modulebene und werden
  geteilt. Beim Ergänzen eines Handlers **beide** Stellen bedienen: die benannte
  Handler-Konstante und ihre Registrierung in `createServer()` — eine Registrierung
  auf einem Singleton gibt es nicht mehr. Stdio bleibt Voreinstellung; HTTP
  startet nur mit gesetztem `MCP_HTTP_PORT` und bindet ohne `MCP_HTTP_HOST` an
  `127.0.0.1`. Diese Vorgabe nicht aufweichen: sie ist der Unterschied zwischen
  „lokal testbar" und „versehentlich im Netz".
- **Namensnennung gehört an die Antwort, nicht nur ins Repository.** Vier der
  Datenquellen stehen unter CC BY, zwei unter CC BY-SA. CC 4.0 zählt
  öffentliches Verfügbarmachen ausdrücklich als „Share", und wer den Server über
  MCP benutzt, sieht weder `THIRD_PARTY_LICENSES.md` noch eine Website. Jede
  Antwort trägt deshalb `quellen`. Zwei Regeln dazu: Die Lizenzangabe liegt
  **bei den Daten**, die sie betrifft (Editionen in `EDITION_META` neben
  `label`, Übersetzungen in `translations.ts`), damit Text und Lizenz nicht
  auseinanderlaufen. Und genannt wird nur, was die Antwort **tatsächlich benutzt
  hat**: eine behauptete Attribution, die nicht einschlägig ist, ist derselbe
  Fehler wie eine weggelassene. `nennung: null` heißt „Lizenz verlangt keine"
  und ist eine Aussage, kein vergessener Wert. Bei einer neuen Datenquelle
  gehört ihre Quellenangabe in denselben Zug wie ihr Download-Skript.
- **Eine Zustandsprüfung, die den Startwert wiederholt, prüft nichts.**
  `/health` las zunächst `dataMissing`, und das wird einmal beim Booten
  ermittelt: Eine im Betrieb beschädigte Datei hätte weiter `200 ok` gemeldet.
  Jetzt läuft eine Zeile auf `books`, und das ist gemessen: eine im laufenden
  Betrieb zerstörte Datenbank kippt die Antwort auf 503 mit „file is not a
  database". Bei neuen Zustandsanzeigen dieselbe Frage stellen, ob sie den
  Zustand oder eine Erinnerung daran melden.
- **Der Transport entscheidet mit, welche Werkzeuge es gibt.** `bible_setup`
  schreibt: es lädt rund 145 MB von acht fremden Quellen und ersetzt die
  Datenbankdatei. Über stdio gehört das dem, der den Prozess gestartet hat; an
  einem erreichbaren Endpunkt gehört es Fremden, und der Zustand, der es
  freischaltet (keine Datenbank), ist genau der, den ein Ausfall herstellt.
  `HTTP_MODE` (aus `MCP_HTTP_PORT` abgeleitet, damit es dem tatsächlich
  gewählten Transport nicht widersprechen kann) nimmt es deshalb aus
  `tools/list` **und** der Handler lehnt es ab: eine ungelistete
  Werkzeugbezeichnung lässt sich weiterhin schicken, die Liste ist kein Schutz.
  Wer künftig ein schreibendes oder netzendes Werkzeug ergänzt, entscheidet
  dieselbe Frage mit, und dann an beiden Stellen. Gegenstück für die
  Betreiberseite ist `server.ts --setup`; ohne das bräuchte ein Endpunkt Bun und
  ein Checkout auf dem Zielrechner, was das eigenständige Binary gerade
  vermeidet. Gemessen am 25.07.2026 gegen frische Prozesse in drei Fällen
  (HTTP mit Datenbank, HTTP ohne, stdio ohne).
- **Fehlermeldungen haben im HTTP-Modus einen anderen Adressaten.** Die Sperre
  der sechs Werkzeuge verwies ohne Datenbank darauf, den Nutzer zu fragen und
  `bible_setup` aufzurufen. An einem Endpunkt benennt das ein Werkzeug, das
  dort nicht existiert und dem Aufrufer nicht zur Verfügung steht. Über stdio
  ist der Aufrufer der Betreiber, über HTTP ein Fremder. Bei neuen Meldungen,
  die zu einer Handlung auffordern, prüfen, ob der Aufrufer sie überhaupt
  ausführen kann; wenn nicht, sagen, dass es serverseitig liegt, statt ihn in
  eine Wiederholung zu schicken.
- **`mcpb/manifest.json` ist die dritte Doku-Stelle, und die einzige, die ein
  Endnutzer sicher liest.** `long_description` und die `user_config`-Texte
  stehen im Installationsdialog von Claude Desktop. Beim Umbau auf
  `bible_setup` blieben sie unangetastet und behaupteten weiter „etwa 25
  Minuten" und „beim Installieren über den Dateiauswahldialog ausgewählt" —
  beides zu dem Zeitpunkt falsch, und dem Nutzer angezeigt, während README und
  CHANGELOG längst stimmten (25.07.2026). Dazu zwei falsche Jahreszahlen bei
  den Übersetzungen, die `translations.ts` anders führt. Wer Ablauf, Dauer,
  Voraussetzungen oder Werkzeugbestand ändert, prüft das Manifest im selben
  Zug: die Werkzeugliste dort ist handgepflegt und wächst nicht von selbst mit.
- **Die Architektur gehört in den Bundle-Dateinamen.**
  `compatibility.platforms` kennt nur `darwin`/`win32`/`linux`. Ein Intel-Mac
  besteht die Manifest-Prüfung eines arm64-Bundles deshalb und scheitert erst
  am Binary, mit einer Meldung des Betriebssystems statt einer des Bundles.
  `build-mcpb.ts` schreibt daher `…-darwin-arm64.mcpb`; beim Anhängen an ein
  Release den Namen unverändert lassen.
- **Ein leeres `user_config`-Feld kommt als unaufgelöster Platzhalter an.**
  Claude Desktop ersetzt `${user_config.db_path}` **nicht** durch eine leere
  Zeichenkette, wenn das Feld optional ist und leer bleibt: der Server bekommt
  den Literalstring `${user_config.db_path}` als `BIBLE_DB_PATH`. Gemessen am
  25.07.2026 im installierten Bundle. Die Prüfung auf „leer" reichte deshalb
  nicht; `db-path.ts` verwirft jetzt jeden Wert, der `${…}` enthält. Der
  Fehlerverlauf war besonders irreführend: Der Download lief vollständig durch
  (31 102 Verse empfangen) und scheiterte erst beim Schreiben, mit der
  SQLite-Meldung „unable to open database file" — die das Modell als
  Netzwerkproblem deutete und dem Nutzer auch so meldete. Bei neuen
  `user_config`-Feldern denselben Filter anwenden.
- **`bun build --compile` packt seinen eigenen Müll mit ein.** Der Compiler legt
  eine temporäre Kopie des Binaries im Arbeitsverzeichnis ab und lässt sie
  liegen, wenn die Zieldatei auf einem anderen Dateisystem sitzt. Steht das
  Arbeitsverzeichnis auf dem Staging-Ordner des Bundles, landet diese Kopie
  **im `.mcpb`**: 63 MB blinder Passagier, Bundle doppelt so groß (gemessen am
  25.07.2026, 121 MB statt 61 MB entpackt). Der Compiler bekommt deshalb ein
  eigenes Verzeichnis unter `tmp/`, das vor und nach dem Lauf gelöscht wird.
  Nach Änderungen am Build die Dateiliste prüfen: `mcpb pack` gibt sie aus, es
  müssen genau zwei Einträge sein (Manifest und Binary).
- **`console.log` in importiertem Code bricht den stdio-Transport.** Die
  Download-Skripte melden ihren Fortschritt mit `console.log`, was auf einer
  Konsole richtig ist. Sobald `bible_setup` sie **im Serverprozess** aufruft,
  landet jede dieser Zeilen auf stdout, wo ausschließlich JSON-RPC stehen darf:
  der erste End-to-End-Lauf lieferte einen unparsbaren Strom (gemessen am
  25.07.2026, alle acht Schritte liefen durch, die Antwort war trotzdem
  unbrauchbar). `handleSetup` biegt `console.log` deshalb für die Dauer des
  Aufbaus auf `console.error` um. Wer weiteren Code in den Server importiert,
  prüft ihn zuerst auf `console.log` — die Regel gilt nicht nur für `server.ts`
  selbst, sondern für alles, was in dessen Prozess läuft.
- **Jede Angabe hat genau einen Ort, und beide Male ist das schon schiefgegangen.**
  Der **Datenbankpfad** steht in `db-path.ts`: Server und Skripte müssen dieselbe
  Datei meinen, sonst lädt `bible_setup` dorthin, wo der Server nie nachsieht.
  Ein kompilierter Lauf legt die Datenbank in den Benutzerordner, **nicht** neben
  das Programm, denn das Verzeichnis einer installierten Erweiterung wird beim
  Update ersetzt. Die **Version** steht in `package.json`: Der v0.3.0-Commit hob
  die daneben gepflegte Zahl in `server.ts` auf 0.2.2 an, während das Paket auf
  0.3.0 ging, und jeder Client sah im `initialize` eine Version, die es als
  Release nicht gibt. Beides wird jetzt importiert, nicht erneut hingeschrieben.
  Bei neuen Skripten und neuen Releases genauso verfahren.
- **Bibeltexte kommen als statischer Export, nicht kapitelweise.** `download.ts`
  lief bis zum 25.07.2026 über `/get-text/<code>/<buch>/<kapitel>/` und stellte
  damit 4760 Anfragen, obwohl die API-Dokumentation genau davon abrät („Please
  do not do that! … it may cause performance issues") und
  `\/static/translations/<code>.json` als vorgesehenen Weg nennt. Der Umbau
  brachte 20 Minuten auf 3,2 Sekunden bei **byteweise identischem** Ergebnis
  (gleicher SHA-256 über alle 124 441 Verse und über `books`). Wer eine weitere
  Quelle anbindet: erst deren Dokumentation auf einen Massen-Endpunkt prüfen,
  bevor eine Schleife über Einzelabrufe entsteht.
- **Im kompilierten Binary zeigt `import.meta.path` ins Nichts.** `bun build
  --compile` legt den Quelltext in ein virtuelles Dateisystem; `import.meta.path`
  ergibt dort `/$bunfs/root`, und die skriptrelative Auflösung suchte die
  Datenbank folglich unter `/$bunfs/root/data/bible.db` — der Server startete im
  MCPB-Bundle gar nicht (gemessen am 25.07.2026). Kompilierte Läufe suchen
  deshalb neben `process.execPath`. Erkannt wird der Fall daran, dass das
  Verzeichnis auf der Platte **nicht existiert** (`existsSync` ist dort `false`,
  beim echten Skriptverzeichnis `true` — beides gemessen); ein fest verdrahtetes
  `/$bunfs` wäre geraten, sobald es um Windows geht. Wer Dateien relativ zum
  eigenen Modul auflöst, prüft das vor dem nächsten Bundle-Build.
- **`BIBLE_DB_PATH` kann gesetzt und trotzdem leer sein.** Ein im
  Installationsdialog leer gelassenes `user_config`-Feld erreicht den Server als
  leere Zeichenkette, nicht als fehlende Variable — `??` allein fängt das nicht,
  und `""` liefe als Pfad in einen nackten SQLite-Fehler ohne Ursachenangabe.
  Deshalb zählt leer als nicht gesetzt. Bei weiteren `user_config`-Feldern
  genauso verfahren.
- **Ein Bundle läuft auf genau einer Plattform.** `bun build --compile` erzeugt
  ein architekturspezifisches Binary, und ein `.mcpb` trägt genau eines.
  `compatibility.platforms` wird deshalb in `scripts/build-mcpb.ts` aus dem
  Compile-Target abgeleitet, nicht aus dem Manifest übernommen. Geprüft ist
  bislang allein `bun-darwin-arm64`; wer ein anderes Ziel baut, prüft es dort,
  statt die Angabe zu erweitern.
- **Der Client entscheidet, ob ein Werkzeug aufgerufen wird — nicht der Server.**
  `docs/anweisungen/claude-desktop.txt` ist der client-seitige Hebel dafür und
  gehört bei neuen Beobachtungen mitgepflegt: jede Regel dort geht auf einen
  gemessenen Fehlgriff zurück, nicht auf eine Vermutung. Beim Ergänzen die
  Datenlage **dieses** Repos prüfen — Trefferzahlen gelten je Übersetzung,
  Klammer-Einschübe gibt es nur in Menge (137 Verse), Fußnotenziffern gar nicht.
  Regeln aus dem Ursprungs-Repo nicht ungeprüft übernehmen.
- **Wörter in eckigen Klammern gehören zum Wortlaut.** Menge setzt erklärende
  Einschübe so — 137 Verse, ausschließlich in `MB`; Luther, Schlachter und
  Elberfelder verwenden keine, und keine der vier trägt Fußnotenziffern.
  Entfernt ein Client die Klammern, liest sich der Einschub der Ausgabe wie
  gewöhnlicher Text. `BRACKET_WORD_RE`/`BRACKET_WORD_HINT` über `bracketHints()`
  in `bible_lookup`, `bible_crossrefs`, `bible_search`. Der Hinweis nennt
  **kein** Beispielwort: ein konkretes Beispiel wurde schon einmal als Etikett
  aufgegriffen und auf einen unpassenden Fall gesetzt (siehe den `hinweis` von
  `bible_compare`). Gemessen im Ursprungs-Repo am 25.07.2026, dort an
  Schlachter-Klammern.
- **Grenzwerte und ihre Meldungstexte laufen auseinander.** `bible_original`,
  `bible_crossrefs` und `bible_compare` wiesen `verse=999` mit „'verse' must be
  a positive integer" zurück — einer Bedingung, die die Eingabe erfüllt;
  verletzt war die Obergrenze 200. Sechs Meldungen in drei Handlern, während
  `bible_lookup` dieselbe Prüfung von Anfang an richtig formulierte
  (25.07.2026). Ursache war die dreifach kopierte Zahl neben einem separat
  formulierten Text. Grenzen und Meldungen liegen deshalb jetzt in gemeinsamen
  Konstanten (`MAX_CHAPTER`, `MAX_VERSE`, `chapterOutOfRange`,
  `verseOutOfRange`) — bei neuen Prüfungen diese verwenden, keine Zahl erneut
  hinschreiben.
- **Tool-Annotationen: Vorgabewerte sind hier falsch.** Ohne `annotations` gilt
  laut Spezifikation `readOnlyHint: false` und `openWorldHint: true` — beides
  trifft auf keines der sechs Werkzeuge zu. Sie tragen deshalb
  `READ_ONLY_LOCAL`. `destructiveHint`/`idempotentHint` **nicht** ergänzen: das
  Schema definiert sie als nur bedeutsam, wenn `readOnlyHint` `false` ist. Dass
  ein Client die Angaben sichtbar auswertet, ist **nicht** gemessen — die
  Begründung ist allein, dass die Vorgabewerte falsch wären.
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
