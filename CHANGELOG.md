# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei
dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
und dieses Projekt folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.5.1] - 2026-07-26

### Geändert (Typografie)

- **Der Em-Dash (`—`) ist aus allen deutschen Texten verschwunden.** Im Deutschen ist er das falsche Zeichen; gesetzt ist jetzt, was der Satzbau verlangt: Doppelpunkt, wo eine Erläuterung folgt, Punkt bei einem eigenständigen Satz, Komma bei Appositionen, Semikolon in Aufzählungen. Nur an zwei Stellen steht ein Halbgeviertstrich `–`, dort nämlich, wo ein Doppelpunkt schon vergeben ist. Betroffen sind die Dokumentation (README, AGENTS, CONTRIBUTING, SECURITY, THIRD_PARTY_LICENSES, docs/) **und** die deutschen Ausgabetexte in `server.ts`: `hinweis`, `warnung`, `lesehinweis`, Fehlermeldungen und die drei Prompts.

  **Nicht** angetastet: englische Kommentare und die englischen Tool-`description`s, weil der Em-Dash im Englischen richtig ist, sowie der Platzhalter `"—"` für „kein Wert", der ein Symbol ist und kein Satzzeichen. Ältere Einträge in dieser Datei, die eine Servermeldung wörtlich zitieren, bleiben ebenfalls unverändert: Sie geben den Stand ihres Releases wieder.

  Reine Interpunktion, kein Wort wurde umformuliert und kein Feld geändert. Die 61 Zusicherungen laufen unverändert durch; keine hängt an diesem Zeichen. **Nicht gemessen** ist, ob die veränderte Interpunktion das Modellverhalten berührt: Mehrere dieser Hinweistexte gehen auf Messreihen zurück, die neue Fassung ist nicht erneut gemessen worden.

- Die H1 der README lautet **Bibelstudium MCP** statt `bibelstudium-mcp`. Der Paketname bleibt unverändert, die Überschrift ist Prosa.

## [0.5.0] - 2026-07-26

### Hinzugefügt (Zahlen, die bisher geschätzt wurden)

- **`bible_search` nennt eine Verteilung** (`verteilung`): je Buch bei einer Suche über die ganze Bibel, je Kapitel bei einer auf ein Buch eingegrenzten, mit der Zahl der Verse (`treffer`) und der Vorkommen (`vorkommen`). Sie wird über **alle** Treffer ausgezählt, nicht über die gelisteten Verse, und entfällt bei nur einem Eintrag, weil sie dann nur `treffer` wiederholt.

- **`bible_compare` beziffert Wortzahlen**: je Edition in `woerter`, und hinter jedem Unterschied mit mehr als einem Wort die Länge des Laufs in Klammern (`(17 Wörter)`). Ein-Wort-Unterschiede bleiben unbeziffert, sonst ersäuft der interessante Fall im Rauschen.

  Beides geht auf dieselbe Messung zurück: Über sechs Läufe von Hand nachgerechnet waren die Zahlen, die das Werkzeug **nennt**, 10/10 richtig, während selbst abgeleitete Kapitelsummen und Wortzahlen in etwa der Hälfte der Fälle falsch waren, und zwar so, dass die Gesamtsumme aufgeht und die Auszählung belegt wirkt. Konkret: das Comma Johanneum als „16 zusätzliche Wörter" wiedergegeben, wo Editionsdiff und TAGNT-Bezeugung übereinstimmend **17** sagen. Wo eine Zahl nicht im Werkzeugergebnis steht, wird sie geschätzt und erscheint trotzdem im Tonfall einer Messung.

  Additiv, keine bestehenden Felder geändert. Über stdio gegen einen frischen Prozess geprüft und per SQL gegengerechnet; die Zusicherungen zu den Wortzahlen stehen in `tests/test-golden.ts`.

### Geändert (Ablage)

- **Der Regressionstest liegt in `tests/`** statt in `scripts/`. `scripts/` ist der Datenaufbau: einmalige Läufe, die aus dem Netz laden und die Datenbank schreiben. Der Test tut das Gegenteil, er startet den fertigen Server als eigenen Prozess und liest nur. Aufgerufen wird er unverändert über `bun run test`; der Pfad ist keine Schnittstelle. Ältere Einträge in dieser Datei nennen weiterhin den alten Pfad: Sie beschreiben den Stand ihres Releases und werden nicht rückwirkend umgeschrieben.

## [0.4.0] - 2026-07-25

### Hinzugefügt (Namensnennung)

