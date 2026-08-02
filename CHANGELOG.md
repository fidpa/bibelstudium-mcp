# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei
dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
und dieses Projekt folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.5.12] - 2026-08-02

### Geändert (Dokumentation)

- **Der Preis der Fehlercode-Umstellung aus 0.5.11 ist gemessen und festgehalten.** Claude Code deutet `-32602` bei `resources/read` als „nicht gefunden" und ersetzt den Meldungstext des Servers durch eine eigene Zeile samt dem Rat, die Ressourcenliste neu zu laden. Unter `-32603` kam der Servertext wörtlich an. Gemessen am 02.08.2026 gegen den ausgerollten Endpunkt vor und nach dem Ausrollen, an zwei Fehlerarten, bei zeichengleichem Servertext.

  Betroffen sind allein die Ressourcen und allein dieser Client: Prompts geben ihre Meldung weiterhin im Wortlaut aus, Werkzeuge liefern ihre Fehler ohnehin als Ergebnis mit `isError`. Wer den vollen Text braucht, stellt dieselbe Frage über `bible_lookup`. Für Claude Desktop und claude.ai ist es nicht gemessen. Am Code ändert sich nichts, der Fehlercode bleibt `-32602`; die drei Auswege stehen in `docs/ENTSCHEIDUNGEN.md`, die Nutzersicht in `docs/FEHLERBEHEBUNG.md`.

## [0.5.11] - 2026-08-02

### Behoben

- **Fehler des Aufrufers melden `-32602` (Invalid params) statt `-32603` (Internal error).** Betroffen sind 19 Stellen: unbekanntes Werkzeug, unbekannter Prompt, fehlendes oder zu langes Prompt-Argument und jede fehlerhafte Ressourcen-URI. Die Spezifikation nennt `-32602` für Prompts ausdrücklich; ein interner Fehler lag in keinem der Fälle vor.

  **Kein Meldungstext ändert sich.** Wer auf den Wortlaut prüft, merkt nichts; wer auf `-32603` prüft, muss umstellen. Die Werkzeuge bleiben ebenfalls unverändert: Ein unbekanntes Buch ist weiter ein Ergebnis mit `isError` und Prosa. `-32603` bleibt der Instanz ohne Bibeldatenbank vorbehalten, das ist ein Zustand des Servers und kein Fehler der Anfrage. Der Golden-Test prüft 313 statt 291 Zusicherungen.

### Geändert (Dokumentation)

- `docs/TYPESCRIPT.md`: sieben Konventionen für Codekommentare, darunter Sprache (Deutsch, außer Bezeichnern und den englischen Tool-Beschreibungen), Länge und Abgrenzung zu `docs/ENTSCHEIDUNGEN.md`. Der Bestand ist noch überwiegend englisch, die Umstellung steht aus.
- `docs/ENTSCHEIDUNGEN.md`: Begründung der Fehlercodes samt Messung, warum dafür nicht `McpError` verwendet wird, und warum `DELETE` weiter mit 200 antwortet.

## [0.5.10] - 2026-08-02

### Hinzugefügt

- Die drei Prompts tragen einen deutschen Anzeigenamen im Feld `title`: „Wortstudie", „Textvarianten prüfen", „Übersetzungen vergleichen". Ein Client zeigt ihn im Auswahlmenü, das der Nutzer liest; angesprochen werden die Prompts weiterhin über ihre unveränderten Bezeichner. `prompts/list` wächst dadurch von 972 auf 1060 Zeichen. Die Prompt-Argumente bekommen keinen Titel, das Protokoll sieht dort keinen vor.

### Hinzugefügt (Dokumentation)

- `docs/FEHLERBEHEBUNG.md` erklärt, warum sich eine Ressource nicht anhängen lässt. Enthält der Servername Leerzeichen, setzt die Vervollständigung in Claude Code ein Anführungszeichen, das die dokumentierte Form nicht kennt, und der Inhalt kommt nicht an; ein lokaler Eintrag desselben Endpunkts unter kurzem Namen behebt es. Die URI-Vorlagen sind über `@` gar nicht erreichbar, wohl aber über `resources/read`. Beides gemessen am 02.08.2026 in Claude Code, für Claude Desktop und claude.ai nicht.

## [0.5.9] - 2026-08-02

