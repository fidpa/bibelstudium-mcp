# Entscheidungen und Messungen

Warum der Code so aussieht, wie er aussieht. Diese Datei nimmt auf, was eine
Begründung braucht, aber an keiner einzelnen Codestelle steht: gemessene
Befunde, verworfene Alternativen, Erfahrungen mit Clients und fremden Quellen.

Abgrenzung zu den anderen drei Stellen:

| Wo | Was |
|----|-----|
| Code-Kommentar | Warum genau diese Stelle so ist. Der erste Ort, immer. |
| `CHANGELOG.md` | Was sich je Fassung geändert hat, knapp, für Nutzende. |
| `README.md` | Wie man den Server benutzt. |
| Diese Datei | Die Begründung hinter einer Entscheidung, wenn sie länger ist als der Code, den sie erklärt, oder mehrere Stellen betrifft. |

**Wie zu lesen:** Gegliedert ist nach Thema, nicht nach Datum, weil zusammengehörende
Entscheidungen sonst über Monate auseinanderliegen. Jeder Eintrag nennt das Datum
seiner Messung. Wo etwas nicht gemessen, sondern vermutet oder geschätzt ist,
steht das ausdrücklich dabei; „nicht belegt" ist eine Aussage und kein
Platzhalter.

## Inhalt