- **Jede Antwort nennt die Quellen, aus denen sie stammt** (Feld `quellen`, je Eintrag `werk`, `lizenz` und `nennung`). Das ist keine Höflichkeit, sondern eine Lizenzpflicht, die durch das Hosten einschlägig wird: Schlachter 1951, die STEPBible-Daten, die OpenBible-Querverweise und die OSHB-Morphologie stehen unter CC BY, die MorphGNT-Morphologie und die Strong-Wörterbücher unter CC BY-SA. CC 4.0 zählt öffentliches Verfügbarmachen ausdrücklich als „Share", und wer den Server nur über MCP benutzt, sieht weder `THIRD_PARTY_LICENSES.md` noch eine Website. Bisher trug keine Ausgabe eine Attribution. Vorbild ist `orthotomeo`, das dasselbe tut.

  Genannt wird nur, was die Antwort benutzt hat: ein `bible_lookup` in Luther 1912 berührt keine CC-BY-Quelle und behauptet auch keine, `bible_concordance` nennt ein Lexikon nur bei beigetragenem Eintrag, `bible_compare` nur die tatsächlich verglichenen Editionen. `nennung: null` heißt „Lizenz verlangt keine". Über stdio geprüft: acht Fälle über alle sechs Werkzeuge, keine fehlende und keine überschüssige Nennung.

- Das Freitextfeld `quelle` in `bible_crossrefs` entfällt; es sagte dasselbe unstrukturiert und nur für dieses eine Werkzeug.

### Geändert (HTTP-Betrieb)

- **`bible_setup` gibt es im HTTP-Modus nicht.** Das Werkzeug lädt rund 145 MB von acht fremden Quellen und ersetzt die Datenbankdatei. Über stdio ist das eine Erleichterung: Wer den Prozess gestartet hat, besitzt den Rechner. An einem erreichbaren Endpunkt ist es eine Handhabe für Fremde, und der Zustand, der es freischaltet (keine Datenbank), ist genau der, den ein Ausfall oder eine beschädigte Datei herstellt. Bei gesetztem `MCP_HTTP_PORT` erscheint das Werkzeug deshalb nicht in `tools/list`, und der Handler lehnt einen trotzdem gesendeten Aufruf ab: eine ungelistete Werkzeugbezeichnung lässt sich weiterhin schicken, die Sperre gehört also in den Handler, nicht in die Liste.

  Gemessen am 25.07.2026 gegen frisch gestartete Prozesse: im HTTP-Modus sechs Werkzeuge ohne `bible_setup`, mit **und** ohne vorhandene Datenbank, ein direkter Aufruf mit `bestaetigung=true` abgelehnt, keine Datei angelegt. Über stdio ohne Datenbank erscheint `bible_setup` unverändert.

- **Die Meldung der gesperrten Werkzeuge unterscheidet die Adressaten.** Ohne Datenbank verwiesen alle sechs Werkzeuge darauf, den Nutzer zu fragen und `bible_setup` aufzurufen. An einem Endpunkt benennt das ein Werkzeug, das dort nicht angeboten wird und dem Aufrufer nicht zur Verfügung steht. Im HTTP-Modus sagt die Meldung jetzt, dass sich das nur serverseitig beheben lässt und ein erneuter Aufruf nicht hilft. Der Satz, der in beiden Fällen gilt, bleibt: nicht aus dem Gedächtnis antworten.

### Hinzugefügt

- **`server.ts --setup` baut die Datenbank und beendet sich.** Das Gegenstück zu `bible_setup` für die Betreiberseite, nötig geworden, weil das Werkzeug im HTTP-Modus entfällt: ohne diese Flagge bräuchte die Einrichtung eines Endpunkts Bun und ein Checkout auf dem Zielrechner, und das eigenständige Binary gibt es gerade deshalb, damit dort keins von beidem liegen muss. Derselbe Ablauf und derselbe Bericht wie `bun run setup`. Die Flagge wird über die vollständige `argv` gesucht, weil ein `bun run server.ts` sie an anderer Stelle führt als ein kompiliertes Binary.

- **Ein CI-Guard für den HTTP-Modus.** Gegenstück zu den beiden stdio-Guards: Er startet den Server mit `MCP_HTTP_PORT` und ohne Datenbank und prüft, dass `/health` mit 503 antwortet, `bible_setup` nicht in `tools/list` steht und ein direkter Aufruf abgelehnt wird. Genau dieser Zustand liegt in der CI ohnehin vor, während er lokal nie auftritt, weil dort eine Datenbank liegt. Gegengeprüft: mit absichtlich ausgehebelter Sperre schlägt er fehl, nicht nur wenn alles stimmt.