### Hinzugefügt

- **Ressourcen als dritte MCP-Primitive.** Vier feste Einträge (`bible://buecher`, `bible://uebersetzungen`, `bible://editionen`, `bible://quellen`) und drei URI-Vorlagen für Kapitel, Verse und Grundtext. Werkzeuge und Prompts wählt das Modell, eine Ressource hängt der Nutzer selbst an.

  Der Bibeltext liegt in den Vorlagen, nicht in der Liste: `resources/list` kostet 939 Zeichen, `resources/templates/list` 947, gegen 15 171 für `tools/list`. Allein die 66 Bücher aufzuzählen wären rund 13 000 Zeichen mehr, und ein ganzes Buch wäre nicht auslieferbar (größtes: 260 990 Zeichen). Grundtext deshalb je Vers, nicht je Kapitel.

  Text-Ressourcen tragen `verse_einzeln` statt eines zusammengesetzten `text`: eine angehängte Ressource wird zitiert, und eingebettete Versnummern wurden nachweislich mit abgeschnitten. Beide Felder kosteten das 2,57-Fache, `verse_einzeln` allein das 1,58-Fache (Psalm 119, Luther). Jede Ressource mit Text trägt ihre `quellen`.

  Ohne Datenbank sind beide Listen leer und ein Abruf wird abgewiesen, über HTTP mit anderem Wortlaut als über stdio. `bible_lookup` und `bible_original` antworten unverändert; der Golden-Test prüft jetzt 284 statt 199 Zusicherungen.

- **`bible_server_info` nennt die Ressourcen und Vorlagen.** Ob ein Client `resources/templates/list` überhaupt abruft, ist nicht belegt; diese Auskunft ist der Kanal, der das Modell nachweislich erreicht. Kosten: 359 Zeichen in der Antwort, 202 in `tools/list`. Aus denselben Konstanten wie die Listen, deshalb können beide nicht auseinanderlaufen.

## [0.5.8] - 2026-08-02

### Hinzugefügt

- **Die sieben Lesewerkzeuge deklarieren ein `outputSchema` und liefern ihr Ergebnis zusätzlich als `structuredContent`** (MCP-Revision 2025-06-18). Ein Konsument findet damit ein Feld, statt Text zu zerlegen; wenige Felder tragen eine Beschreibung, und zwar genau die, bei denen Konsumenten nachweislich danebengegriffen haben (`treffer` gegen `vorkommen_gesamt`, `warnung`, `verse_einzeln`, die Quellentreue von `wort`). Der Textblock bleibt zeichengleich, ein Client ohne Kenntnis der Neuerung sieht dasselbe wie zuvor. Fehlerantworten bleiben reiner Text und tragen kein `structuredContent`.

  Preis: `tools/list` wächst von 7201 auf 14969 Zeichen, eine Antwort um 63 bis 80 Prozent, weil die Nutzlast zweimal übertragen wird. `bible_setup` bleibt bewusst ohne Schema.

  `required` nennt je Werkzeug nur Felder, die in jedem Erfolgsfall dastehen; für jedes bedingte Feld gibt es einen Testfall. Der Golden-Test prüft jetzt jede Antwort gegen ihr Schema und den Validator gegen fünf bekannt kaputte Antworten.

### Behoben (Dokumentation)

- Die Werkzeugtabelle in `README.md` führte `bible_server_info` nicht auf, und zwei Stellen sprachen weiter von „sechs Werkzeugen".

## [0.5.7] - 2026-08-02

### Geändert

- **Die drei Prompts nennen den geladenen Bestand statt einer festen Liste.** `translation-compare` führte „LUT, SCH, ELB, MB" wörtlich, `variant-check` drei Editionen und die TAGNT-Bezeugung; eine Instanz, der davon etwas fehlt, wurde damit zu Aufrufen aufgefordert, die fehlschlagen müssen. Übersetzungen und Editionen erscheinen jetzt mit Namen, nicht als bloße Kürzel.
- **Die Prompts benennen die Felder, die die Antworten wirklich tragen.** `word-study` verwies auf „Gloss, Definition, Abbott-Smith", während die Antwort `kurzbedeutung`, `bedeutung` und `lexikon` führt, und trennt jetzt `gesamt` (Vorkommen) von `verse` (Verse). `variant-check` nennt `warnung`, `quellenkonflikte` und `in_dieser_db` ausdrücklich: die Vorbehalte, die sonst tief in der Antwort stehen bleiben.