**[Transport und Protokoll](#transport-und-protokoll)**
- [`GET /mcp` antwortet 405, weil die 200 eine Wiederverbindungsschleife fütterte](#get-mcp-antwortet-405-weil-die-200-eine-wiederverbindungsschleife-fütterte)
- [Die Origin-Prüfung steht vorn, und jeder Pfad nennt seine eigenen Methoden](#die-origin-prüfung-steht-vorn-und-jeder-pfad-nennt-seine-eigenen-methoden)
- [Ein Aufruferfehler ist kein interner Fehler, und `McpError` ist der falsche Weg dorthin](#ein-aufruferfehler-ist-kein-interner-fehler-und-mcperror-ist-der-falsche-weg-dorthin)
- [Protokollversionen werden protokolliert, statt auf ein Datum zu warten](#protokollversionen-werden-protokolliert-statt-auf-ein-datum-zu-warten)
- [Für Clients beider Ären bleiben wir als alter Server erkennbar](#für-clients-beider-ären-bleiben-wir-als-alter-server-erkennbar)

**[Was die Werkzeuge ausliefern](#was-die-werkzeuge-ausliefern)**
- [Ausgabeschemata von Hand, und warum `required` die teuerste Zeile ist](#ausgabeschemata-von-hand-und-warum-required-die-teuerste-zeile-ist)
- [Ressourcen liegen in Vorlagen, weil die Liste sonst der Katalog wäre](#ressourcen-liegen-in-vorlagen-weil-die-liste-sonst-der-katalog-wäre)
- [Der Anmerkungsapparat einer Ausgabe ist ein eigenes Feld](#der-anmerkungsapparat-einer-ausgabe-ist-ein-eigenes-feld)
- [Eine Grenze, die eine Zusage einhält, gehört an die Ausgabe und nicht an den Server](#eine-grenze-die-eine-zusage-einhält-gehört-an-die-ausgabe-und-nicht-an-den-server)
- [Eine Kürzung, die der Server selbst vornimmt, muss in der Antwort stehen](#eine-kürzung-die-der-server-selbst-vornimmt-muss-in-der-antwort-stehen)
- [Die Voreinstellung gehört dem Endpunkt, die Konstante gehört jedem Klon](#die-voreinstellung-gehört-dem-endpunkt-die-konstante-gehört-jedem-klon)
- [Dieselbe Stellenangabe trifft nicht in jeder Ausgabe denselben Text](#dieselbe-stellenangabe-trifft-nicht-in-jeder-ausgabe-denselben-text)

**[Fehlermeldungen und Argumentprüfung](#fehlermeldungen-und-argumentprüfung)**
- [Eine Meldung nennt die verletzte Bedingung, nicht irgendeine](#eine-meldung-nennt-die-verletzte-bedingung-nicht-irgendeine)

**[Prüfen und Messen](#prüfen-und-messen)**
- [Zwei Prüfarten für die Schemata, weil keine allein reicht](#zwei-prüfarten-für-die-schemata-weil-keine-allein-reicht)

Die Begründungen zum **Zuschnitt der Module** (warum `server.ts` in zehn
Abschnitte und sechs Handler-Dateien zerfällt, was jeder Schnitt gekostet hat)
stehen nicht hier: Sie betreffen die Anordnung des Codes und nicht sein
Verhalten.

---

# Transport und Protokoll

## `GET /mcp` antwortet 405, weil die 200 eine Wiederverbindungsschleife fütterte

*Gemessen 03.08.2026 am laufenden Dienst.*

Vom 1. August an zeigte die Nutzungsansicht ein Plateau, das kein Nutzungsprofil
ist: über elf Stunden am Stück eine gleichbleibende Rate, fast ausschließlich
Status 200. Der naheliegende Verdacht war ein Bot, der den authlosen Endpunkt
gefunden hat, und die naheliegende Antwort eine Sperre. Beides war falsch.

### Was gemessen wurde

| Größe | Wert |
|-------|------|
| Anfragerate, laufend | 56 Anfragen in 60 s, also 0,93 je Sekunde |
| Methoden binnen 24 h | **GET 41 430**, POST 389, DELETE 2 |
| Status 404 | 22 von 106 466 |
| Von der Ratenbegrenzung abgewehrt | 7 von 41 820 |
| Mittlere Antwortgröße | 797 Byte |
| Vollständige Handschläge | 149 auf 106 466 Anfragen |

Drei Schlüsse daraus, jeder für sich tragend. Es ist **kein Pfadsucher**: 22
Antworten mit 404 sind das Gegenteil davon. Es wird **nichts abgerufen**: Die
mittlere Antwort ist kleiner als ein einzelner Vers (1245 Byte); wäre es
`tools/list` gewesen, hätten bei 15 266 Byte je Antwort rund 650 MB fließen
müssen statt der gemessenen 34 MB. Und **99,1 Prozent sind GET**, ein Kanal, über
den dieser Server nie etwas ausliefert.

### Die Ursache stand im eigenen Code

Die Spezifikation lässt auf diesen GET genau zwei Antworten zu, einen Strom mit
`text/event-stream` oder 405. Die 200 mit leerem Rumpf ist keine von beiden, und
der Aufrufer kann sie nur als eröffneten Strom lesen. Im SDK-Client ist
`response.ok` dann wahr, er übergibt an `_handleSseStream`, der Rumpf endet
sofort, und die Wiederverbindung greift mit `initialReconnectionDelay: 1000`.

`maxRetries: 2` fängt das nicht ab, und das ist der Teil, der beim Lesen des
Codes nicht ins Auge springt: Der Zähler gilt **gescheiterten** Verbindungen.
Eine 200 gilt als geglückt und setzt ihn zurück. Damit läuft die Schleife ohne
Ende, im Takt von 1000 ms zuzüglich Umlaufzeit. Gemessen 0,93 Anfragen je
Sekunde, was auf die Nachkommastelle zusammenfällt.

Auf 405 kehrt derselbe Client wortlos zurück; der Kommentar an der Stelle nennt
es „an expected case that should not trigger an error", und der Aufrufer arbeitet
mit POST weiter. Der Kanal ist ohnehin nur eine Kann-Bestimmung.

`Allow: POST, OPTIONS` gehört zwingend dazu, RFC 9110 verlangt den Kopf bei 405.
Er ist zugleich die eigentliche Auskunft an den Aufrufer: nur POST, absichtlich
so.

### Verworfen: den GET an den Transport durchreichen

Naheliegend, weil `handleGetRequest()` im SDK die formtreue Antwort selbst
kennte. Sie ist hier die falsche: Der Transport liefert einen **offengehaltenen**
Strom (`keep-alive`, `no-transform`). Das ist genau der Verbindungshalter, der am
25.07.2026 gemessen und mit diesem Zweig abgestellt wurde (30 gleichzeitige GET
banden 30 Dateideskriptoren samt je einer Serverinstanz, 120 s je Verbindung).
Für einen authlosen Endpunkt wäre das ein Rückschritt, und eine Ratenbegrenzung
davor greift bei offenen Verbindungen schlecht.

### Verworfen: sperren

Der Verkehr kam aus Anschlussnetzen eines Endkundenanbieters, nicht aus einem
Rechenzentrum, mit Lücken im Tagesverlauf, wie sie ein Gerät erzeugt, das an- und
ausgeschaltet wird. Eine Sperre hätte einen **rechtmäßigen Client** ausgesperrt
und die Ursache unberührt gelassen. Das ist die eigentliche Lehre des Vorgangs:
Der Befund sah nach Angriff aus, und die Maßnahme gegen Angriffe hätte den
Schaden vergrößert. Diagnose vor Therapie, auch wenn die Therapie billig ist.

Nebenbefund: Von 41 820 Anfragen hat die Ratenbegrenzung **7** abgewehrt. Sie
wirkt gegen Stöße, wie beim Setzen nachgewiesen, aber das reale Aufkommen lag
stets unter ihrer Schwelle. Für dieses Plateau war sie nie zuständig.

### Warum die frühere Begründung fiel

An der Stelle stand, 200 sei die gemessene Angleichung an den einzigen
nachweislich funktionierenden fremden Connector. Das war eine Beobachtung an
fremdem Gerät (n=1) und nie ein Beleg, dass claude.ai die 200 **braucht**; die
Fehlersuche-Anleitung von Claude nennt 405 beim Erreichbarkeitstest ausdrücklich
als unbedenklich. Was fehlte, war der Preis der Vorsicht, und der ist jetzt
beziffert: rund 40 000 Anfragen am Tag ohne jede Nutzlast.

---

## Die Origin-Prüfung steht vorn, und jeder Pfad nennt seine eigenen Methoden

*Gemessen 03.08.2026, Nachlese zum 405-Fund desselben Tages.*

Weil jener Fehler dort saß, wo eigener Code eine Anfrage abfängt, **bevor** das
SDK sie sieht, wurde diese Zone vollständig durchgemessen. Sie umfasst sechs
Stellen: `OPTIONS`, `/health`, Fremdpfade, Origin-Prüfung, die
Methodenbehandlung und `noteProtocolVersion`.

Die Spec-Konformität selbst war in Ordnung: Vorschrift für Vorschrift geprüft
(Benachrichtigung 202, fehlender `Accept` 406, fehlerhaftes JSON 400, unbekannte
Protokollrevision 400, unbekannte Pfade 404) stimmte alles, und das meiste davon
leistet das SDK. Drei Abweichungen lagen ausschließlich im eigenen Vorfeld.

### Die Prüfung galt nicht für den Pfad, den ein Fremder zuerst probiert

`/health` wurde beantwortet, bevor der Origin geprüft war. Damit konnte eine
beliebige Webseite per JavaScript erfahren, dass auf einem lokalen Port dieser
Server läuft, und seinen Zustand samt Störungsgrund auslesen. Die Spezifikation
verlangt die Prüfung „on all incoming connections"; sie stand hinter zwei
Weichen. Sie ist deshalb an den Anfang des Handlers gewandert und erfasst damit
in einem Schritt `/health`, die Vorabanfrage und unbekannte Pfade.

**Die Lage ist dabei beinahe invertiert, und das ist der Teil, der für künftige
Entscheidungen zählt.** Am öffentlichen, authlosen Endpunkt schützt die
Origin-Prüfung fast nichts: Es gibt keine Anmeldung, die eine fremde Seite im
Namen eines Nutzers missbrauchen könnte, und der Dienst steht ohnehin jedem
offen. Dort ist sie überwiegend ein Ausfallrisiko, denn ein Broker, der eines
Tages einen `Origin` schickte, liefe in 403, ohne dass irgendein Log es sagte.
Ihr Wert liegt beim lokalen Betrieb, den `MCP_HTTP_PORT` jederzeit erlaubt, und
genau dort hatte sie ihr Loch. Sie saß am schwächeren Ende scharf und am
stärkeren durchlässig. Die Antwort auf beides ist verschieden: vorn die Prüfung
schließen, hinten die erlaubten Herkünfte im Betrieb vorsorglich eintragen.

### Eine Methodenweiche, weil ein Pfad nicht drei Auskünfte geben darf

`access-control-allow-methods` stand global in `CORS_HEADERS` und nannte
`GET, POST, DELETE, OPTIONS`. Es genügte nicht, das auf `POST, OPTIONS` zu
setzen, denn gemessen antwortete derselbe Pfad dreifach verschieden:

| Anfrage | vorher |
|---|---|
| `GET /mcp` | 405, `Allow: POST, OPTIONS` (eigener Code) |
| `HEAD`, `PUT`, `PATCH` | 405, `Allow: GET, POST, DELETE` (SDK) |
| `DELETE /mcp` | **200** (SDK; `validateSession` prüft im zustandslosen Betrieb nichts) |

`withCors` überschreibt nur die `access-control`-Felder, der fremde `Allow`
blieb also stehen. Wer bloß die Vorabanfrage richtiggestellt hätte, hätte eine
Falschaussage gegen die nächste getauscht, und die Prüfung wäre grün gewesen.

Jetzt entscheidet eine Weiche im eigenen Handler: alles außer `POST` und
`OPTIONS` bekommt 405 mit `Allow: POST, OPTIONS`. Die Methodenlisten stehen als
`METHODS_MCP` und `METHODS_HEALTH` an genau einer Stelle und speisen beide
Kopfzeilen, damit sie nicht wieder auseinanderlaufen können. `withCors` bekam
dafür einen Pflichtparameter ohne Vorgabewert: Ein Default hätte genau den
Fehler konserviert, den die Aufteilung behebt.

**Damit ist die frühere Entscheidung zu `DELETE` umgekehrt.** Sie lautete, es
beim 200 des SDK zu belassen, weil die Spezifikation dort nur ein MAY kennt
(`webStandardStreamableHttp.js:565 ff.`: im zustandslosen Betrieb entfällt die
Sitzungsprüfung, `close()` läuft, 200). Diese Abwägung ist nicht widerlegt,
sondern ihre Prämisse ist entfallen: Sie ging davon aus, dass keine Kopfzeile
etwas Gegenteiliges behauptet, und seit `access-control-allow-methods` je Pfad
gesetzt wird, tut genau das eine. Ein Server ohne Sitzung hat nichts zu beenden,
und 405 ist ausdrücklich erlaubt.

Dazu, klein und derselben Art: `/health` nahm jede Methode an und antwortete mit
200, ein `DELETE` eingeschlossen. Jetzt `GET`, `HEAD` und `OPTIONS`, sonst 405.

### Was das kostet und was es nicht kostet

`access-control-allow-origin: *` bleibt unverändert. Das ist der Teil des
Antwortprofils, der als von claude.ai akzeptiert gemessen ist, und er wird nicht
wegen einer Aufräumarbeit angefasst.

Die Website musste nicht nachgezogen werden, obwohl `einrichten.html` die
Abfrage von `/health` ausdrücklich zusagt. Der Abschnitt heißt „Für Programme",
und Programme schicken keinen `Origin`; ebenso wenig ein Browser, der die
Adresse direkt aufruft. Betroffen ist allein `fetch()` aus fremder Seite, also
genau der Fall, den die Prüfung schließen soll. Geprüft, nicht angenommen.

### Der eigentliche Ertrag ist der Test

Bis dahin prüften die Golden-Tests alles, was der Server *sagt*, und nichts
davon, wie er *antwortet*. Der Guard in `lint.yml` deckt eine einzelne Frage ab
(`bible_setup` darf im HTTP-Modus nicht erscheinen), nicht das
Transportverhalten. Beide Funde dieses Tages wären in einem solchen Test
aufgeschlagen.

`tests/test-http.ts` schließt das: Statuscodes je Methode, die **Werte** der
`Allow`-Kopfzeilen, Origin in beiden Richtungen, Vorabanfrage, Zustandsauskunft,
unbekannte Pfade. Er ist datenunabhängig und braucht deshalb, anders als die
Golden-Tests, keine gebaute Datenbank; die einzige datenabhängige Zusicherung
lautet „200 oder 503". Dass er misst und nicht durchwinkt, ist geprüft: Mit
absichtlich falscher Methodenliste fällt er von 47 auf 40 bestandene Prüfungen.

---

## Ein Aufruferfehler ist kein interner Fehler, und `McpError` ist der falsche Weg dorthin

*Gemessen 02.08.2026 gegen frische Prozesse, stdio und HTTP.*

Bis 0.5.10 verließ jede Ablehnung, die über den JSON-RPC-Kanal ging, den Server
als `-32603 InternalError`: unbekanntes Werkzeug, unbekannter Prompt, fehlendes
Prompt-Argument, jede fehlerhafte Ressourcen-URI. In beiden Transporten gleich.
Die Ursache war kein Versehen an einer Stelle, sondern die Voreinstellung des
SDK: `protocol.js:397` reicht das Feld `code` eines geworfenen Fehlers durch,
wenn es eine ganze Zahl ist, und fällt sonst auf `InternalError` zurück. Ein
nacktes `new Error` bekommt also den Code für „der Server hat einen Defekt", auch
wenn die Anfrage der Grund war.

### Was die Spezifikation sagt, und warum sie dreimal etwas anderes sagt

- **Prompts:** „Invalid prompt name: `-32602`, Missing required arguments:
  `-32602`, Internal errors: `-32603`" (server/prompts). Ein **SHOULD**, wörtlich
  auf zwei unserer Fälle gemünzt. Das ist der härteste Punkt.
- **Werkzeuge:** kein SHOULD, aber „Unknown tools" steht unter den
  Protokollfehlern und das Beispiel lautet
  `{"code": -32602, "message": "Unknown tool: invalid_tool_name"}`
  (server/tools).
- **Ressourcen:** „Resource not found: `-32002`, Internal errors: `-32603`"
  (server/resources, SHOULD in 2025-06-18 **und** 2025-11-25). Die
  Draft-Revision zieht das zurück: „`-32002` … replaced by `-32602`", und
  Implementierungen jener Fassung **dürfen** `-32002` nicht mehr senden.

Gewählt ist überall `-32602`. Für Ressourcen ist das eine Abwägung, keine
Ableitung: `-32002` passt auf die zwei Fälle „nicht gefunden" und auf keinen der
dreizehn Formfehler, es ist in der kommenden Revision untersagt, und das SDK,
gegen das dieser Server läuft, antwortet auf eine unbekannte Ressource selbst
mit `-32602` (`server/mcp.js:393`). Falsch war in jeder dieser Lesarten allein
das bisherige `-32603`. Keiner der beiden Codes liegt im reservierten Bereich
`-32020` bis `-32099`, die Festlegung vom 28.07.2026 bleibt also unberührt.

### `McpError` hätte die Meldungstexte beschädigt

Der naheliegende Handgriff wäre `throw new McpError(ErrorCode.InvalidParams, …)`
gewesen, wie es `server/mcp.js` tut. Gemessen gegen einen Probe-Server auf
demselben SDK:

| geworfen | am Draht |
|---|---|
| `new McpError(-32602, "Die Meldung.")` | `{"code":-32602,"message":"MCP error -32602: Die Meldung."}` |
| `Object.assign(new Error("Die Meldung."), { code: -32602 })` | `{"code":-32602,"message":"Die Meldung."}` |

Der Konstruktor setzt `super("MCP error <code>: " + message)`
(`types.js:2031`), und der empfangende 1.x-Client stellt beim Wiederaufbau ein
zweites Präfix voran (`protocol.js:459`). Diese Meldungen sind aber zeichengleich
mit denen der Werkzeuge, absichtlich und getestet. Deshalb `rpcError()` in
`werkzeug-helfer.ts`, nicht `McpError`. Die exakten Meldungsvergleiche im
Golden-Test sind der Schutz davor, dass jemand später doch umstellt.

### Was `-32603` behält

`requireData()`. Eine Instanz ohne Datenbank ist ein Zustand des Servers, nicht
ein Fehler des Aufrufers, und das ist die einzige verbliebene Stelle. Der
Golden-Test startet dafür einen zweiten Server mit `BIBLE_DB_PATH` auf eine
nicht vorhandene Datei; ohne diese Zusicherung wäre die Ausnahme genau das, was
eine spätere Sammeländerung mitnimmt.

Der Werkzeugpfad bleibt ebenfalls, wie er war: Ein unbekanntes Buch oder ein
fehlendes Argument ist weiter ein Ergebnis mit `isError` und Prosa. Ein
JSON-RPC-Fehler erreicht das Modell nicht als Aufgabe, sondern als Abbruch, und
diese Meldungen sind dafür geschrieben, gelesen zu werden. Sechs Zusicherungen
halten das fest.

Nachgezählt wurde dabei, ob ein werfender Helfer auch im Werkzeugpfad hängt:
Alle `segment*`-Helfer und `requireBookLength` werden nur aus `versesPayload`
und `grundtextPayload` gerufen, beide nur aus `handleReadResource`. Geteilt sind
allein `lookupPayload` und `originalPayload`, und die werfen nicht, sie liefern
`null` beziehungsweise `{ error }`.

### Wirkung, und der Preis bei den Ressourcen

Der Code ist im Client sichtbar, nicht nur im Protokoll. Vor dem Ausrollen
lieferte ein Abruf von `bible://kapitel/LUT/Gibtsnicht/1` über einen
eingerichteten Connector die Zeile `MCP error -32603: "Gibtsnicht" ist kein Buch
dieser Bibel-Datenbank. …`, also Präfix samt Nummer als Text.

**Nach dem Ausrollen von 0.5.11 kommt diese Meldung in Claude Code nicht mehr
an.** Derselbe Abruf gegen denselben Endpunkt antwortet jetzt mit einer Meldung
des Clients: „Resource not found: … it may have been deleted or the URI is
stale. Re-run ListMcpResourcesTool to refresh." Der Client deutet `-32602` bei
`resources/read` offenbar als „nicht gefunden" und ersetzt den Servertext, samt
einem Rat, der hier nicht hilft. Gemessen an zwei Fehlerarten (unbekanntes Buch,
zu wenige Segmente); ein gültiger Abruf funktioniert unverändert, Prompts und
Werkzeuge sind nicht betroffen. Der einzige geänderte Faktor ist der Code, die
Texte sind zeichengleich geblieben.

Das kehrt die Bilanz für die Ressourcen um: Der Server ist normtreuer und seine
sorgfältig gebauten Meldungen (Kanonumfang, nächstliegendes Buch, benannte
Grenze) erreichen in diesem Client niemanden mehr. Drei Auswege, keiner bisher
gewählt: bei `-32602` bleiben und den Verlust hinnehmen; für Ressourcen `-32002`
versuchen, den Code der bedienten Revision, wobei erst zu messen wäre, ob dieser
Client ihn durchreicht oder ebenso schluckt; oder für Ressourcen zu `-32603`
zurück, was die Meldung wiederbrächte und den Normverstoß auch. Die Messung
kostet einen weiteren Rollout, weil der Connector den ausgerollten Dienst
spricht und nicht den Arbeitsbaum.

Ob ein Client den Code darüber hinaus für **Wiederholungen** auswertet, ist
weiterhin **nicht belegt**: Der SDK-Client kennt keine codeabhängige Wiederholung
(geprüft gegen `client/index.js` und `shared/protocol.js`), und Claude Desktop
sowie claude.ai sind von hier nicht messbar.

---

## Protokollversionen werden protokolliert, statt auf ein Datum zu warten

*Gemessen 28.07.2026 gegen frische HTTP-Server in vierzehn Fällen.*

Die MCP-Revision **2026-07-28** streicht `initialize` und die Sitzung. Version,
Identität und Capabilities eines Aufrufers stehen seither in jedem Request unter
`_meta.io.modelcontextprotocol/*`, gespiegelt in der Kopfzeile
`MCP-Protocol-Version`.

Zustandslos arbeitet dieser Server längst, das ist also nicht der Punkt. Der
Punkt ist die Kompatibilitätsmatrix der Spezifikation: Ein moderner Client
gegen einen Server, der nur das `initialize`-Verfahren kennt, scheitert
entweder, oder er bekommt eine ära-mehrdeutige Methode still unter alter
Semantik beantwortet. Letzteres ist hier möglich, weil der zustandslose
POST-Pfad Anfragen ohne Handschlag entgegennimmt: Nichts im Server würde es
bemerken.

Der Umstieg auf das v2-SDK ist kein Versionssprung, sondern ein Umbau (das
Paket ist in `@modelcontextprotocol/server`, `/core`, `/node` und weitere
zerfallen, jede Handler-Registrierung ändert sich). Der Auslöser dafür soll
deshalb ein gemessener Client sein, kein Kalendertag. `noteProtocolVersion()`
liefert diese Messung.

**Eine Zeile je Protokollversion**, nicht je Anfrage und nicht je Client: Der
HTTP-Endpunkt ist öffentlich und authlos, ein Log je Anfrage wäre ein
Zugriffsprotokoll, das niemand bestellt hat. Der Rumpf wird höchstens einmal je
Version gelesen; im eingeschwungenen Betrieb kostet die Funktion einen
Kopfzeilen- und einen Set-Zugriff.

Drei Härtungen, jede aus einem Fehler dieses Repositories oder aus einer
Messung an diesem Code:

- **Das Register ist gedeckelt** (20). Es wächst auf Fremdeingabe, und ein
  ungedeckeltes Register ist genau die Leckage, an der die frühere
  sitzungsbehaftete Fassung ausging.
- **Moderne Sichtungen teilen sich eine einzige Zeile**, statt nach
  Versionsnummer geschlüsselt zu werden. Der erste Entwurf tat Letzteres, und
  die Messung zeigte, was das wert ist: 30 erfundene Zukunftsdaten erzeugten 20
  Warnzeilen und verdrängten anschließend den echten `2026-07-28`-Client aus
  dem vollen Register. Ein authloser Aufrufer hätte damit genau die Zeile
  abschalten können, für die das Log existiert. Jetzt gilt: Die nützliche
  Aussage ist, **dass** ein moderner Aufrufer existiert, nicht welches Datum er
  nennt.
- **Nichts vom Aufrufer wird wörtlich übernommen.** Die Version wird gegen das
  Revisionsformat `YYYY-MM-DD` geprüft, nicht bloß gesäubert; passt sie nicht,
  steht dort „unbekannte Angabe". Der vom Client selbst gemeldete Name wird gar
  nicht erfasst. Beides folgt aus der Datenschutzerklärung dieses Endpunkts,
  die Betriebsereignisse „ohne Personenbezug" zusagt. Eine solche Zusage über
  Freitext fremder Software wird nur durch deren Wohlverhalten eingehalten; ein
  Wert, der vor dem Journal gegen ein Datumsmuster geprüft wird, hält sie
  konstruktiv. Das ist keine graue Theorie: Sowohl die Kopfzeile
  `Mcp-Protocol-Version` als auch `params.protocolVersion` sind frei wählbar,
  eine Adresse oder ein Name passt in beide.

Ein unlesbarer Rumpf darf die Anfrage nicht kippen; der Parse liegt in einem
`try`, dessen `catch` bewusst schweigt.

**Eine neue Logzeile ist hier keine reine Codeänderung.** Die
Datenschutzerklärung des öffentlichen Endpunkts zählt **abschließend** auf, was
protokolliert wird; sie stand bis zum 28.07.2026 bei „der Start des Programms
und Fehler beim Zugriff auf die Datenbank". Wer etwas hinzufügt, macht diesen
Satz unzutreffend und zieht ihn im selben Zug nach, und zwar **vor** dem
Ausrollen: Erst die Erklärung, dann der Dienst. Dazwischen kündigt sie etwas
an, das noch nicht geschieht, und das ist die harmlose Richtung.

Der Client-Name stand im ersten Entwurf in der Zeile, weil er einen echten
Nutzen hat: Er unterscheidet „claude.ai ist umgestiegen" von „jemand hat einen
Testclient auf den Endpunkt gehalten". Er ist trotzdem entfallen. Die Warnzeile
ist ein Anlass zum Hinsehen, kein Auftrag, und beim Hinsehen ist der
eingerichtete Connector die verlässlichere Auskunft als ein selbstberichteter
String. Der Nutzen ließ sich also anders herstellen, die Zusage der
Datenschutzerklärung nicht.

Zu den vierzehn Messfällen gehörten: Legacy-`initialize` ohne Kopfzeile, drei
Folgeanfragen ohne zweite Zeile, eine zweite Legacy-Version, moderne Anfrage mit
`_meta`, unparsbarer Rumpf mit anschließend funktionierendem Lookup, 30 moderne
Fantasieversionen, 30 Legacy-Fantasieversionen gegen den Deckel, sowie drei
Versuche, Personenbezogenes ins Journal zu bekommen (E-Mail-Adresse und Klarname
als Protokollversion in Kopfzeile und Rumpf, Klarname als Client-Name). Keiner
davon erschien im Log.

---

## Für Clients beider Ären bleiben wir als alter Server erkennbar

*Gemessen 28.07.2026 gegen einen frischen HTTP-Server.*

Auf eine moderne Anfrage antwortet das 1.x-SDK mit `400` und dem JSON-RPC-Code
**-32000** („Unsupported protocol version", dazu die Liste der unterstützten
Fassungen). Die neue Spezifikation verlangt für diesen Fall **-32022** und
erklärt den Bereich `-32000` bis `-32019` ausdrücklich zum Altbestand.

Das ist günstig, und zwar nicht zufällig: Ein Client, der beide Ären
beherrscht, prüft genau diesen Rumpf. Erkennt er darin einen modernen Fehler,
bleibt er modern und wiederholt mit einer anderen Version; erkennt er keinen,
fällt er auf `initialize` zurück. Unser -32000 ist kein moderner Fehler, der
Rückfall greift also.

Wer am HTTP-Fehlerpfad etwas ändert, darf hier keinen Code aus dem
reservierten Bereich `-32020` bis `-32099` erzeugen. Das erklärte den Server
zum modernen Server, und der Client hörte auf zurückzufallen.

---

# Was die Werkzeuge ausliefern

## Ausgabeschemata von Hand, und warum `required` die teuerste Zeile ist

*Gemessen 02.08.2026, `JSON.stringify` über stdio, SDK 1.29.0 (deklariert ist
`^1.25.1`).*

Die sieben Lesewerkzeuge deklarieren seit 0.5.8 ein `outputSchema` und liefern
`structuredContent`.

### Was das SDK erzwingt

- `client/index.js:500`: Deklariert ein Werkzeug ein `outputSchema` und liefert
  eine **erfolgreiche** Antwort kein `structuredContent`, wirft der Client
  `InvalidRequest`. Danach validiert er mit ajv und wirft bei Abweichung
  `InvalidParams`.
- `isError`-Antworten sind davon ausgenommen. Die Fehlerpfade dieses Servers
  bleiben deshalb reiner Text; sie sind Prosa, kein JSON.
- Die automatische serverseitige Prüfung sitzt in `server/mcp.js:186-207`, also
  in `McpServer`. Dieser Server benutzt die Low-Level-Klasse `Server`. **Hier
  validiert also nichts von selbst**, und ein Auseinanderlaufen von Schema und
  Antwort fällt allein im Golden-Test auf.

Daraus folgt die wichtigste Konsequenz: Ein Schema macht ein Werkzeug für einen
Client **strenger** als vorher. Was bisher eine Antwort mit einem fehlenden Feld
war, ist danach gar keine Antwort mehr. Jedes zu großzügig gesetzte `required`
ist damit eine künftige Ausfallursache, und die Auszählung der bedingten Felder
ist nicht Fleißarbeit, sondern der eigentliche Entwurf.

### Welche Felder bedingt sind

| Werkzeug | fehlt bedingt | Beleg |
|---|---|---|
| `bible_lookup` | `hinweis`, `fussnoten` | `hinweis` nur bei Klammerwörtern; `fussnoten` an 1134 von 31 171 Versen (3,6 %) |
| `bible_original` | `woerter[].strong` | 137 554 von 137 554 SBLGNT-Wörtern ohne Strong-Nummer, WLC 5951 ohne, byzantine 0 ohne |
| `bible_crossrefs` | `verse_einzeln`, `lesehinweis`, `hinweis` | `verse_einzeln` nur bei mehrversigem Ziel im selben Kapitel |
| `bible_concordance` | sechs Lexikonfelder, `hinweis` | `hinweis` bei gekürzter Liste **oder** vorhandenem `kjv_woerter`; beide Sätze können zusammen dastehen |
| `bible_search` | `vorkommen_gesamt`, `verteilung` | beide entfallen oberhalb `OCCURRENCE_SCAN_LIMIT`, gemessen an „der" mit 13 033 Treffern |
| `bible_compare` | `warnung`, `quellenkonflikte`, `bezeugung`, `bezeugung_fehlt` | `bezeugung` fehlt bei **9** NT-Versen ohne TAGNT-Zeile, darunter Joh 7,53; dort steht `bezeugung_fehlt` mit dem Grund |
| `bible_server_info` | `daten_stand`, `hinweis`, `kanon`, `zusatzdaten.strong_lexikon_sprache`, je Ausgabe `lizenz`/`nennung`/`verse_max` | `kanon` nur mit Datenbank, sonst wären es 0 Bücher; die Sprachangabe nur mit geladenem Lexikon; die drei Ausgabefelder fehlen bei einem Kürzel, das die Registry nicht kennt |

Die vier Werkzeuge mit einer Kopf-Stellenangabe (`bible_lookup`, `bible_original`,
`bible_crossrefs`, `bible_compare`) tragen sie doppelt: `reference` mit dem
Buchnamen der Datenbank und `kurzref` in der deutschen Kurzform. Der Grund ist
gemessen: Ein fremder Client schrieb `reference` beim Zitieren von Hand um und
erzeugte dabei Formen wie „2 Korinther8,9.13-15“ (06.08.2026). Alle 66 Kurzformen
sind zugleich Aliase, die Angabe geht also wieder als `book` hinein; in den
Trefferlisten steht sie bewusst nicht, dort wögen bis zu 200 zusätzliche
Zeichenketten je Antwort schwerer als der eine Handgriff.

Dazu drei Formen, die man beim Draufsehen übersieht: `vergleiche[]` hat zwei
Gestalten (`ergebnis` oder `unterschiede`), weshalb nur `paar` Pflicht ist;
`verteilung[]` trägt `buch` **oder** `kapitel`; `in_dieser_db` ist eine Abbildung
mit dynamischen Schlüsseln und braucht `additionalProperties`. Und
`quellen[].nennung` ist `string` **oder `null`**, weil `null` dort „Lizenz
verlangt keine Namensnennung" bedeutet und eine Aussage ist, kein fehlender Wert.

### Verworfen: Ableitung aus einem Zod-Schema

Zod liegt als transitive SDK-Abhängigkeit ohnehin im Baum (4.4.3), und
`z.toJSONSchema()` funktioniert. Trotzdem von Hand geschrieben, aus drei Gründen:

1. `z.toJSONSchema(s, {io: "output"})` setzt **`additionalProperties: false`**
   (gemessen). Ein später ergänztes Ausgabefeld würde damit bei einem
   validierenden Client brechen. Ergänzungen müssen hier unproblematisch bleiben.
   Vermeidbar wäre es nur mit durchgängigem `z.looseObject`, das niemand
   vergessen darf.
2. Zod würde zur zweiten direkten Laufzeit-Abhängigkeit; genau eine zu haben ist
   eine erklärte Designentscheidung.
3. Der Hauptvorteil trägt nicht weit: Auch mit Zod baut der Handler die Antwort
   weiter als Objektliteral. Zod erzwingt nur, dass sie passt, und leitet die
   Struktur nicht aus dem Code ab. Es bleibt Doppelpflege, nur mit einem zweiten
   Wächter.

### Was es kostet

`tools/list` wächst von **7201 auf 14 969 Zeichen** (+107,9 %), je Werkzeug
zwischen 399 (`bible_lookup`) und 2048 Zeichen (`bible_compare`). Eine Antwort
wächst um 63,4 bis 79,5 Prozent, weil die Nutzlast zweimal übertragen wird
(`bible_concordance` G26: 8484 → 13 877 Zeichen). Unter 100 Prozent bleibt der
Zuwachs, weil der Textblock eingerückt ist und `structuredContent` kompakt geht.

Die Spezifikation formuliert die Doppelung als SOLLTE. Weggelassen wird sie
trotzdem nicht: Ein Client, der `structuredContent` nicht anzeigt, bekäme sonst
eine leere Antwort.

### Was davon beim Modell ankommt

Erster Durchgang gegen den öffentlichen Endpunkt, nachdem die Schemata live
waren, zwei Clients, ein Durchgang je Frage. Die Nutzlast erreicht das Modell
**einmal**, nicht zweimal: Der Client zeigt die Struktur und verwirft den
Textblock (kompaktes JSON statt der eingerückten Fassung, die der Server als Text
baut). Der Aufschlag von 63 bis 80 Prozent bleibt damit auf der Leitung und
belastet das Kontextfenster nicht.

Drei Fragen waren nach Fällen ausgewählt, die vorher nachweislich schiefgingen,
und alle drei kamen richtig an: die Zahlentrennung (`treffer` 20 gegen
`vorkommen_gesamt` 22) samt einer abgeleiteten Zusatzangabe, die stimmte
(Joh 10,12 trägt tatsächlich drei Vorkommen); der Quellenkonflikt zu Mk 14,46
einschließlich des Satzes, dass der Editionstext maßgeblich ist, der am
25.07.2026 noch gefehlt hatte; die zehn Querverweise zu Joh 11,25 mit korrekten
Stimmenzahlen und den drei mehrversigen Zielen vollständig aus `verse_einzeln`.

**Nicht belegt ist, dass die Schemata das bewirkt haben.** Es gibt keinen
Vergleichslauf gegen 0.5.7, und n = 1 je Frage. Belegt ist nur: nichts wurde
schlechter, die kritischen Felder werden benutzt, die Doppelung kostet keinen
Kontext.

Zwei Abweichungen blieben, beide clientseitig, und stehen deshalb als Regeln in
`docs/anweisungen/claude-desktop.txt`: Die `nennung` wurde auf „OpenBible.info"
gekürzt, ohne die Adresse, die bei CC BY zur Bedingung gehört. Und die Variante
ἐπέβαλον/ἐπέβαλαν bekam mit „alternative Aorist-Endung" eine grammatische
Benennung, die in keinem Feld steht. Sie trifft hier zu, ist aber dasselbe Muster
wie das falsche „bewegliche Ny" vom 25.07.2026: eine Erscheinung benennen, die
die Daten nicht nennen.

### Was ausdrücklich nicht belegt ist

Ob Claude Desktop oder claude.ai `structuredContent` dem Modell überhaupt
zeigen, ist **nicht gemessen**, und ebenso wenig, ob eine `description`
**innerhalb** eines Ausgabeschemas beim Modell ankommt. Belegt ist nur die
Wirkung der `description` **am Werkzeug** (der Fall „Hesekiel-Zusatz",
25.07.2026); das ist eine andere Stelle im Protokoll. Dieser Server hat dieselbe
Annahme schon einmal teuer bezahlt: `instructions` und die Version stehen im
`initialize` und erreichen das Modell nicht, weshalb es `bible_server_info` gibt.

---

## Ressourcen liegen in Vorlagen, weil die Liste sonst der Katalog wäre

*Gemessen 02.08.2026 gegen einen frischen Server, Zeichenzahl des
`result`-Objekts.*

Die dritte MCP-Primitive ist die einzige, die dem **Nutzer** eine Geste gibt: ein
Kapitel anhängen, statt darauf zu hoffen, dass ein Werkzeugaufruf zustande kommt.
Der Fehlgriff, den das adressiert, ist gemessen (25.07.2026, „Hesekiel-Zusatz
1,1": kein Aufruf, Antwort aus dem Gedächtnis).

### Was die Liste kostet

`resources/list` geht bei jedem Sitzungsbeginn über die Leitung, und diese
Datenbank führt 31 102 Verse in 1190 Kapiteln.

| Methode | vorher | jetzt |
|---|---|---|
| `tools/list` | 14 969 | 15 171 |
| `prompts/list` | 972 | 972 |
| `resources/list` | 44 (Fehler −32601) | 939 (vier Einträge) |
| `resources/templates/list` | 44 (Fehler −32601) | 947 (drei Vorlagen) |

Verworfen wurde ein Eintrag je Buch, damit ein Client ohne Vorlagen-Anzeige
etwas sieht: 66 Einträge wären rund 13 000 Zeichen, fast eine Verdopplung
gegenüber `tools/list`. Und die Buch-Ressource wäre gar nicht auslieferbar, das
größte Buch misst **260 990 Zeichen** (Menge, Jeremia; zum Vergleich Elberfelder
Psalter 258 059). Ebenso verworfen: eine handverlesene Auswahl „häufig
gebrauchter" Kapitel. Welche das wären, ist eine editorische Wertung, und dieser
Server trifft keine Auswahl im Text.

### Größengrenzen, und wo sie herkommen

Anthropics Connector-Dokumentation nennt zwei Grenzen, beide laut Überschrift
für **Tool-Ergebnisse**: ~150 000 Zeichen für claude.ai und Desktop, 25 000
Token für Claude Code (`MAX_MCP_OUTPUT_TOKENS`). Sie auf Ressourcen anzuwenden
ist ein **Analogieschluss**, kein Beleg: eine Ressourcen-Grenze ist nirgends
dokumentiert. Maßgeblich ist die strengere Zahl, und sie betrifft ausgerechnet
den einzigen Client, für den die Ressourcen-Nutzung dokumentiert ist. 25 000
Token sind für deutschen Text überschlägig 75 000 Zeichen (rund 3 Zeichen je
Token, **geschätzt, nicht gemessen**).

Daran gemessen: Die größte Kapitel-Ressource ist Elberfelder Psalm 119. Die
Nutzlast misst 23 899 Zeichen, das vollständige `result` 25 789; die zweite Zahl
ist die belastbare, denn sie ist es, die über die Leitung geht. Überschlägig
8600 Token. Der Grundtext steht deshalb je Vers und nicht je Kapitel: Die
Grenzkosten von `bible_original` betragen **161 Zeichen je Wort** (Offb 20,1
byzantinisch, 19 Wörter: 3977 Zeichen; Offb 20,4, 59 Wörter: 10 434; fester
Anteil 910), und das größte Grundtext-Kapitel hat 1285 Wörter (`tr`, Joh 6), also
rund 208 000 Zeichen. Der größte Vers hat 59 Wörter.

### `verse_einzeln` statt `text`, und warum das Werkzeug es nicht bekommt

Eine angehängte Ressource wird zitiert, ein Werkzeugergebnis gelesen.
`bible_lookup` setzt bei mehreren Versen die Nummer in den Fließtext („16 Also
hat Gott die Welt geliebt, …"), und genau diese Form wurde bei `bible_crossrefs`
an beiden Enden abgeschnitten (25.07.2026, Joh 11,25-26). Gerechnet an Psalm
119, Luther, 176 Verse:

| Fassung | Zeichen | Faktor |
|---|---|---|
| nur `text` | 13 562 | 1,00 |
| `text` und `verse_einzeln` | 34 876 | 2,57 |
| nur `verse_einzeln` | 21 494 | 1,58 |

Beide Felder zu führen kostet mehr als das Doppelte, also ersetzt
`verse_einzeln` den zusammengesetzten Text, statt ihn zu ergänzen. Im Werkzeug
zählte derselbe Aufschlag zweimal, weil die Nutzlast seit 0.5.8 zusätzlich als
`structuredContent` mitfährt (Psalm 119 heute 27 177 Zeichen im ganzen
`result`); deshalb bleibt `bible_lookup` unverändert. Das ist entschieden, nicht
übersehen.

### Was Clients davon anbieten

Belegt: Anthropics Connector-Dokumentation führt unter „Protocol features →
Supported" Tools, Prompts **und** Resources sowie „Text and binary resources";
unter „Not yet supported" stehen Resource-Subscriptions und Sampling. Deshalb
deklariert `createServer()` `resources: {}` ohne `subscribe` und ohne
`listChanged`. Claude Code dokumentiert die Benutzung: Ressourcen erscheinen in
der `@`-Vervollständigung neben Dateien, referenziert als
`@server:protocol://resource/path`.

**Gemessen in Claude Code, eine Sitzung, ein Beobachter:** Die
`@`-Vervollständigung listet neben den vier festen Einträgen auch die drei
Vorlagen, die Variablen stehen in der Beschreibung. Ein Kontrollserver mit genau
einer festen Ressource und einer Vorlage zeigt dasselbe Bild; seine Vorlage steht
ausschließlich in `resources/templates/list`, also ruft dieser Client beide
Methoden ab.

Angezeigt heißt aber nicht angehängt, und das ist die eigentliche Auskunft dieser
Messung: Beim Kontrollserver kam die feste Ressource mit vollem Inhalt beim
Modell an, die aus einer Vorlage gebildete URI unmittelbar danach nur als
getippte Zeile, obwohl der Server beide liest. An diesem Server über HTTP
dasselbe Bild: `bible://quellen` kam vollständig an,
`bible://kapitel/LUT/Psalter/23` gar nicht. Die Geste, die in den Vorlagen steckt,
ist über `@` also nicht erreichbar, auf beiden Transporten.

Zweierlei kommt hinzu. Das Werkzeug, mit dem das Modell selbst Ressourcen
auflistet, liefert bei beiden Servern nur `resources/list`; dort sieht es die
Vorlagen ebenfalls nicht. Und der Name entscheidet mit: Trägt der eingetragene
Server Leerzeichen im Namen, setzt die Vervollständigung ein öffnendes
Anführungszeichen, das die dokumentierte Form (`@server:protocol://resource/path`)
nicht kennt, und so kam auch die feste URI in vier Versuchen nicht an. Unter
einem kurzen Namen ohne Leerzeichen, gleicher Endpunkt, gleicher Transport, kam
sie an. Wer die vier festen Ressourcen anhängen will, trägt den Endpunkt also
lokal unter einem Namen ohne Leerzeichen ein. Ein frisch eingetragener Server
wird zudem erst nach einem Neustart der Sitzung wirksam; der erste Versuch lief
deshalb ins Leere und sah aus wie ein Fehlschlag des Namens.

**Nicht belegt:** wie Claude Desktop und claude.ai Ressourcen in der Oberfläche
anbieten.

Daraus folgt ein Feld, kein Verzicht: `bible_server_info` nennt die vier URIs und
die drei Vorlagen. Die vier festen Einträge stehen in `resources/list` und werden
von einem Client mit Ressourcen-Anzeige gefunden; die Vorlagen, in denen die
eigentliche Geste steckt, stehen in einer eigenen Methode, die die Oberfläche
zwar abruft, das Ressourcen-Werkzeug des Modells aber nicht. `bible_server_info`
ist der eine Kanal, der das Modell nachweislich erreicht, und genau dafür wurde
es gebaut, weil `instructions` aus dem Handshake es nicht tut (26.07.2026).
Gekostet hat das 359 Zeichen in der Antwort, 673 im vollständigen `result` und
202 in `tools/list`. Gespeist wird das Feld aus denselben Konstanten und mit
derselben Datenbank-Sperre wie die beiden Listen, damit eine Instanz ohne Daten
hier nichts nennt, was dort nicht abrufbar ist; zwei Zusicherungen halten die
Gleichheit fest.

Der Hilfeartikel zu lokalen MCP-Servern nennt nur Werkzeuge und Connectors. Das
MCPB-Manifest bleibt deshalb ohne Hinweis auf die Anhänge-Geste; sein Text steht
im Installationsdialog von Claude Desktop und darf dort nichts versprechen, was
dieser Client womöglich nicht kann. Ein `resources`-Array kennt das MCPB-Schema
ohnehin nicht („Resources are not included in the manifest because MCP resources
are inherently dynamic").

### Vier Zustände geprüft

Neu formulierte Fehlermeldungen beginnen mit der Aussage, nicht mit „Error:",
wie es die Hausregel verlangt; ein Client der 1.x-Reihe stellt einem
JSON-RPC-Fehler ohnehin sein eigenes `MCP error <code>: ` voran
(`types.js:2031`), das Wort stünde also doppelt. Die von den Werkzeugen
geerbten Meldungen behalten ihr Präfix: dort dieselbe Zeichenkette zu liefern
wiegt schwerer als der Hausstil. Und die Prüfreihenfolge folgt der des
Werkzeugs (Namenslänge, Kapitel, Versliste, dann Auflösung), sonst gilt die
Zusicherung „dieselbe Meldung" nur für einzeln verletzte Bedingungen.

Gemessen gegen frische Prozesse: stdio mit Datenbank (alle Vorlagen lesbar),
stdio ohne (beide Listen leer, der Abruf wirft und nennt `bible_setup`), HTTP mit
Datenbank (dasselbe Ergebnis über den Endpunkt), HTTP ohne (Listen leer, der
Abruf wirft und sagt „nur serverseitig zu beheben", ohne ein Werkzeug zu nennen,
das dort nicht existiert). `/health` meldet in beiden Fällen ohne Datenbank 503.

---

## Der Anmerkungsapparat einer Ausgabe ist ein eigenes Feld

*Gemessen 05.08.2026.*

Eine gedruckte Bibelausgabe sagt an einer Stelle selbst, dass ihre Wiedergabe
eine Wahl unter mehreren ist: in der Fußnote. Genau diese Auskunft fehlte dem
Server. Sie liegt jetzt in `verse_notes` und erscheint als Feld `fussnoten` an
`bible_lookup` und den beiden Textressourcen.

**Der Apparat ist die Stimme der Ausgabe, `hinweis` die des Servers.** Deshalb
zwei Felder statt eines, und deshalb trägt jeder Eintrag die Stellenangabe der
Ausgabe mit (`stelle`, etwa „3,16") statt einer, die der Server neu formuliert.

**Die Querverweisnoten der Lieferung bleiben draußen.** Sie sind mit 43 971
Einträgen der weitaus größere Teil, und der Server führt bereits 344 781
Verweise aus OpenBible.info. Zwei Verweisnetze nebeneinander hieße, bei jedem
Aufruf zu entscheiden, welches gilt. Hinzu kommt die abweichende Versifikation
der Lieferung (siehe unten): Ihre Verweisziele stimmten mit den vorhandenen nicht
überein.

**Nicht nach Notentyp ausgewählt.** Der Wunsch lag nahe, nur die Noten mit
alternativer Übersetzung zu übernehmen. USX kennt dafür keinen Marker, es gibt
allein `style="f"`; eine Typisierung nach dem Anfangswort wäre eine
Interpretation des Servers am Verlagstext, und sie wäre falsch, sobald eine Note
zwei Dinge zugleich sagt.

**Verankert wird nach der Stellenangabe der Note, nicht nach dem umgebenden
Vers.** Verse sind in USX Meilensteine; eine Note steht irgendwo dazwischen.
Beides fällt in 1219 von 1220 Fällen zusammen. Die Ausnahme ist die Note zu
Ps 119,1: Sie hängt an der Akrostichon-Überschrift **vor** dem ersten Vers des
Kapitels und ginge beim Ankern nach dem Vers verloren. Die Stellenangabe trägt:
alle 1220 haben die Form „K,V", und alle 1220 Ziele existieren als Vers.

**Der Parser braucht eine Deny-Liste, und das ist der Fund, den eine
Gesamtsumme nicht hergibt.** 3885 der 31 171 Verse (12,5 %) überspannen eine
`<para>`-Grenze. Dazwischen liegen in fünf Fällen Dinge, die nicht zum Vers
gehören: Abschnittsüberschriften (Apg 9,19, Jes 59,15) und Sprecherangaben
(Hld 7,1, 7,10, 8,5). Wer „alle Textknoten zwischen `sid` und `eid`" einsammelt,
liefert die Überschrift als Verstext aus, und die Verszahl stimmt dabei. Nicht
auf der Liste steht `d`, die Psalmüberschrift (11 Fälle): Die deutsche Zählung
dieser Ausgabe führt sie als Vers 1, sie gehört hinein. Gegengeprüft wird gegen
`versification.vrs` der Lieferung, 1189 Kapitel, keine Abweichung.

**Die Registry in `translations.ts` hat ein Feld `quelle` bekommen, und der
Grund ist ein Fehler, der beinahe passiert wäre.** Sie sieht wie eine
Deklaration aus und ist zugleich die Arbeitsliste von `scripts/download.ts`:
Bei `all` leitet es die Codes aus `Object.keys(TRANSLATIONS)` ab, und
`scripts/setup.ts` führt diesen Schritt als `required`. Ein Eintrag, dessen
Quelldateien nicht bei bolls.life liegen, hätte damit jeden Erstaufbau
abgebrochen, auch den eines MCPB-Nutzers über `bible_setup`, und weil der
Schritt `required` ist, wären die sieben folgenden Datensätze mit ausgefallen.
Aufgefallen wäre es beim Entwickeln nie: Die Datenbank steht ja längst.

Aus demselben Grund nennen die Meldungen von `requireTranslation` nur noch
**geladene** Ausgaben. Vorher zählten sie den gesamten Registry-Bestand auf und
schickten den Aufrufer bei einer nicht geladenen Ausgabe zu
`bun run download <code>`. Am authlosen HTTP-Endpunkt ist der Aufrufer ein
Fremder: Er bekäme einen Namen genannt, den dieser Server nicht liefert, und
einen Befehl, den er nicht ausführen kann.

**Was die Breitenprüfung dazu lernen musste.** `tests/schema-coverage.ts` zog
seine Stichprobe aus Luther und rief sie gegen alle Übersetzungen ab. Bei einer
Ausgabe mit deutscher Versifikation trifft das reihenweise daneben: 136 Kapitel
mit abweichender Verszahl, zwei Bücher mit abweichender Kapitelzahl (Joel 4
statt 3, Maleachi 3 statt 4). Die Aufrufe wären als „nicht gefunden"
durchgelaufen und hätten als Fehlerantworten gezählt, nicht als geprüfte
Nutzlasten: Der Lauf bliebe grün und hätte weniger geprüft, als er meldet.
Solche Ausgaben bekommen jetzt ihre eigene Stichprobe, erkannt daran, dass sie
Verse führen, die Luther nicht hat. Der Breitenlauf wuchs dadurch am selben Tag
von 582 auf 597 Aufrufe und von 578 auf 593 geprüfte Antworten, bei 0
Schemafehlern.

Das gilt nicht nur für die neue Ausgabe. Menge zählt seit je ebenso, und
`books.chapters` stammt aus dem Luther-Lauf und führt Joel mit 3 und Maleachi
mit 4: für Menge heute schon falsch. Umgerechnet wird nichts, jede Ausgabe
behält ihre Zählung.

---

## Eine Grenze, die eine Zusage einhält, gehört an die Ausgabe und nicht an den Server

*Gemessen 05.08.2026.*

Zwei Ausgaben geben je Abruf höchstens 20 Verse im Wortlaut aus, die übrigen drei
alles wie bisher. Die Zahl ist nicht abgeleitet und nicht gewählt, sie ist einem
Verlag zugesagt; ableitbar ist sie aus keiner anderen Grenze dieses Servers, und
eine konstruierte Herleitung wäre eine Fiktion gewesen.

**Der Ort ist die Registry, nicht `server.ts`.** Eine Konstante bei den `MAX_*`
hätte gebraucht, was daneben steht: die Menge der betroffenen Kürzel. Das ist die
zweite Angabe, die vergessen wird, sobald eine sechste Ausgabe dazukommt, und
genau das Muster, das in diesem Repo zweimal auseinandergelaufen ist. Als Feld
`verseMax` neben `license` und `attribution` erzwingt `satisfies` bei jedem neuen
Eintrag eine Aussage, und `null` heißt dort „keine Grenze" und nicht „vergessen".
Das ist zugleich der Rückweg: Kein Handler liest die Registry, alle fragen
`verseBudget()`, eine andere Zahl kostet also eine Zeile.

**Gekürzt und gemeldet, nicht abgewiesen.** Abweisen machte „zeig mir Psalm 119"
unbenutzbar, und das ist bei einem Werkzeug für Bibelarbeit der Normalfall.
Gemessen haben 768 der 1189 Kapitel in der einen und 765 in der anderen Ausgabe
mehr als 20 Verse.

**Querverweise werden je Verweis budgetiert, nicht je Vers, und das ist der
teuerste Teil der Entscheidung.** Eine Grenze auf Versebene schneidet mitten in
eine Versspanne: `stelle` nennt weiter „Johannes 11,25-26", `verse_einzeln` trägt
einen Teil davon, und die Ellipse `… [bis V. n]` greift nur, wenn die Spanne
schon den Deckel von vier Versen sprengt, sagt es also nicht. Gemessen träfe das
3335 von 29 364 möglichen Abrufen bei `limit: 30`. Das Feld `verse_einzeln`
existiert eigens gegen unvollständiges Zitieren, und der `lesehinweis` daneben
fordert ausdrücklich zur vollständigen Übernahme auf: Ein still halbierter
Verweis wäre der Hausfehler dieses Servers ein viertes Mal gewesen, diesmal neben
einer Lizenzzusage. Deshalb `nimmGanz()`, das eine Einheit nur vollständig
bewilligt und nach der ersten Ablehnung sperrt. Die Sperre ist nicht Zierrat:
Ohne sie rutschte hinter einem abgelehnten dreiversigen Verweis noch ein
einversiger durch, und die Antwort bekäme ein Loch.

**Die Verweise bleiben trotzdem alle stehen, ohne `text`.** Die Verweisdaten sind
CC BY und stammen nicht vom Verlag; begrenzt ist der Wortlaut, nicht die
Stellenangabe. Die Liste zu kürzen hätte `verweise.length` von der Übersetzung
abhängig gemacht, und dieselbe Frage lieferte in der einen Ausgabe 23 und in der
anderen 15 Verweise, ohne dass die Datenlage verschieden wäre.

**Die Auslegung der zweiten Zusage ist entschieden, nicht angenommen.** Der Satz
„Bei einer Wortsuche über die ganze Bibel sieht der Nutzer darüber hinaus nur die
Stellenangaben" lässt sich auch als „bei der Suche gar kein Text" lesen; ein
Gegenleser hat genau das vorgebracht. Umgesetzt ist die andere Lesart: die ersten
20 Treffer mit `text`, alle weiteren nur mit `stelle`. Entschieden vom Verfasser
des Briefes.

**Die Grenze gilt je Abruf, und das ist die Zusage, nicht ein Versäumnis.** Dass
ein Modell mehrfach abrufen und ein Kapitel zusammensetzen kann, ist bekannt und
entschieden: Der Brief sagt „jeder Abruf höchstens 20 Verse", nicht eine
Sitzungssumme. Eine Drosselung über Abrufe hinweg bräuchte Zustand, den der
HTTP-Modus bewusst nicht führt, und die Zusage verlangt sie nicht. Was bleibt:
Keine Antwort fordert zum Nachladen des Rests auf.

**Der Anmerkungsapparat bekommt ein eigenes Budget derselben Größe.** Ob
Notentext als „Verse im Wortlaut" zählt, ist mit dem Verlag nicht geklärt.
Zwei Vorkehrungen beantworten die Frage nicht, machen sie aber folgenlos: Die
Noten werden aus dem bereits gekürzten Versbestand abgeleitet, und sie zählen
zusätzlich gegen ein zweites Budget. Der Apparat kann die Grenze also auch dann
nicht sprengen, wenn sie später bejaht wird. Eine zweite, frei erfundene Zahl
gibt es dafür nicht: Das Budget hat dieselbe Größe wie das der Verse, damit die
Registry weiterhin die einzige Stelle bleibt. Gemessen greift es nie: 1220 Noten,
höchstens 15 je Kapitel, 12 innerhalb der ersten 20 Verse, 3 je Vers. Damit ist
es Vorsorge wie `MAX_VERSES_LENGTH`, und wie dort gibt es aus demselben Grund
keinen Testfall: Er ließe sich mit diesen Daten nicht herstellen.

**Die eine Stelle, die kein Typfehler ist.** In `bible_search` liest der
Klammerhinweis die Datenbankzeilen, und deren `text` bleibt eine Zeichenkette,
auch wenn die Antwort ihn nicht ausliefert. Ohne Umstellung warnte die Antwort
vor Klammern in Versen, die sie nicht enthält, und der Typecheck sagte nichts
dazu. In `bible_crossrefs` fängt er dieselbe Verwechslung, weil das bedingte Feld
dort als `text?: string` inferiert (mit `tsc --strict` geprüft): Der naive Zugriff
scheitert mit TS2345, der `typeof`-Filter geht durch.

**Ein leerer `text` in `bible_crossrefs` ist entfallen.** Findet sich zu einem
kapitelübergreifenden Ziel kein Vers in der gewählten Übersetzung, stand dort
seit je `""`. Seit die Grenze dasselbe Feld weglassen kann, stünden zwei
Bedeutungen nebeneinander, und die eine sähe aus wie die andere. Jetzt fehlt das
Feld in beiden Lagen. Der leere String war nie eine Aussage: Er sagte nicht, dass
der Vers fehlt, und auch sonst nichts.

---

## Eine Kürzung, die der Server selbst vornimmt, muss in der Antwort stehen

*Gemessen 06.08.2026 am ausgerollten Dienst.*

`bible_crossrefs` schneidet ein mehrversiges Verweisziel bei vier Versen ab und
hängt an `text` die Ellipse `… [bis V. n]`; über eine Kapitelgrenze hinweg steht
nur der erste Vers da, mit `… [Abschnitt bis c,v]`. Beides ist gewollt: Ziele
über viele Verse sind häufig (18 419 der 344 781 Verweiszeilen haben eine Spanne
über vier Verse, 637 überschreiten eine Kapitelgrenze), und ungekürzt trüge eine
Antwort mit 30 Verweisen ein Vielfaches an Text.

Gemeldet wurde die Kürzung aber nur in `text`, und ausgerechnet dort liest sie
niemand: `verse_einzeln` gibt es, weil Konsumenten die zusammengesetzte
Zeichenkette an beiden Enden abschneiden, und der `lesehinweis` schickt sie
deshalb ausdrücklich dorthin. Er verlangte, „die Verse vollständig zu
übernehmen", während das Feld vier von neun trug und über eine Kapitelgrenze
hinweg ganz fehlte. Wer der Anweisung folgte, gab „Sprüche 8,22-30" aus und
lieferte 22-25. Der Fall ist nicht selten: Johannes 1,5 löst ihn beim
Vorgabelimit zweimal aus.

Deshalb `abschnitt_gekuerzt` je Verweis, mit `verse_gezeigt` und, wo die Länge
feststeht, `verse_gesamt`. Der Name ist bewusst nicht `gekuerzt`: So heißt bereits
das Feld der Antwort, das die Wortlaut-Grenze der Ausgabe meldet, und das rechnet
in Versen über alle Verweise hinweg. Die beiden nebeneinander unter demselben
Namen zu führen hat schon einmal zu einer Verwechslung der Einheiten geführt.

**Verworfen:** `stelle` auf die gelieferten Verse zurücksetzen. Sie ist die
Angabe des Verweisziels aus der Quelle; sie zu beschneiden verlöre die
Information, wie weit das Ziel reicht, und machte eine korrekte Angabe falsch,
um eine fehlende zu ersetzen.

Derselbe Zug betrifft `bracketHints()`. Beide Marker tragen eckige Klammern und
lösten den Hinweis aus, Wörter in eckigen Klammern gehörten „zum Wortlaut der
Übersetzung und sind keine Einfügung dieses Servers": eine Aussage, deren
Auslöser ausschließlich eine Einfügung dieses Servers war. In Luther, Schlachter
1951 und Elberfelder gibt es keinen einzigen Vers mit eckigen Klammern, dort war
der Satz also immer falsch. Die Marker sind seither von der Prüfung ausgenommen;
sie liegen zusammen mit ihr in `werkzeug-helfer.ts`, weil ein geändertes
Markerformat den Fehler sonst still zurückbrächte.

## Dieselbe Stellenangabe trifft nicht in jeder Ausgabe denselben Text

*Gemessen 06.08.2026.*

Die Ausgaben zählen nicht überall gleich. 140 der 1190 Kapitel weichen
voneinander ab: 3. Mose 6 hat in Elberfelder, Menge und Schlachter 2000 23
Verse, in Luther und Schlachter 1951 dagegen 30, während Kapitel 7 in allen fünf
38 hat. Die Differenz wandert also nicht weiter, sie sitzt an der Kapitelgrenze.

Die Folge stand ohne jeden Vorbehalt in der Antwort: „3. Mose 6,20" lieferte in
Luther das Opfer Aarons und in Elberfelder den Vers, der bei Luther 6,27 ist.
Zwei solche Antworten nebeneinander lesen sich wie zwei Übersetzungen derselben
Stelle, und genau so wurden sie wiedergegeben. Das ist keine Datenlücke; beide
Ausgaben sind vollständig.

`bible_lookup` und die Textressourcen tragen deshalb einen Satz, der die Länge
je Ausgabe nennt und sagt, dass der Abgleich am Wortlaut zu erfolgen hat, nicht
an der Versnummer.

**Verworfen:** eine Abbildung von Vers auf Vers. Sie läge nahe und wäre die
eigentlich nützliche Auskunft, aber eine solche Tabelle liegt hier nicht vor,
und eine abgeleitete wäre geraten. Eine falsche Zuordnung ist schlimmer als
keine, weil sie geprüft aussieht.

**Verworfen:** die Auskunft in `bible_server_info` oder die Dokumentation. Der
Fall tritt bei einem einzelnen Abruf auf, und was nicht im Ergebnis steht,
erreicht das Modell nicht.

## Die Voreinstellung gehört dem Endpunkt, die Konstante gehört jedem Klon

*Gemessen 06.08.2026.*

Der gehostete Dienst führt die Schlachter 2000 und soll sie voreinstellen. Die
Konstante `DEFAULT_TRANSLATION` dafür umzuwidmen scheidet aus, aus zwei
unabhängigen Gründen. Erstens gilt sie jedem Klon, und dort gibt es die Ausgabe
nicht: Jeder Abruf ohne `translation` liefe in „Ihre Quelldateien werden nicht
mitgeliefert, das lässt sich hier nicht nachholen." Zweitens trägt die Konstante
eine zweite Bedeutung, die mit der Ausgabe nichts zu tun hat: `download.ts`
macht an ihr fest, welcher Lauf die Tabellen `books` und `aliases` schreibt. Eine
Umgebungsvariable des Servers darf nicht bestimmen, woher die Buchnamen stammen.

Deshalb `BIBLE_DEFAULT_TRANSLATION`, aufgelöst in `werkzeug-helfer.ts` und nicht
in `translations.ts`: Erst dort ist bekannt, was tatsächlich geladen ist, und
`translations.ts` importiert nichts, damit die Aufbau-Skripte an ihr hängen
können, ohne die Laufzeit mitzuziehen.

**Der Rückfall warnt, statt den Start abzubrechen.** Ein unbekanntes Kürzel oder
eine nicht geladene Ausgabe fällt auf die eingebaute zurück und meldet das auf
stderr. Abbrechen wäre lauter, aber teurer: Eine falsche Zeile in einer
Unit-Datei nähme einen öffentlichen Endpunkt vom Netz, während der Rückfall
weiter gültigen, frei lizenzierten Text liefert. Die Richtung stimmt auch
lizenzrechtlich, denn zurückgefallen wird nie auf eine Ausgabe, für die keine
Lizenz vorliegt.

**Der teuerste Fehler wäre gewesen, die Selbstauskunft zu vergessen.**
`inputSchema.default` ist nicht bloß Beschreibung: Ein Client darf daraus einen
weggelassenen Wert materialisieren und ihn ausdrücklich senden. Drei Werkzeuge
deklarierten zunächst weiter `"LUT"`, während das Verhalten bereits eine andere
Ausgabe lieferte; ein solcher Client hätte die Einstellung des Endpunkts still
ausgehebelt, und kein Testlauf wäre rot geworden. Vorgabewert und
Beschreibungstext werden deshalb aus derselben Konstante erzeugt, und
`bible_server_info` nennt die wirksame Vorgabe zusätzlich zur Ressource: Es ist
der Kanal, den das Modell nachweislich sieht.

# Fehlermeldungen und Argumentprüfung

## Eine Meldung nennt die verletzte Bedingung, nicht irgendeine

*Gemessen 26.07.2026, 05.08.2026 und 06.08.2026.*

Derselbe Fehler ist hier zweimal aufgetreten, in derselben Gestalt: mehrere
Bedingungen in einer Prüfung gefaltet, und die eine Sammelmeldung nennt dann eine
Bedingung, die die Eingabe erfüllt.

**Erster Fall, 26.07.2026:** Länge und Anwesenheit gefaltet, worauf ein 60 Zeichen
langer Buchname „'book' is required" bekam. Behoben wurde damals die Länge; die
Typfaltung blieb stehen.

**Zweiter Fall, 05.08.2026, zehn Tage später.** Er war breiter als notiert:
Gemessen falten **vier** Werkzeuge Anwesenheit und Typ (`bible_lookup`,
`bible_original`, `bible_crossrefs`, `bible_compare`), und `bible_search` faltet
bei `query` sogar **drei** Bedingungen. Der schlimmste Fall stand deshalb bei der
Suche: Ein 150 Zeichen langer Suchausdruck bekam „Error: 'query' is required (max
100 characters)" – gesetzt, eine Zeichenkette, allein zu lang, und die Meldung
nannte zwei Bedingungen, die er erfüllte.

Die Ursache ist beide Male dieselbe: eine Zahl neben einer Sammelmeldung. Die 100
stand zweimal nackt da, im Vergleich und im Meldungstext. Sie heißt jetzt
`MAX_QUERY_LENGTH` und steht bei den übrigen Grenzen.

### Was gemeinsam wurde und was beim Werkzeug bleibt

Die Typmeldungen sind gemeinsame Konstanten (`bookNotAString`, `queryNotAString`,
`queryTooLong`), denn vier Werkzeuge geben die erste wortgleich aus. Die
„is required"-Meldung bleibt dagegen **beim Werkzeug**, und das ist kein
Versehen: Sie trägt dessen eigene Beispiele, und `bible_compare` nennt dort nur
neutestamentliche Bücher, weil es alttestamentliche mit einer eigenen Meldung
abweist. Eine gemeinsame Konstante hätte an dieser Stelle ein Beispiel angeboten,
das das Werkzeug nicht annimmt. Die Typmeldung trägt umgekehrt gar keine
Beispiele: Sie benennt die Bedingung, und die Beispiele stehen schon in der
Meldung eine Prüfung davor.

Die Anwesenheitsprüfung fragt auf `undefined`, `null` und `""` ab und **nicht**
auf `!book`: `0` und `false` sind gesetzte Werte vom falschen Typ und bekommen
deshalb die Typmeldung.

### Seit dem 06.08.2026 ist die Reihenfolge eine Zusage

Die drei Buchprüfungen liegen in `requireBookName` und bedienen vier Werkzeuge.
Die Reihenfolge Anwesenheit, dann Typ, dann Länge ist damit an einer Stelle
festgelegt statt viermal nachgebaut. Ausschlaggebend war nicht die
Zeilenersparnis, sondern dass beide historischen Korrekturen genau dieses Trio
betrafen und beide Male vier zeichengleiche Änderungen kosteten: `44d282c`
(26.07.2026) zog die Länge heraus und ließ die Typfaltung stehen, `7bb3872`
(05.08.2026) zog sie zehn Tage später nach.

Kapitel- und Versprüfung sind **nicht** mitgegangen, obwohl sie im selben Block
stehen: Sie sind je eine Bedingung mit je einer Meldung, Grenze und Text liegen
seit dem 26.07.2026 in gemeinsamen Konstanten, und die Faltung kann dort nicht
entstehen. Auch der Ressourcen-Pfad hält seine Fassung selbst, denn er wirft
(`rpcError`) statt zurückzugeben, und URI-Segmente sind immer vorhanden und immer
Zeichenketten; sein Kopfkommentar begründet ausdrücklich, warum dort nichts
zusammengelegt wird.

**Offen und ausdrücklich nicht mitrepariert:** `chapterOutOfRange` und
`verseOutOfRange` falten dieselbe Klasse. Ein **fehlendes** `chapter` hört „must
be an integer between 1 and 150", also eine Bereichsaussage über einen Wert, der
nicht da ist. Das zu ändern wäre eine Verhaltensänderung und lag außerhalb des
Auftrags.

---

# Prüfen und Messen

## Zwei Prüfarten für die Schemata, weil keine allein reicht

*Gemessen 02.08.2026, Zahlen fortgeschrieben bis 06.08.2026.*

Seit 0.5.8 ist eine Erfolgsantwort ohne `structuredContent` kein unvollständiges
Ergebnis mehr, sondern ein harter Fehler beim Client. Die Golden-Tests decken die
benannten Fälle ab; dazwischen liegt jeder selten genommene Rückgabepfad.
`tests/schema-coverage.ts` (`bun run test:schemas`) prüft deshalb in die Breite:
deterministisch gezogen (jeder 700. Luther-Vers durch alle Werkzeuge, alle
Übersetzungen, alle NT-Editionen, dazu die neun NT-Verse ohne TAGNT-Zeile), jede
Antwort gegen das `outputSchema` aus `tools/list`.

Erster Lauf: 420 Aufrufe, 416 gültig, **0** Schemafehler, **0** Erfolgsantworten
ohne `structuredContent`, **0** Abweichungen zwischen Textblock und Struktur.
`required` ist damit auch dort nicht zu streng, wo es teuer wäre: Joh 7,53 steht
im Mehrheitstext, hat aber keine TAGNT-Zeile und liefert korrekt eine Antwort
ohne `bezeugung`. Heute sind es 593 geprüfte Antworten in 1,3 Sekunden.

**Der eigentliche Befund ist die Arbeitsteilung.** Die Breite fand keinen
einzigen Klammerhinweis von `bible_lookup`, und konnte es nicht: Klammern gibt es
in 137 von 31 166 Menge-Versen. Ein Zufallslauf findet falsche Typen und
vergessene Pfade, die benannte Liste findet das seltene Feld. Deshalb läuft der
Breitentest **nicht** bei jedem Commit, sondern nach Änderungen an einem Schema
oder einer Nutzlast, und die Ausgabe nennt je Werkzeug die gesehenen Felder: Was
dort fehlt, braucht einen benannten Fall im Golden-Test.

Beide teilen sich den Prüfer in `tests/schema-validator.ts`. Er kann nur die
Teilmenge von JSON Schema, die hier vorkommt, und das ist Absicht: alles darüber
wäre ungeprüfter Code, der geprüften Code bewacht. `ajv` läge als transitive
SDK-Abhängigkeit bereit und wäre als `devDependency` vertretbar (die Laufzeit
bliebe bei einer Abhängigkeit), nur zu 95 Prozent ungenutzt.

Dass der Prüfer nicht alles durchwinkt, ist die eine Aussage, die er über sich
selbst nicht treffen kann; sie steht als fünf bekannt kaputte Antworten im Bündel
`tests/golden/search.ts`, wo die echte Antwort liegt, an der sie gemessen werden.
**Ein Validator, der versehentlich alles durchwinkt, verhält sich exakt wie ein
bestandener Test.**