- **`/health` prüft die Datenbank, statt den Startzustand zu wiederholen.** Antwortet sie nicht, kommt **503** mit `{"status":"fehler","grund":…}` statt `200 ok`. Ein Endpunkt hat kein Terminal, das stderr mitliest, und mit dem entfallenen `bible_setup` bleibt kein Weg im Protokoll, einen Schaden zu bemerken: die Werkzeuge würden sich nur der Reihe nach verweigern. Der alte Wert wurde einmal beim Booten ermittelt und hätte einen späteren Schaden nicht gezeigt. Gemessen an einer Datenbank, die **im laufenden Betrieb** zerstört wurde: `/health` kippt von 200 auf 503 und nennt „file is not a database". Die Prüfung ist eine Zeile auf `books` aus dem SQLite-Seitencache, also billig genug für einen Monitor.

### Behoben

- **Ein `GET /mcp` blieb zwei Minuten als leerer Stream offen.** Der GET-Kanal dient server-initiierten Nachrichten; dieser Server sendet keine, ist zustandslos und hat nichts fortzusetzen. Trotzdem lief ein GET durch den Transport und wurde als SSE-Stream offengehalten, der nie ein Byte lieferte: gemessen 120 Sekunden je Verbindung, 30 parallele GETs hielten 30 Dateideskriptoren samt je einer Serverinstanz. An einem anonymen Endpunkt ist das ein kostenloser Verbindungshalter, gegen den eine vorgelagerte Ratenbegrenzung schlecht hilft, weil keine Anfragen mehr nachkommen müssen. GET antwortet jetzt sofort. Gemessen: 1,2 ms statt 120 s, und 20 parallele GETs lassen die Deskriptorzahl unverändert.

  Der Status bleibt **200** und wird nicht auf das von der Spezifikation erlaubte 405 geändert: Der einzige fremde Endpunkt, der als authloser Custom Connector nachweislich funktioniert, antwortet mit 200, und dieser Server wurde eigens darauf angeglichen. Begründung an der Entscheidungsstelle im Code.

- **Ein verschriebener Quellen-Schlüssel hätte eine Nennung stillschweigend weggelassen.** `DATASET_QUELLEN` war als `Record<string, Quelle>` typisiert, ein Klammerzugriff mit Tippfehler lieferte damit `undefined` statt eines Fehlers: Er hätte kompiliert, alle Tests grün gelassen und eine lizenzpflichtige Attribution unterdrückt. Die Schlüssel sind jetzt konkret typisiert und werden per Punkt gelesen; gegengeprüft, dass ein Tippfehler nun ein Typfehler ist.

- **Härtung des HTTP-Servers.** `maxRequestBodySize` auf 1 MB, statt Buns Voreinstellung von 128 MB; die größte legitime Anfrage ist ein Werkzeugaufruf mit einer Bibelstelle. Gemessen: ein Rumpf über der Grenze wird mit **413** abgewiesen. Dazu `development: false`, damit eine künftige ungefangene Ausnahme im Handler keinen Stacktrace an den Aufrufer ausliefert; alle heute geprüften Fehlerpfade fängt der SDK-Transport sauber ab.

- **`server.ts --setup` sagt jetzt, dass es eine vorhandene Datenbank ersetzt.** Anders als `bible_setup` lehnt die Flagge bei vorhandenen Daten nicht ab, denn sie ist auch der Weg, sie zu erneuern. Das schweigend zu tun war die falsche Hälfte davon.

- **Der Server meldete eine Version, die es als Release nicht gibt.** In `serverInfo` stand `0.2.2`, während `package.json` und das Release auf `0.3.0` standen: Der v0.3.0-Commit hob die von Hand gepflegte Zahl in `server.ts` von `0.2.1` auf `0.2.2` an, statt sie dem Paket nachzuziehen. Jeder Client bekam das im `initialize` zu sehen. Die Angabe kommt jetzt per JSON-Import aus `package.json`, also aus derselben Datei, aus der auch `build-mcpb.ts` das Manifest baut, und kann nicht mehr auseinanderlaufen. Geprüft unter `bun run` **und** im kompilierten Binary: beide melden die Version des Pakets. Beim Anheben einer Version ist `server.ts` damit nicht mehr anzufassen.

## [0.3.0] - 2026-07-25

### Hinzugefügt (Einrichtung ohne Terminal)