### Behoben

- Ein fehlendes Pflichtargument erzeugte einen Prompt mit einer Lücke im Text und meldete Erfolg. `prompts/get` weist ihn jetzt unter Nennung des Feldes zurück, begrenzt Argumente auf 100 Zeichen und faltet Zeilenumbrüche.
- Das MCPB-Manifest nannte die Prompt-Argumente `wort` und `stelle`; sie heißen `word` und `reference`.

## [0.5.6] - 2026-07-29

### Hinzugefügt

- Der HTTP-Modus vermerkt auf stderr, in welcher Protokollfassung ein Aufrufer spricht: eine Zeile je Fassung, nicht je Anfrage, höchstens 20 Fassungen. Ein Zugriffsprotokoll ist das ausdrücklich nicht. Es ist die Vorwarnung für die MCP-Revision 2026-07-28, die `initialize` und die Sitzung abschafft und die dieser Server nicht bedient: Ein Client, der sie spricht, bekommt hier sonst still eine Antwort nach altem Verfahren. Die Fassung wird gegen das Format `JJJJ-MM-TT` geprüft, bevor sie ins Protokoll gelangt; alles andere erscheint als fester Platzhalter, und die Bezeichnung der Client-Software wird nicht erfasst.

### Behoben (Dokumentation)

- Das MCPB-Manifest führte `bible_server_info` nicht auf, obwohl der Server es seit 0.5.2 registriert. Die Liste dort ist handgepflegt; jetzt stimmen beide mit acht Einträgen überein.
- Die Lizenzangabe zu Schlachter 1951 sprach von entferntem HTML-Fußnoten-Markup. Die Quelle enthält keines, geprüft am 28.07.2026 zeichengenau über alle 31 101 Verse gegen den statischen Export.
- `README.md` nannte zwei Unterschiede zwischen HTTP- und stdio-Betrieb, es sind drei.

### Hinzugefügt (Dokumentation)

- Neu: `docs/ENTSCHEIDUNGEN.md` für Begründungen und Messungen, die an keiner einzelnen Codestelle stehen. Erste Einträge: das Protokoll-Log und der Befund, dass dieser Server Clients beider Ären als alten Server erkennbar bleibt, weil das 1.x-SDK mit dem Fehlercode -32000 antwortet und nicht mit dem modernen -32022.

## [0.5.5] - 2026-07-26

### Behoben

- `bible_lookup` kürzt Verslisten nicht mehr stillschweigend. Mehr als 30 kommagetrennte Segmente wurden abgeschnitten und die zu kurze Antwort ohne Hinweis ausgegeben (`"1,2,…,35"` in Psalm 119 kam als 119,1-30 zurück). Jetzt wird abgewiesen und die Grenze benannt.
- Die Versgrenze gilt in beiden Nachschlagepfaden: `"1-500"` lief bisher wie gültige Eingabe durch, `"1-500,2"` lieferte Vers 2 allein.
- Die Zeichengrenze für `verses` wird aus Segment- und Versgrenze gerechnet und liegt damit bei 239 statt 200. Die alte Zahl wies gültige Eingabe ab, etwa 30 Segmente `100-176`.
- Fehlermeldungen nennen die verletzte Bedingung. Ein zu langer Buchname bekam „'book' is required", obwohl er gesetzt war; `verses` hat statt einer Sammelmeldung vier: Typ, Länge, Segmentzahl, Wertebereich.
- `bible_search` sagt jetzt, wenn oberhalb von 1000 Treffern nicht ausgezählt wurde. `vorkommen_gesamt` und `verteilung` entfielen dort kommentarlos; der `hinweis` nennt Grenze, Grund und Ausweg.

### Geändert (Dokumentation)

- `AGENTS.md` ist entfallen; die Verweise in `README.md` und `docs/TYPESCRIPT.md` sind ersetzt, das Beispiel für den stdio-Aufruf steht jetzt im README.
- Neu: `docs/UEBERSETZUNGEN.md` mit der geprüften Lizenzlage möglicher weiterer Übersetzungen. Der Server führt weiter dieselben vier.