- **`bible_setup`: der Server baut seine Datenbank selbst.** Wer den Server über das MCPB-Bundle installiert, hat kein Terminal im Spiel und konnte die Datenbank deshalb bisher gar nicht herstellen. Der Server startet jetzt auch ohne sie: er meldet, was fehlt, bietet `bible_setup` an und sperrt die sechs Datenwerkzeuge mit einem Hinweis darauf, statt sie „Buch nicht gefunden" antworten zu lassen. Nach dem Aufbau verschwindet `bible_setup` wieder aus der Werkzeugliste.

  **Der Download startet nur auf ausdrückliche Bestätigung.** Ohne `bestaetigung=true` liefert das Werkzeug lediglich den Plan: Dauer, Umfang, Internetbedarf und was jeder der acht Schritte beisteuert. Es lädt rund 145 MB von acht fremden Quellen, und das gehört nicht hinter dem Rücken der Nutzerin gestartet, nur weil ein Modell nach einem Vers gefragt hat.

  **In Claude Desktop durchgemessen (25.07.2026)**, im installierten Bundle mit leer gelassenem Datenbankfeld: Auf „Wie lautet Johannes 3,29?" fragte das Modell zurück, ob der Download starten solle, **statt ihn sofort auszulösen**: Die Bestätigung ist nur eine Bitte an das Modell, keine Mechanik, und hielt hier stand. Nach der Zusage liefen alle acht Schritte durch, der Neustart-Hinweis wurde an den Nutzer weitergegeben statt verschluckt, und nach dem Neustart kam der Vers wortgetreu aus Luther 1912. Ein Werkzeugaufruf über rund eine Minute lief dabei ohne Timeout durch.

  **Ein Teilausfall bricht nicht den ganzen Aufbau ab.** Jeder Schritt arbeitet auf einer privaten Kopie und tauscht sie atomar ein, ein Fehlschlag lässt den vorherigen Stand also unberührt. Nur der erste Schritt ist zwingend (ohne Verse gibt es keine Datenbank); scheitert einer der übrigen, laufen die restlichen weiter, und der Bericht nennt den Fehler, die dadurch fehlende Funktion und den Befehl zum Nachholen. Gemessen: acht von acht Schritten in **26 Sekunden**, und der erzeugte Verstext hat denselben SHA-256 wie eine über die Skripte gebaute Datenbank.

- `bun run setup` führt dieselben acht Schritte auf der Kommandozeile aus, mit demselben Bericht.

- **`db-path.ts`**: eine gemeinsame Auflösung des Datenbankpfads für Server und Skripte. Vorher löste jede Datei ihn für sich auf, was harmlos war, solange die Skripte nur aus einem Checkout liefen. Mit `bible_setup` wurde es zum Fehler: Der Server hätte `BIBLE_DB_PATH` beachtet, die von ihm aufgerufenen Skripte hätten neben ihren eigenen Quelltext geschrieben. Ein installiertes Bundle ohne eigene Angabe legt die Datenbank jetzt im Benutzerordner ab (unter macOS `~/Library/Application Support/bibelstudium-mcp/`), nicht neben dem Programm: Das Verzeichnis einer Erweiterung wird bei einem Update ersetzt, und die geladenen Daten wären stillschweigend weg.

- Im Bundle ist die Angabe der Datenbank damit **optional** geworden. Wer schon eine `bible.db` hat, wählt sie weiterhin aus; wer nicht, lässt das Feld leer.

### Behoben