## [0.5.4] - 2026-07-26

### Geändert

- `bible_server_info` liefert die Urtext-Editionen in derselben Form wie die Übersetzungen, also mit Namen statt nur mit Kürzel (`{"code": "byzantine", "name": "Byzantinischer Mehrheitstext (Robinson-Pierpont 2005)"}`). Die Namen stammen aus `EDITION_META`, nicht aus einer zweiten Liste. Die Antwort wächst dadurch von 624 auf 995 Zeichen, `tools/list` bleibt unverändert.
- Zwei Kommentare in `server.ts` zum `instructions`-Feld widersprachen einander und halten jetzt den gemessenen Stand fest. Ohne Verhaltensänderung.

### Behoben (Dokumentation)

- `docs/TYPESCRIPT.md` sprach von einer fehlenden Testsuite, gemeint war „kein Test-Framework": `tests/test-golden.ts` ist dort jetzt genannt. Ebenfalls nachgezogen: der HTTP-Modus über `MCP_HTTP_PORT`.

### Anmerkung zur Messung

Die Zeichenzahlen dieser Fassung sind über einen stdio-Client an `JSON.stringify(result)` der `tools/list` gemessen: 7201 Zeichen für alle sieben Werkzeuge, davon 361 für `bible_server_info`. Die abweichenden Zahlen im Abschnitt zu 0.5.2 ließen sich nicht mehr nachvollziehen und bleiben dort unverändert stehen.

## [0.5.3] - 2026-07-26

### Geändert (Infrastruktur)

- Releases entstehen aus einem `release.yml`-Workflow: Ein `v*`-Tag baut beide Bundles (`linux-x64`, `darwin-arm64`) aus einem sauberen Checkout, legt die GitHub-Release als Entwurf mit dem passenden Changelog-Abschnitt an und prüft, dass genau zwei Assets hochgeladen sind. Anlass war 0.5.2: Der Tag lag auf GitHub, die Release samt Bundles fehlte.

  Drei Abbruchbedingungen: Tag und `version` in `package.json` müssen übereinstimmen, ein fehlender Changelog-Abschnitt bricht ab, und der Typecheck läuft auf dem getaggten Stand, den `lint.yml` bisher nicht berührte.

  Diese Fassung ist inhaltlich identisch mit 0.5.2.

## [0.5.2] - 2026-07-26

### Hinzugefügt

- **`bible_server_info`** (siebtes Werkzeug): meldet `version`, die geladenen `uebersetzungen`, die `urtext_editionen`, fünf Flags unter `zusatzdaten` (Strong-Lexikon, dessen STEPBible-Vollständigkeit, Editionsbezeugung, Querverweise, Volltextsuche) sowie `daten_stand` aus der `provenance`-Tabelle.

  **Warum ein Werkzeug und nicht das billigere `instructions`-Feld:** Am 26.07.2026 gemessen sahen zwei Sitzungen in Claude Desktop ausschließlich die Inhalte von `tools/list`; das `initialize`-Result reicht dieser Client dem Modell nicht durch. Ein Tool-Result ist der einzige sichere Kanal. Kosten: `tools/list` wächst um 379 Zeichen (+5,3 %) je Sitzung.

  **Bewusst nicht gemeldet:** Hostname, Pfade, Prozess, Laufzeit (der HTTP-Endpunkt ist öffentlich und authlos), eine Gesamtzahl der Verse und die Quell-URLs. Der Handler liegt **vor** der `dataMissing`-Sperre der sechs Daten-Werkzeuge, weil die Frage nach Fassung und Bestand ohne Datenbank besonders naheliegt.

- Das `instructions`-Feld bleibt trotz des Messergebnisses gesetzt: Es kostet nichts, andere Clients zeigen es, und sein Satz „Quote scripture only from the bible_* tools, never from memory" ist unabhängig von der Versionsfrage sinnvoll.

### Geändert

- Die Menge-Übersetzung heißt **„Menge 1939"**, damit alle vier Übersetzungen ihre Ausgabe im Namen tragen. Code `MB` und alle Aliase bleiben, `menge1939` kommt hinzu.

## [0.5.1] - 2026-07-26

### Geändert (Typografie)