- **Ein leer gelassenes Feld im Installationsdialog machte den Aufbau unmöglich.** Claude Desktop ersetzt `${user_config.db_path}` nicht durch eine leere Zeichenkette, sondern reicht den Platzhalter wörtlich als `BIBLE_DB_PATH` durch. Der Download lief daraufhin vollständig durch und scheiterte erst beim Schreiben, mit einer SQLite-Meldung („unable to open database file"), die wie ein Netzwerkfehler klingt und auch so an den Nutzer gemeldet wurde. `db-path.ts` verwirft jetzt jeden Wert, der einen unaufgelösten `${…}`-Platzhalter enthält, und fällt auf den Benutzerordner zurück. Gemessen im installierten Bundle am 25.07.2026; danach 8 von 8 Schritten in 47 Sekunden, Datenbank im Benutzerordner, alle sechs Werkzeuge nutzbar.

- **Das Bundle enthielt eine 63 MB große Blindkopie des Servers.** `bun build --compile` legt eine temporäre Kopie im Arbeitsverzeichnis ab; lief der Compiler im Staging-Ordner, wurde sie mitgepackt und verdoppelte das Bundle (121 MB statt 61 MB entpackt, 46 MB statt 23 MB gepackt). Der Compiler arbeitet jetzt in einem eigenen Verzeichnis, das vor und nach dem Lauf geleert wird.

### Geändert

- **`bun run download` lädt jede Übersetzung als einen statischen Export statt Kapitel für Kapitel.** Bisher lief eine Schleife über `/get-text/<code>/<buch>/<kapitel>/`: 1190 Anfragen je Übersetzung, 4760 insgesamt, mit 200 ms Zwangspause dazwischen. Genau davon rät die API-Dokumentation ausdrücklich ab („Please do not do that! It is not what these endpoints are for, and it may cause performance issues") und verweist stattdessen auf `\/static/translations/<code>.json`. Der Aufbau der vier Übersetzungen fällt damit von rund 20 Minuten auf **3,2 Sekunden**, und der Betreiber sieht statt 4760 Anfragen noch acht (vier Exporte plus vier Buchlisten).

  Belegt gegen den bisherigen Stand: identischer SHA-256 über alle 124 441 Verse (`translation|book_id|chapter|verse|text`, sortiert) und über die `books`-Tabelle. Der Text ist byteweise derselbe, nur der Weg dorthin ist ein anderer.

  Der Provenance-Digest hasht jetzt die tatsächlich empfangenen Bytes statt einer Neuserialisierung des geparsten JSON, und die Quellenangabe in der Tabelle `provenance` nennt die Export-URL. Bestehende Datenbanken müssen deshalb nicht neu gebaut werden, ihr Herkunftseintrag beschreibt aber den alten Weg.

### Hinzugefügt

- **MCPB-Bundle (`.mcpb`) für Claude Desktop**, gebaut mit `bun run build:mcpb`. Das Bundle trägt ein eigenständiges Binary aus `bun build --compile` (61 MB, gepackt 23 MB) und braucht deshalb **kein installiertes Bun**. Damit entfallen zwei dokumentierte Stolperstellen auf einmal: GUI-Anwendungen erben unter macOS die Shell-`PATH` nicht, weshalb ein blankes `"command": "bun"` mit „server disconnected" scheitert: Im Bundle steht ein absoluter Pfad über `${__dirname}`; und Claude Desktop überschreibt beim Beenden die `claude_desktop_config.json` und verwirft dabei unbekannte Schlüssel, während installierte Bundles davon unberührt bleiben. Manifest-Quelle in `mcpb/manifest.json`, Build-Skript in `scripts/build-mcpb.ts`, Ergebnis unter `tmp/` (nicht versioniert).

  Das Bundle enthält **nicht** die Datenbank: sie ist rund 145 MB groß, und STEPBible bittet darum, ihre Datendateien nicht weiterzuverbreiten. Der Nutzer wählt beim Installieren eine bereits gebaute `bible.db` über einen Dateiauswahldialog aus (`user_config.db_path`); Claude Desktop reicht sie als `BIBLE_DB_PATH` an den Server. Ein Bundle ersetzt damit den Einrichtungsaufwand nicht: Es setzt eine aufgebaute Datenbank voraus und richtet sich an Nutzer, die diesen Schritt bereits hinter sich haben.

  Ein Bundle enthält genau ein Binary und läuft deshalb auf genau einer Plattform und Architektur; `compatibility.platforms` wird aus dem Compile-Target abgeleitet statt alle drei zu behaupten. Für andere Ziele nimmt das Skript ein Target-Argument (`bun run build:mcpb bun-windows-x64`). Gebaut und geprüft wurde bisher nur `bun-darwin-arm64`.

- `BIBLE_DB_PATH` überschreibt den Pfad zur Datenbank. Ohne die Variable bleibt es beim bisherigen Verhalten (`data/bible.db` neben dem Skript). Ein gesetzter, aber leerer Wert zählt als nicht gesetzt: Ein im Installationsdialog leer gelassenes Feld erreicht den Server als leere Zeichenkette und liefe sonst als Pfad in einen nackten SQLite-Fehler. Nötig wurde die Variable durch das Bundle: in einem `bun build --compile`-Binary zeigt `import.meta.path` in Buns virtuelles Dateisystem, sodass die bisherige skriptrelative Auflösung dort `/$bunfs/root/data/bible.db` ergab und der Server nicht startete. Kompilierte Läufe suchen jetzt neben dem Binary; erkannt wird der Fall daran, dass das virtuelle Verzeichnis auf der Platte nicht existiert (gemessen), nicht an einem fest verdrahteten Bun-Pfad.

## [0.2.2] - 2026-07-25

### Hinzugefügt

- Alle sechs Werkzeuge tragen jetzt `annotations: { readOnlyHint: true, openWorldHint: false }`. Beide Angaben sind sachlich richtig: Jedes Werkzeug liest ausschließlich aus der lokalen, read-only geöffneten SQLite-Datei, ohne Schreibzugriff, Seiteneffekte oder Netzwerk, und beide weichen vom Vorgabewert der Spezifikation ab (`readOnlyHint` sonst `false`, `openWorldHint` sonst `true`). `destructiveHint` und `idempotentHint` bleiben bewusst weg: das Schema definiert sie als nur dann bedeutsam, wenn `readOnlyHint` `false` ist. Rein additiv, keine bestehende Ausgabe ändert sich. Ob ein bestimmter Client die Angaben sichtbar auswertet, ist damit nicht behauptet.

- **HTTP-Transport (Streamable HTTP), optional über `MCP_HTTP_PORT`.** Ohne die Variable spricht der Server wie bisher stdio; ist sie gesetzt, lauscht er zusätzlich auf `/mcp` und beantwortet `/health`. Gebunden wird standardmäßig an `127.0.0.1`: Erreichbarkeit von außen muss über `MCP_HTTP_HOST` ausdrücklich gewollt sein, und der Server warnt dann auf stderr. Der Modus arbeitet **zustandslos**: jede Anfrage erhält eine eigene Serverinstanz (`createServer()`), Datenbank und vorbereitete Statements bleiben geteilt. Sitzungen brächten diesem Server nichts, weil er keine Benachrichtigungen schiebt und nichts fortzusetzen hat; über 1200 Anfragen gemessen bleibt der Speicher stabil. Gesetzt werden CORS-Kopfzeilen (`access-control-allow-origin: *`, Sitzungs-ID als `expose-headers`) und `OPTIONS` wird beantwortet, damit auch browserbasierte Clients den Endpunkt nutzen können; die Origin-Prüfung bleibt davon unberührt und weist fremde Herkunft weiterhin mit 403 ab. Damit ist der Server für Clients nutzbar, die keinen Kindprozess starten können. Voraussetzung fürs Hosting sind TLS und Zugriffsschutz davor; beides bringt der Server nicht mit.
- `docs/anweisungen/claude-desktop.txt`: fertiger Text für *Einstellungen › Anweisungen für Claude* in Claude Desktop. Ob ein Werkzeug aufgerufen und wie sein Ergebnis wiedergegeben wird, entscheidet der Client; der Server kann es nur anbieten. Die Anweisungen adressieren die Punkte, an denen Modelle im Ursprungs-Repo messbar danebenlagen: geglättete Zitate, selbst gezählte statt abgelesene Zahlen, übergangene Vorbehalte, angeschnittene mehrversige Zitate. Auf die Datenlage dieses Repos zugeschnitten: vier Übersetzungen mit eigenen Trefferzahlen, Klammer-Einschübe nur in der Menge-Übersetzung (137 Verse), keine Fußnotenziffern. Im README verlinkt.
- `bun run test` (`scripts/test-golden.ts`): Regressionstest für die Serverkorrektheit. Startet einen frischen Serverprozess, fährt 15 Werkzeugaufrufe über stdio und prüft 58 Zusicherungen: Grenzwertmeldungen, Werkzeug-Annotationen, Buchauflösung, Klammerhinweise, Comma Johanneum, TAGNT-Quellenkonflikt, hebräische Morphologie, Treffer- gegen Vorkommenszahlen, `verse_einzeln`. Braucht eine gebaute Datenbank und läuft deshalb nicht in der CI; lokal nach jeder Änderung an `server.ts` aufzurufen.
- `bible_lookup`, `bible_crossrefs` und `bible_search` weisen auf Wörter in eckigen Klammern hin, sobald welche in der Ausgabe stehen. Menge setzt erklärende Einschübe so (137 Verse; die drei anderen Übersetzungen verwenden keine). Die Klammern gehören zum Wortlaut der Übersetzung: ohne sie liest sich ein Einschub der Ausgabe wie gewöhnlicher Text. Gemessen im Ursprungs-Repo am 25.07.2026 an einem Vers mit solchen Klammern: ein Client, der das Werkzeug nachweislich aufgerufen hatte, entfernte sie beim Zitieren. Der Hinweis nennt bewusst kein Beispielwort.

### Behoben

- `bible_original`, `bible_crossrefs` und `bible_compare` wiesen Kapitel- und Versnummern außerhalb des gültigen Bereichs mit „`'verse' must be a positive integer`" zurück, einer Bedingung, die die Eingabe erfüllt. Bei `verse=999` ist 999 sehr wohl eine positive Ganzzahl; verletzt war die Obergrenze 200. Sechs Meldungen in drei Handlern nennen jetzt die tatsächliche Grenze (`must be an integer between 1 and 200` bzw. `… 1 and 150`), wie `bible_lookup` es bereits tat. Grenzen und Meldungstexte liegen dafür in gemeinsamen Konstanten (`MAX_CHAPTER`, `MAX_VERSE`, `chapterOutOfRange`, `verseOutOfRange`), damit sie nicht erneut auseinanderlaufen. Belegt gegen einen Golden-Snapshot aus 20 stdio-Aufrufen: außer den neun beabsichtigten Meldungen und den sechs Annotationsblöcken ist jede Antwort byteweise unverändert.

## [0.2.1] - 2026-07-25

### Geändert

- Repository-Wurzel aufgeräumt: die neun Datenaufbau-Skripte und ihre Helfer (`schema.ts`, `atomic-db.ts`, `provenance.ts`, `aliases.ts`) liegen jetzt unter `scripts/`. Im Root bleiben nur `server.ts` und `translations.ts`. Der Schnitt folgt der Laufzeitgrenze: `server.ts` importiert allein `translations.ts`, alles unter `scripts/` läuft ausschließlich beim Datenaufbau. Für Nutzer ändert sich nichts an den Kommandos.
- Dokumentation und Fehlermeldungen des Servers nennen die `package.json`-Aliase (`bun run download:byz`) statt der Dateipfade. Die Aliase gab es schon; sie bleiben gültig, wo auch immer die Dateien liegen. `bun run download` akzeptiert weiterhin ein Übersetzungskürzel (`bun run download SCH`).

## [0.2.0] - 2026-07-25

### Hinzugefügt

- `bible_compare`: Abgleich der TAGNT-Variantennotizen gegen die geladenen Editionstexte. Neue Felder in `bezeugung`: `in_dieser_db` (welche Edition welche Form tatsächlich liest, aus `original_words`), `abgleich` (Widersprüche zwischen Notiz und Editionstext) und `lesehinweis`. TAGNTs „Byz" ist nicht deckungsgleich mit Robinson-Pierpont 2005; über 400 zufällige NT-Verse gemessen weichen beide in rund 11 % der Verse voneinander ab (etwa 1Tim 3,16 `TR: ἀνελήφθη`, obwohl der Mehrheitstext ebenso liest, und Mk 14,46 `Byz: ἐπέβαλαν` gegen tatsächliches `επεβαλον`). Rein additiv: bestehende Felder bleiben unverändert.

- `bible_compare`: Widersprüche zwischen TAGNT-Notiz und Editionstext erscheinen jetzt zusätzlich als `warnung` und `quellenkonflikte` **oben** in der Antwort. Bisher standen sie nur in `bezeugung.abweichend[].abgleich`, vier Ebenen tief, und wer die Bezeugung als optionales Detail behandelt, übersah sie (beobachtet an Mk 14,46). Die Felder erscheinen nur, wenn es tatsächlich einen Widerspruch gibt.
- `bible_crossrefs`: Mehrversige Verweise tragen zusätzlich `verse_einzeln`: ein Eintrag je Vers mit `nr` und `text`, ohne die im String eingebetteten Versnummern. Das bisherige Feld `text` bleibt unverändert. Ein `lesehinweis` mahnt, beim Zitieren keine Verse anzuschneiden (beobachtet: Joh 11,25-26 ohne Redeeinleitung und Schlussfrage wiedergegeben).
- `bible_search`: Neues Feld `vorkommen_gesamt`: `treffer` zählt Verse, ein Vers kann den Suchbegriff aber mehrfach enthalten (1Joh 2,15 trägt drei Formen von `lieb*`). Der `hinweis` benennt den Unterschied jetzt ausdrücklich. Wird ab 1000 Treffern übersprungen, weil die Zählung alle passenden Verse liest.
- `bible_original`: Der `hinweis` jeder Edition beschreibt nun die Schreibweise des Feldes `wort`: Byzantinisch und TR liegen unakzentuiert vor, der WLC führt Vokal- und Akzentzeichen sowie den OSHB-Morphemtrenner `/`. Ohne diese Angabe ergänzen Modelle beim Zitieren Akzente, die nie in den Daten standen, oder entfernen vorhandene Zeichen.

### Geändert

- `bible_lookup`: Die Tool-Beschreibung verweist jetzt ausdrücklich auf Existenz- und Kanonfragen („gibt es dieses Buch?", unbekannte oder verdächtig aussehende Referenzen). Bisher warb sie nur mit „für alle Bibelzitate": Fragen nach einem nicht existierenden Buch fielen nicht darunter und wurden ohne Werkzeugaufruf beantwortet.
- Fehlermeldungen zu unbekannten Büchern beginnen mit dem Sachverhalt statt mit `Error:`; das `isError`-Flag bleibt unverändert. Rein redaktionell: die ursprüngliche Begründung, `Error:`-Meldungen würden von Konsumenten verworfen, hielt der Nachprüfung nicht stand.
- Unbekannte Buchnamen: Alle fünf Werkzeuge melden den Fehler jetzt einheitlich über `bookNotFound`. Die Meldung nennt das nächstliegende bekannte Buch (`Am nächsten kommt "Hesekiel" — falls das gemeint war, damit erneut abfragen.` für `Hesekiel-Zusatz` oder den Tippfehler `Hesekil`) und weist apokryphe/deuterokanonische Titel — Sirach, Tobit, Judit, Weisheit, Baruch, Makkabäer, Zusätze zu Daniel und Ester — ausdrücklich als nicht enthalten aus, statt ein ähnlich klingendes Buch des Kanons vorzuschlagen.
- `bible_compare`: Der abschließende `hinweis` nennt kein Beispiel für eine Variantenart mehr. Das frühere „(z. B. bewegliches Ny)" wurde als Etikett aufgegriffen und auf einen unpassenden Fall geklebt: `ἐπέβαλον`/`ἐπέβαλαν` in Mk 14,46 als bewegliches Ny bezeichnet, obwohl es um thematische gegen Alpha-Aoristendung geht. Der Hinweis verweist jetzt auf die klassifizierenden Felder in `bezeugung`.
- `bible_compare`: Die Einträge in `quellenkonflikte` nennen zuerst, was die Edition liest, und erst danach die widersprechende TAGNT-Notiz. In der umgekehrten Reihenfolge las sich der Eintrag wie eine Randbemerkung zur Datenqualität und entfiel beim Wiedergeben.
- `bible_search` markiert Fundstellen im Verstext jetzt mit `⟦…⟧` statt `«…»`. Die alten Marker kollidierten mit den Anführungszeichen der Übersetzungen selbst (Menge 8339 Verse, Schlachter 887), und weil dort `»Zitat«` herum verschachtelt wird, war ein schließendes `«` von einem Marker nicht zu unterscheiden. Wer die Marker auswertet, muss das Zeichen anpassen.
- `server.ts` neu gegliedert, **ohne jede Verhaltensänderung**: 22 Abschnittsbanner statt 7 über die ganze Datei, acht Deklarationen an ihren fachlichen Ort verschoben (`resolveEdition` zu den Editionen, `getBookDisplayName` vor seine Aufrufer, `editDistance` neben `suggestBook`, `formatVerseReference` und `requireTranslation` zu den `bible_lookup`-Helfern, `findStoredLemma` zu den Konkordanz-Helfern, `buildFtsQuery` zu den Such-Helfern, die Suchkonstanten hinter die Statements, die sie ergänzen), elf überlange Morphologie-Tabellen umbrochen (längste Zeile 215 → 163 Zeichen) und JSDoc entfernt, das nur die Signatur nachsprach. Die Helferblöcke stehen jetzt in derselben Reihenfolge wie die Handler weiter unten. Belegt gegen einen Golden-Snapshot aus 79 stdio-Aufrufen (alle sechs Werkzeuge, alle vier Übersetzungen, drei Prompts, 27 Fehlerpfade): Antworten vorher und nachher byteweise identisch.

### Behoben

- `download.ts` normalisiert Buchnamen der Quelle, denen das Leerzeichen vor der Klammer fehlt (`2. Mose(Exodus)` → `2. Mose (Exodus)`). Luther 1912 als Standardquelle für Anzeigenamen ist nicht betroffen; ein mit einer anderen Übersetzung begonnener Lauf schreibt die Namen jedoch selbst. Buchnamen erscheinen in jeder Konkordanz-, Such- und Querverweisausgabe.
- Griechische Formen wurden für den Editionsabgleich samt Koronis `᾽` (U+1FBD) verglichen, sodass `ἀλλ᾽` nie auf das gespeicherte `αλλ` traf; jetzt werden nur Buchstaben verglichen. Reine Elisionsunterschiede (`ἀλλ᾽`/`ἀλλά`) erscheinen in `in_dieser_db`, lösen aber keine Widerspruchsmeldung mehr aus.

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