- Der Em-Dash (`—`) ist aus allen deutschen Texten verschwunden, betroffen sind die Dokumentation und die deutschen Ausgabetexte in `server.ts` (`hinweis`, `warnung`, `lesehinweis`, Fehlermeldungen, Prompts). Gesetzt ist jetzt, was der Satzbau verlangt.

  **Nicht** angetastet: englische Kommentare und Tool-`description`s, der Platzhalter `"—"` für „kein Wert", ältere Einträge in dieser Datei, die Servermeldungen wörtlich zitieren.

  Reine Interpunktion, kein Feld geändert, die 61 Zusicherungen laufen durch. **Nicht gemessen** ist, ob die veränderte Interpunktion das Modellverhalten berührt.

- Die H1 der README lautet **Bibelstudium MCP** statt `bibelstudium-mcp`. Der Paketname bleibt.

## [0.5.0] - 2026-07-26

### Hinzugefügt (Zahlen, die bisher geschätzt wurden)

- `bible_search` liefert `verteilung`: je Buch bei einer Suche über die ganze Bibel, je Kapitel bei einer auf ein Buch eingegrenzten, mit Vers- (`treffer`) und Vorkommenszahl (`vorkommen`). Ausgezählt über **alle** Treffer, nicht über die gelisteten Verse; entfällt bei nur einem Eintrag.
- `bible_compare` beziffert Wortzahlen je Edition in `woerter` und hinter jedem mehrwortigen Unterschied die Länge des Laufs.

  Hintergrund: Über sechs von Hand nachgerechnete Läufe waren die Zahlen, die ein Werkzeug **nennt**, 10/10 richtig, während abgeleitete Summen in etwa der Hälfte der Fälle falsch waren, und zwar so, dass die Gesamtsumme aufgeht (das Comma Johanneum als „16 zusätzliche Wörter", wo es 17 sind).

  Additiv, kein bestehendes Feld geändert.

### Geändert (Ablage)

- Der Regressionstest liegt in `tests/` statt in `scripts/`, denn `scripts/` ist der Datenaufbau. Aufgerufen unverändert über `bun run test`.

## [0.4.0] - 2026-07-25

### Hinzugefügt (Namensnennung)

- **Jede Antwort nennt die Quellen, aus denen sie stammt** (Feld `quellen` mit `werk`, `lizenz`, `nennung`). Das ist Lizenzpflicht, die durch das Hosten einschlägig wird: Vier der Quellen stehen unter CC BY, zwei unter CC BY-SA, und wer den Server nur über MCP benutzt, sieht `THIRD_PARTY_LICENSES.md` nie.

  Genannt wird nur, was die Antwort tatsächlich benutzt hat; `nennung: null` heißt „Lizenz verlangt keine". Über stdio in acht Fällen geprüft, keine fehlende und keine überschüssige Nennung.

- Das Freitextfeld `quelle` in `bible_crossrefs` entfällt.

### Geändert (HTTP-Betrieb)

- **`bible_setup` gibt es im HTTP-Modus nicht.** Es lädt rund 145 MB von acht fremden Quellen und ersetzt die Datenbankdatei; über stdio gehört das dem, der den Prozess gestartet hat, an einem erreichbaren Endpunkt Fremden. Bei gesetztem `MCP_HTTP_PORT` fehlt es in `tools/list` **und** der Handler lehnt es ab: Eine ungelistete Werkzeugbezeichnung lässt sich weiterhin schicken. Gemessen am 25.07.2026 in drei Fällen.
- Ohne Datenbank verwiesen alle Werkzeuge darauf, `bible_setup` aufzurufen. Im HTTP-Modus sagt die Meldung jetzt, dass sich das nur serverseitig beheben lässt.

### Hinzugefügt

- **`server.ts --setup`** baut die Datenbank und beendet sich, das Gegenstück zu `bible_setup` für die Betreiberseite. Ohne diese Flagge bräuchte ein Endpunkt Bun und ein Checkout auf dem Zielrechner.
- Ein CI-Guard für den HTTP-Modus (503 auf `/health`, `bible_setup` weder gelistet noch ausführbar). Gegengeprüft: mit ausgehebelter Sperre schlägt er fehl.
- **`/health` fragt die Datenbank ab**, statt den Startzustand zu wiederholen: Antwortet sie nicht, kommt **503** mit Grund im Rumpf. Gemessen an einer im laufenden Betrieb zerstörten Datei.

### Behoben

- **Ein `GET /mcp` blieb zwei Minuten als leerer Stream offen.** Der Server ist zustandslos und schiebt keine Nachrichten, hielt die Verbindung aber trotzdem: 30 parallele Aufrufe banden 30 Dateideskriptoren. Jetzt 1,2 ms statt 120 s. Der Status bleibt **200** statt 405, weil der einzige nachweislich funktionierende authlose Custom Connector so antwortet.
- `DATASET_QUELLEN` war als `Record<string, Quelle>` typisiert, ein Klammerzugriff mit Tippfehler hätte eine lizenzpflichtige Nennung stillschweigend unterdrückt. Die Schlüssel sind jetzt konkret typisiert.
- Härtung des HTTP-Servers: `maxRequestBodySize` 1 MB statt 128 MB (413 oberhalb, gemessen), `development: false` gegen Stacktraces in Antworten.
- `server.ts --setup` sagt jetzt, dass es eine vorhandene Datenbank ersetzt.
- **Der Server meldete `0.2.2`, während Paket und Release auf `0.3.0` standen.** Die Version kommt jetzt per JSON-Import aus `package.json`, geprüft unter `bun run` und im kompilierten Binary.

## [0.3.0] - 2026-07-25

### Hinzugefügt (Einrichtung ohne Terminal)

- **`bible_setup`: der Server baut seine Datenbank selbst.** Wer über das MCPB-Bundle installiert, hat kein Terminal im Spiel. Der Server startet jetzt auch ohne Datenbank, meldet was fehlt und sperrt die sechs Datenwerkzeuge mit einem Hinweis, statt sie „Buch nicht gefunden" antworten zu lassen.

  **Der Download startet nur auf ausdrückliche Bestätigung.** Ohne `bestaetigung=true` liefert das Werkzeug nur den Plan. Am 25.07.2026 im installierten Bundle durchgemessen: Das Modell fragte zurück, statt den Download sofort auszulösen, alle acht Schritte liefen durch, der Neustart-Hinweis kam beim Nutzer an.

  **Ein Teilausfall bricht nicht den ganzen Aufbau ab.** Jeder Schritt arbeitet auf einer privaten Kopie und tauscht sie atomar ein; nur der erste ist zwingend. Der Bericht nennt Fehler, fehlende Funktion und den Befehl zum Nachholen. Gemessen: acht von acht Schritten in 26 Sekunden, gleicher SHA-256 wie eine über die Skripte gebaute Datenbank.

- `bun run setup` führt dieselben acht Schritte auf der Kommandozeile aus.
- **`db-path.ts`**: eine gemeinsame Pfadauflösung für Server und Skripte. Vorher hätte der Server `BIBLE_DB_PATH` beachtet und die von ihm aufgerufenen Skripte neben ihren eigenen Quelltext geschrieben. Ein installiertes Bundle legt die Datenbank im Benutzerordner ab, nicht neben dem Programm: Dessen Verzeichnis wird beim Update ersetzt.
- Die Angabe der Datenbank ist im Bundle damit optional.

### Behoben

- **Ein leer gelassenes Feld im Installationsdialog machte den Aufbau unmöglich.** Claude Desktop reicht `${user_config.db_path}` wörtlich als `BIBLE_DB_PATH` durch. Der Download lief vollständig durch und scheiterte erst beim Schreiben, mit einer SQLite-Meldung, die wie ein Netzwerkfehler klingt. `db-path.ts` verwirft jetzt jeden Wert mit unaufgelöstem `${…}`.
- **Das Bundle enthielt eine 63 MB große Blindkopie des Servers.** `bun build --compile` legt eine temporäre Kopie im Arbeitsverzeichnis ab; lief der Compiler im Staging-Ordner, wurde sie mitgepackt (121 MB statt 61 MB entpackt). Der Compiler arbeitet jetzt in einem eigenen Verzeichnis.

### Geändert

- **`bun run download` lädt jede Übersetzung als einen statischen Export** statt Kapitel für Kapitel. Genau davon rät die API-Dokumentation von bolls.life ausdrücklich ab. Aus 4760 Anfragen wurden acht, aus rund 20 Minuten **3,2 Sekunden**, bei identischem SHA-256 über alle 124 441 Verse und über `books`.

  Der Provenance-Digest hasht jetzt die empfangenen Bytes statt einer Neuserialisierung. Bestehende Datenbanken müssen nicht neu gebaut werden.

### Hinzugefügt

- **MCPB-Bundle (`.mcpb`) für Claude Desktop** mit eigenständigem Binary aus `bun build --compile`, also **ohne installiertes Bun**. Damit entfallen zwei Stolperstellen: GUI-Anwendungen erben unter macOS die Shell-`PATH` nicht, und Claude Desktop überschreibt beim Beenden seine Konfigurationsdatei.

  Das Bundle enthält **nicht** die Datenbank (rund 145 MB, und STEPBible bittet darum, ihre Dateien nicht weiterzuverbreiten). Ein Bundle trägt genau ein Binary und läuft auf genau einer Plattform; `compatibility.platforms` wird aus dem Compile-Target abgeleitet. Geprüft ist bisher `bun-darwin-arm64`.

- `BIBLE_DB_PATH` überschreibt den Datenbankpfad; ein gesetzter, aber leerer Wert zählt als nicht gesetzt. Nötig wurde die Variable durch das Bundle: Im kompilierten Binary zeigt `import.meta.path` in Buns virtuelles Dateisystem, sodass der Server dort nicht startete. Kompilierte Läufe suchen jetzt neben dem Binary, erkannt am nicht existierenden Verzeichnis statt an einem fest verdrahteten Bun-Pfad.

## [0.2.2] - 2026-07-25

### Hinzugefügt

- Alle sechs Werkzeuge tragen `annotations: { readOnlyHint: true, openWorldHint: false }`. Beide weichen vom Vorgabewert der Spezifikation ab, der hier falsch wäre. `destructiveHint`/`idempotentHint` bleiben weg: Das Schema definiert sie als nur bedeutsam, wenn `readOnlyHint` `false` ist.
- **HTTP-Transport (Streamable HTTP), optional über `MCP_HTTP_PORT`.** Ohne die Variable bleibt es bei stdio; gesetzt lauscht der Server auf `/mcp` und beantwortet `/health`. Gebunden wird ohne `MCP_HTTP_HOST` an `127.0.0.1`. Der Modus ist **zustandslos**: je Anfrage eine eigene Serverinstanz, Datenbank und Statements geteilt; über 1200 Anfragen gemessen bleibt der Speicher stabil. CORS-Kopfzeilen sind gesetzt, die Origin-Prüfung weist fremde Herkunft weiterhin mit 403 ab. TLS und Zugriffsschutz bringt der Server nicht mit.
- `docs/anweisungen/claude-desktop.txt`: fertiger Text für die Client-Anweisungen in Claude Desktop. Ob ein Werkzeug aufgerufen und wie sein Ergebnis wiedergegeben wird, entscheidet der Client. Zugeschnitten auf die Datenlage dieses Repos.
- `bun run test`: Regressionstest über stdio gegen einen frischen Serverprozess, 58 Zusicherungen. Braucht eine gebaute Datenbank und läuft deshalb nicht in der CI.
- `bible_lookup`, `bible_crossrefs` und `bible_search` weisen auf Wörter in eckigen Klammern hin. Menge setzt erklärende Einschübe so (137 Verse); ohne die Klammern liest sich ein Einschub der Ausgabe wie gewöhnlicher Text. Der Hinweis nennt bewusst kein Beispielwort.

### Behoben

- `bible_original`, `bible_crossrefs` und `bible_compare` wiesen Werte außerhalb des gültigen Bereichs mit „`'verse' must be a positive integer`" zurück, einer Bedingung, die die Eingabe erfüllt; verletzt war die Obergrenze. Sechs Meldungen in drei Handlern nennen jetzt die tatsächliche Grenze. Grenzen und Meldungstexte liegen dafür in gemeinsamen Konstanten (`MAX_CHAPTER`, `MAX_VERSE`, `chapterOutOfRange`, `verseOutOfRange`).

## [0.2.1] - 2026-07-25

### Geändert

- Repository-Wurzel aufgeräumt: Die neun Datenaufbau-Skripte und ihre Helfer liegen unter `scripts/`, im Root bleiben `server.ts` und `translations.ts`. Der Schnitt folgt der Laufzeitgrenze. An den Kommandos ändert sich nichts.
- Dokumentation und Fehlermeldungen nennen die `package.json`-Aliase statt der Dateipfade; der Pfad ist damit nicht mehr Teil der Schnittstelle.

## [0.2.0] - 2026-07-25

### Hinzugefügt

- `bible_compare` gleicht die TAGNT-Variantennotizen gegen die geladenen Editionstexte ab. Neu in `bezeugung`: `in_dieser_db`, `abgleich` und `lesehinweis`. TAGNTs „Byz" ist nicht deckungsgleich mit Robinson-Pierpont 2005; über 400 zufällige NT-Verse gemessen weichen beide in rund 11 % voneinander ab. Additiv.
- Widersprüche zwischen Notiz und Editionstext erscheinen zusätzlich als `warnung` und `quellenkonflikte` **oben** in der Antwort. Vier Ebenen tief wurden sie übersehen (beobachtet an Mk 14,46).
- `bible_crossrefs` liefert `verse_einzeln` für mehrversige Verweise, ein Eintrag je Vers ohne eingebettete Versnummern. Beobachtet: Joh 11,25-26 beim Zitieren vorn und hinten angeschnitten.
- `bible_search` nennt `vorkommen_gesamt` neben `treffer`: `treffer` zählt Verse, ein Vers kann den Begriff mehrfach enthalten. Wird ab 1000 Treffern übersprungen.
- Der `hinweis` von `bible_original` beschreibt die Schreibweise des Feldes `wort` je Edition. Ohne diese Angabe ergänzen Modelle beim Zitieren Akzente oder glätten Zeichen weg.

### Geändert

- Die Beschreibung von `bible_lookup` nennt Existenz- und Kanonfragen ausdrücklich. Bisher warb sie nur mit „für alle Bibelzitate", worunter die Frage nach einem nicht existierenden Buch nicht fiel: Sie wurde ohne Werkzeugaufruf beantwortet.
- Fehlermeldungen zu unbekannten Büchern beginnen mit dem Sachverhalt statt mit `Error:`; das `isError`-Flag bleibt. Rein redaktionell: Die ursprüngliche Begründung hielt der Nachprüfung nicht stand.
- Alle fünf Werkzeuge melden unbekannte Buchnamen einheitlich über `bookNotFound`. Die Meldung nennt das nächstliegende bekannte Buch und weist apokryphe Titel ausdrücklich als nicht enthalten aus, statt ein ähnlich klingendes Buch des Kanons vorzuschlagen.
- Der `hinweis` von `bible_compare` nennt kein Beispiel für eine Variantenart mehr. Das frühere „(z. B. bewegliches Ny)" wurde als Etikett aufgegriffen und auf einen unpassenden Fall geklebt.
- Die Einträge in `quellenkonflikte` nennen zuerst, was die Edition liest, und erst danach die widersprechende Notiz. Umgekehrt las es sich wie eine Randbemerkung und entfiel beim Wiedergeben.
- **`bible_search` markiert Fundstellen mit `⟦…⟧` statt `«…»`.** Die alten Marker kollidierten mit den Anführungszeichen der Übersetzungen selbst (Menge 8339 Verse, Schlachter 887). Wer die Marker auswertet, muss das Zeichen anpassen.
- `server.ts` neu gegliedert, **ohne jede Verhaltensänderung**: 22 Abschnittsbanner statt 7, acht Deklarationen an ihren fachlichen Ort verschoben, überlange Morphologie-Tabellen umbrochen. Belegt gegen einen Golden-Snapshot aus 79 stdio-Aufrufen: byteweise identisch.

### Behoben

- `download.ts` normalisiert Buchnamen ohne Leerzeichen vor der Klammer (`2. Mose(Exodus)`). Buchnamen erscheinen in jeder Konkordanz-, Such- und Querverweisausgabe.
- Griechische Formen wurden samt Koronis `᾽` verglichen, sodass `ἀλλ᾽` nie auf das gespeicherte `αλλ` traf. Reine Elisionsunterschiede lösen jetzt keine Widerspruchsmeldung mehr aus.

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
- Strikter Typecheck und GitHub-Actions-CI, die ihn zusammen mit den Startprüfungen und yamllint ausführt
