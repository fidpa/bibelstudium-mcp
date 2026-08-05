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

Neueste Einträge oben. Jeder Eintrag nennt das Datum seiner Messung. Wo etwas
nicht gemessen, sondern vermutet ist, steht das ausdrücklich dabei.

---

## 2026-08-05: Anwesenheit und Typ sind zwei Bedingungen, und die Faltung kam zum zweiten Mal

Am 26.07.2026 war schon einmal eine Faltung aufgeflogen: Länge und Anwesenheit
in einer Prüfung, worauf ein 60 Zeichen langer Buchname „'book' is required"
bekam. Behoben wurde damals die Länge. Die **Typ**-Faltung blieb stehen, weil
sie außerhalb des damaligen Auftrags lag, und stand seither als offener Punkt.

Sie war breiter als notiert. Notiert war `bible_lookup`; gemessen falten
**vier** Werkzeuge Anwesenheit und Typ (`bible_lookup`, `bible_original`,
`bible_crossrefs`, `bible_compare`), und `bible_search` faltet bei `query`
sogar **drei** Bedingungen. Der schlimmste Fall stand deshalb bei der Suche: Ein
150 Zeichen langer Suchausdruck bekam „Error: 'query' is required (max 100
characters)" – gesetzt, eine Zeichenkette, allein zu lang, und die Meldung
nannte zwei Bedingungen, die er erfüllte.

**Die Ursache ist dieselbe wie 2026-07-26, in neuer Gestalt:** eine Zahl neben
einer Sammelmeldung. Die 100 stand zweimal nackt da, im Vergleich und im
Meldungstext. Sie heißt jetzt `MAX_QUERY_LENGTH` und steht bei den übrigen
Grenzen.

**Was getrennt wurde und was nicht.** Die Typmeldungen sind gemeinsame
Konstanten (`bookNotAString`, `queryNotAString`, `queryTooLong`), denn vier
Werkzeuge geben die erste wortgleich aus. Die „is required"-Meldung bleibt
dagegen **beim Werkzeug**, und das ist kein Versehen: Sie trägt dessen eigene
Beispiele, und `bible_compare` nennt dort nur neutestamentliche Bücher, weil es
alttestamentliche mit einer eigenen Meldung abweist. Eine gemeinsame Konstante
hätte an dieser Stelle ein Beispiel angeboten, das das Werkzeug nicht annimmt.
Die Typmeldung trägt umgekehrt gar keine Beispiele: Sie benennt die Bedingung,
und die Beispiele stehen schon in der Meldung eine Prüfung davor.

Nebenbei fiel auf, dass `!book` auch `0` und `false` als „fehlt" behandelte.
Beide sind gesetzt und keine Zeichenkette; sie bekommen jetzt die Typmeldung.

Zehn Zusicherungen dazu, Messlatte von 478 auf 494. Sechs Fehlereinbauten, jeder
rot im vorab benannten Bündel: der Rückfall in die Faltung in allen fünf
Werkzeugen, dazu eine Verschiebung von `MAX_QUERY_LENGTH`.

---

## 2026-08-05: Ein Werkzeug je Datei, und der teuerste Teil war der Helferblock davor

Nach der Datenschicht (`db.ts`) und den Editionen (`editions.ts`) waren die
Handler dran, und die eigentliche Arbeit lag nicht bei ihnen. Die fünf benannten
Handler messen 747 Zeilen im Abschnitt, greifen aber auf **19 Bezeichner** aus
`server.ts` zu. Zöge man nur sie heraus, importierte jede Handler-Datei aus
`server.ts`, das sie seinerseits importiert: genau der Zirkelbezug, den der
ganze Umbau vermeidet. Die 19 lagen in vier Banner-Abschnitten mit zusammen 622
Zeilen, und die mussten zuerst nach `werkzeug-helfer.ts`.

**Zwei Zuschnittsfragen, beide gemessen statt gewählt.** *Eine Helferdatei oder
zwei?* Die 622 Zeilen zerfallen sichtbar in zwei Themen, allgemeines Werkzeug
und biblische Auflösung, und zwei Dateien wären ehrlicher benannt. Die Messung
sprach dagegen: Von den sechs werkzeugseitigen Aufrufern (fünf Handler plus das
inline liegende `bible_lookup`) käme **keiner** mit nur einer der beiden Hälften
aus. Zwei Dateien kosteten elf Importanweisungen statt sechs und ersparten
keinem Aufrufer eine einzige. Dazu hängen die Hälften selbst aneinander:
`bookNotFound` ruft `errorResult`, `resolveBook` ruft `escapeLike`,
`lookupPayload` ruft `stripHtml` und `bracketHints`. Also eine Datei, gegliedert
über die vier erhaltenen Banner. *Flach oder unter `handlers/`?* Kein Handler
löst irgendetwas relativ auf (`import.meta.path` steht allein in `db-path.ts`
und unter `scripts/`), die Pfadauflösung sprach also nicht dagegen; flach
stünden 15 statt 8 `.ts`-Dateien in der Wurzel. Also `handlers/`.

**Der Befund, den die Sitzung wirklich gebracht hat, betrifft den Dispatch.**
`bible_lookup` lag als Rest-Fall inline in `handleCallTool`, hinter
`if (toolName !== "bible_lookup") throw`. Nimmt man den Rumpf heraus, sieht
diese Negation sinnlos aus, und die naheliegende Aufräumung wäre ein `switch`
mit `default: throw` oder eine Handler-Tabelle. Beides zöge den Wurf dorthin,
wo er logisch hingehört: an den Anfang. Gemessen liegt er heute aber **hinter**
der `dataMissing`-Sperre, und das ist verhaltensrelevant: Ein unbekannter
Werkzeugname bekommt auf einer Instanz ohne Datenbank den Setup-Hinweis mit
`isError: true`, nicht `-32602`. Nichts deckt das ab. `tests/golden/uebergreifend.ts`
fährt den unbekannten Namen **mit** Datenbank, `tests/golden/ohne-datenbank.ts`
ruft ohne Datenbank nur `bible_lookup`, und der CI-Guard greppt allein auf
`bible_lookup`. Die Kette ist deshalb als Negation stehen geblieben, und die
Kombination wurde vorher und nachher von Hand gemessen; die Antwort ist
zeichengleich.

**Ein Fehlereinbau, der die geprüfte Zeile nicht erreicht, sieht aus wie eine
bestandene Prüfung.** Von sieben Einbauten blieb einer im ersten Anlauf grün:
der Vorgabewert von `limit` in `handleConcordance`, von 50 auf 1. Das Bündel
übergibt `limit` aber ausdrücklich mit 200, der Vorgabewert wird also nie
erreicht. An der Klammer wiederholt (Obergrenze 200 auf 1) wurde derselbe
Gedanke rot. Die Lehre ist nicht „die Absicherung fehlte", sondern: Vor dem
Schluss auf eine Lücke ist zu prüfen, ob der Einbau überhaupt auf dem Pfad
liegt, den der Test nimmt.

**Und eine Prüfung ist neu dazugekommen:** `bun run build:mcpb` samt einem
stdio-Aufruf gegen das entstandene Binary. `bun run server.ts` und
`bun build --compile` sind zwei verschiedene Auflöser, und dieser Umbau
verschob erstmals Module unter die Wurzel; auf CT 104 landet genau dieses
Binary. Es lief.

Ergebnis: `server.ts` von 3857 auf **2361** Zeilen und von 17 auf 10 Banner
(2360 nach dem Nachgang unten),
erwartet waren 2355. Vier Läufe unverändert (475 / 47 / 593), vier
CI-Startgarantien von Hand, sieben Einbauten rot im vorab benannten Bündel.

**Nachgang am selben Tag, und er ist der eigentliche Ertrag.** Zwei Befunde aus
dem Umbau wurden abgeräumt: ein toter `type`-Import in `server.ts`, den
`noUnusedLocals: false` dauerhaft verdeckt hätte, und die Meldung
„No verses found", die als einzige von Hand zusammengesetzt war statt über
`errorResult`. Die Begründung dafür („sie trägt einen eigenen Rückgabetyp")
stammte aus dem Gegenlesen, war **nicht gemessen und falsch**: Beide Formen sind
gestaltgleich, typgleich und liefern byteweise dieselbe Antwort.

Die Probe auf die geänderte Zeile blieb dann **grün**, und das war der Fund. Der
Einbau griff und der Pfad ist erreichbar; es fehlte die Absicherung. Die
Zeichenkette kam in keinem der zwölf Bündel vor, und kein Aufruf erreichte den
Zweig, in dem die Versnutzlast `null` liefert: Jeder nutzte eine gültige Stelle
oder scheiterte schon an einer Wertprüfung davor (`chapter: 999` an
`MAX_CHAPTER`, `verses: "1-500"` an der Wertgrenze). Dorthin führt nur eine
**gültig aussehende, aber nicht existierende** Angabe. `Ps 117,5` ist eine davon,
das Kapitel hat zwei Verse. Zwei Zusicherungen dazu, Messlatte von 475 auf 478,
und derselbe Einbau ist jetzt rot.

Das ist der dritte Fall desselben Musters nach den beiden aus Sitzung A, und er
kam nur ans Licht, weil eine **Änderung** verifiziert wurde und nicht bloß ein
Umzug. Ein Umzug lässt sich gegen die Vorher-Antwort messen; eine Änderung nicht,
dort ist der Fehlereinbau die einzige Auskunft darüber, ob überhaupt jemand
hinsieht.

---

## 2026-08-05: Auch der geteilte Zustand lässt sich herausziehen, wenn er zirkelfrei ist und nach dem Start nicht mehr geschrieben wird

Nach den drei zustandsfreien Modulen war die Datenschicht an der Reihe: die
Datenbankverbindung, ihre Unversehrtheitsprüfung und alle 20 vorbereiteten
Statements, zusammen 410 Zeilen am Anfang von `server.ts`. Sie ist der geteilte
Zustand des Servers, und genau das galt lange als der Grund, sie nicht
anzufassen.

**Warum es trotzdem geht.** Zwei Eigenschaften, beide gemessen, nicht die
Zustandsfreiheit. Erstens ist der Block zirkelfrei: Er benutzt von der Logik des
Servers nichts, die Rückwärtssuche findet vier Treffer, alle in Kommentaren.
Zweitens wird er nach dem Start nicht mehr geschrieben; unterhalb des
Initialisierungsblocks gibt es keine einzige Zuweisung an `db` oder
`dataMissing`. `handleSetup` fasst die Verbindung nicht an, es verlangt einen
Neustart. Deshalb genügt jedem Aufrufer ein gewöhnlicher Import, und der
Initialisierungsblock ist wörtlich unverändert umgezogen, `let` und try-catch
eingeschlossen: Die kleinste mögliche Änderung beantwortet die naheliegende
Rückfrage („erstarrt beim Verschieben etwas?") mit „es hat sich nichts
geändert".

**`EDITION_META` ging im selben Zug, aber in eine eigene Datei.** Der Abschnitt
enthält kein `db`, kein `stmt*`, kein `has*`; in die Datenschicht gehörte er
also nicht. Er blieb aber auch nicht: Zwei der fünf Handler, die als Nächstes
ausziehen sollen, brauchen ihn, und ein Handler in eigener Datei müsste ihn dann
aus `server.ts` zurückimportieren. Genau das soll der Umbau vermeiden.
`PACKAGE_VERSION` ist umgekehrt zurückgeblieben, obwohl es formal im gleichen
Bereich stand: Es kommt aus `package.json` und nicht aus der Datenbank.

**Was der Schnitt gekostet hat: nichts, und zwei Läufe haben es gezeigt, die es
sonst nicht gäbe.** `server.ts` ging von 4417 auf 3857 Zeilen, von 26 auf 17
Abschnitte. Vier Läufe unverändert (466 / 47 / 593), Startzeit unverändert
(0,267 bis 0,276 s gegen 0,267 bis 0,281 s vorher, je drei Läufe). Die
befürchtete Typverengung über Modulgrenzen trat nicht ein: An allen sieben
Stellen, an denen eine `null`-Prüfung auf einem Statement über nachfolgende
Funktionsaufrufe hinweg tragen muss, bleibt `tsc` grün, auch wenn die Bindung
jetzt aus einem Import kommt.

**Was die Tests nicht sehen, und diesmal ist es das Wichtigste.** Vier Fehler
wurden eingebaut, drei wurden im vorab benannten Bündel rot. Der vierte blieb
grün, und er war kein Randfall: `resolveEdition` von `byzantine` auf `tr`
umgestellt kippt die Voreinstellung von `bible_original` von einer Textform auf
eine andere, nachgewiesen an einem frischen Aufruf (1Joh 5,7 antwortete mit
`texttyp: "tr"` samt Comma Johanneum). Keine der 466 Zusicherungen bemerkt das:
Alle Editionsprüfungen nennen den Texttyp ausdrücklich, keine prüft, was ohne
Angabe herauskommt. Ersetzt wurde der Einbau durch eine Verfälschung in
`EDITION_ALIASES`, die in `ressourcen` rot wird.

Der erste Einbau musste aus demselben Grund umgestellt werden, bevor er lief.
Geplant war eine verfälschte Bedingung in `stmtSearchBook`; gemessen kommt aber
weder `treffer` noch `vorkommen_gesamt` aus diesem Statement, sondern aus
`stmtSearchCountBook` und `stmtSearchAllBook`. Über die Trefferliste selbst
sichert `tests/golden/search.ts` inhaltlich nichts zu. Beide Lücken sind älter
als der Umbau, und beide wären ohne den Fehlereinbau unentdeckt geblieben.

**Geschlossen wurden sie noch am selben Tag, in einem eigenen Schritt und aus
einem konkreten Grund.** Nicht als allgemeine Testpflege: Beide saßen auf
`handleOriginal` und `handleSearch`, also auf zwei der fünf Handler, die als
Nächstes in eigene Dateien umziehen sollen, und der Nachweis dieses Umzugs
stützt sich auf dieselben Bündel. Eine Absicherung, die genau dort blind ist, wo
gleich geschnitten wird, ist keine Absicherung.

Neun Zusicherungen kamen dazu, die Messlatte ging von 466 auf 475. Für die
NT-Vorgabe ist 1Joh 5,7 gewählt, die eine Stelle, an der die drei NT-Editionen
weit auseinandergehen: Der Mehrheitstext liest dort fünf Wörter, der Textus
Receptus trägt das Comma Johanneum und kommt auf 22. Eine verrutschte Vorgabe
bricht deshalb zwei Zusicherungen statt einer, und die Zahl sagt sofort, wohin
sie verrutscht ist. Für die Suche geprüft werden beide Wege, mit Buchfilter und
ohne: dass jeder gelistete Vers im gesuchten Buch steht und dass jeder den
Treffermarker trägt. Gegenprobe: Die zwei Einbauten, die vorher grün blieben,
werden jetzt beide rot, der zweite auch in seiner aritätserhaltenden Fassung.

Die AT-Vorgabe war übrigens die ganze Zeit gedeckt, ohne dass es jemand
aufgeschrieben hatte: Der Psalmvers im selben Bündel wird ohne `texttyp`
abgerufen und sichert `wlc` zu. Nur die NT-Seite fehlte.

**Die drei Startgarantien der CI liefen zum ersten Mal von Hand.** `lint.yml`
prüft drei Zustände, die kein lokaler Test berührt: keine Datenbank, leere
Datei, HTTP-Modus ohne Daten. Alle drei greifen ausschließlich auf stderr des
bewegten Blocks zu. Sie sind vor der Meldung „grün" lokal nachgestellt worden,
über `BIBLE_DB_PATH` auf Attrappen statt an der echten Datenbank. Wer diesen
Block künftig anfasst, fährt sie mit; die vier üblichen Läufe sehen davon
nichts.

---

## 2026-08-05: Erst die Absicherung je Werkzeug, dann der Schnitt, und nur beim Zustandsfreien

`server.ts` war auf 4974 Zeilen in 31 Abschnitten gewachsen. Der Umbau ist in
zwei Schritten gelaufen, und die Reihenfolge trägt die Begründung: zuerst die
Tests je Werkzeug, dann drei Module.

**Warum in dieser Reihenfolge.** Die Golden-Tests zerlegten die Ergebnisse eines
Laufs **positionsweise** in eine Liste von Namen, abgesichert allein durch eine
Typzusicherung auf die Länge. Ein eingeschobener Fall verschob jeden Namen
darunter, lautlos: Der Test prüfte dann eine andere Antwort und bestand womöglich
trotzdem. Diese eine Absicherung war zum Zeitpunkt des Umbaus **selbst schon
auseinandergelaufen**, der Cast nannte 47 bei 46 Aufrufen. Er prüfte zur Laufzeit
nichts.

Ersetzt durch benannte Aufrufe: Die Ergebnisse kommen über einen Mapped Type
(`{ [K in keyof C]: ToolResult }`) auf denselben Schlüsseln zurück. Eine
Index-Signatur hätte es nicht getan, sie fiele unter `noUncheckedIndexedAccess`
auf `| undefined` zurück. Gemessen: Ein vertippter Schlüssel ist seither ein
Übersetzungsfehler, wo vorher eine stille Verschiebung stand.

**Ein Prozess oder einer je Bündel?** Gemessen kostet ein stdio-Serverstart
0,27 bis 0,30 Sekunden (drei Läufe, vor und nach dem Umbau gleich). Zwölf Bündel
mit eigenem Start wären rund 3,5 Sekunden gegen 0,88 vorher. Die Fragilität lag
aber nie an der Zahl der Prozesse, sondern an der Positionsbindung. Der
Aggregator gruppiert die Bündel deshalb nach ihrer Umgebung und fährt je Gruppe
einen Prozess: zwei, genau wie vorher. Jede Bündeldatei bleibt trotzdem einzeln
lauffähig, damit ein eingebauter Fehler dort rot wird, wo man ihn sucht.

**Was der Schnitt der Module gekostet hat: nichts, und das ist der Punkt.** Jeder
bewegte Bezeichner ist an seiner Aufrufstelle typgeprüft, der Compiler sichert
den Schnitt also ab. Herausgezogen sind nur zustandsfreie Blöcke:
`morphology.ts` (die drei Kodierschemata), `verse-budget.ts` (hängt allein an der
Registry) und `greek-diff.ts`. `crossCheckVariant` ist mitgegangen, obwohl es nach
einer Datenabfrage aussieht: Es bekommt die Editionstexte als Parameter und liest
selbst nichts (nachgemessen, `stmtTagnt` steht nur beim Aufrufer im Handler).
Bliebe es zurück, importierte `server.ts` drei Bezeichner für einen einzigen
Aufrufer. `server.ts` hat danach 4417 Zeilen in 26 Abschnitten.

**Belegt wurde das nicht über die Zahl, sondern über eingebaute Fehler.** Eine
gleichbleibende Zahl von Zusicherungen beweist nicht, dass sie noch etwas
greifen: Eine ins Leere greifende Zusicherung zählt weiter mit. Sechs Fehler
wurden nacheinander eingebaut, jeder musste in einer **vorab benannten** Datei
rot werden, und alle sechs taten es. Zwei Nebenbefunde daraus stehen unten unter
„Was die Tests nicht sehen".

**Was die Tests nicht sehen.** Der Fehlereinbau hat zwei Lücken gefunden, beide
älter als der Umbau. Der Klammerhinweis der Suche war von keiner Zusicherung
gedeckt: `bracketHints` läuft an drei Stellen, geprüft war nur die des
Nachschlagens. Der vorgeschlagene Einbau (Hinweis aus allen Treffern statt aus
den ausgelieferten Versen) wäre grün geblieben. Er ist jetzt gedeckt, und zwar
nur mit der Ausgabe, die Klammern **und** eine Wortlaut-Grenze führt: 1925 Verse
mit Klammerwort in der 2000er gegen 137 in der Menge-Bibel, die keine Grenze hat.
Zweite Lücke: Die Faltung des Schlusssigma in `normForCompare` lässt sich
verfälschen, ohne dass eine Zusicherung anspringt; die geprüften Vergleichsverse
unterscheiden sich an keiner Stelle nur darin.

---

## 2026-08-05: Eine Grenze, die eine Zusage einhält, gehört an die Ausgabe und nicht an den Server

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
des Briefes am 05.08.2026.

**Die eine Stelle, die kein Typfehler ist.** In `bible_search` liest der
Klammerhinweis die Datenbankzeilen, und deren `text` bleibt eine Zeichenkette,
auch wenn die Antwort ihn nicht ausliefert. Ohne Umstellung warnte die Antwort
vor Klammern in Versen, die sie nicht enthält, und der Typecheck sagte nichts
dazu. In `bible_crossrefs` fängt er dieselbe Verwechslung, weil das bedingte Feld
dort als `text?: string` inferiert (mit `tsc --strict` geprüft): Der naive Zugriff
scheitert mit TS2345, der `typeof`-Filter geht durch.

**Die Grenze gilt je Abruf, und das ist die Zusage, nicht ein Versäumnis.** Dass
ein Modell mehrfach abrufen und ein Kapitel zusammensetzen kann, ist bekannt und
entschieden (05.08.2026): Der Brief sagt „jeder Abruf höchstens 20 Verse", nicht
eine Sitzungssumme. Eine Drosselung über Abrufe hinweg bräuchte Zustand, den der
HTTP-Modus bewusst nicht führt, und die Zusage verlangt sie nicht. Was bleibt:
Keine Antwort fordert zum Nachladen des Rests auf.

**Der Anmerkungsapparat bekommt ein eigenes Budget derselben Größe.** Ob
Notentext als „Verse im Wortlaut" zählt, ist mit dem Verlag nicht geklärt.
Zwei Vorkehrungen beantworten die Frage nicht, machen sie aber folgenlos: Die
Noten werden aus dem bereits gekürzten Versbestand abgeleitet, und sie zählen
zusätzlich gegen ein zweites Budget. Der Apparat kann die Grenze also auch dann
nicht sprengen, wenn sie später bejaht wird. Eine zweite, frei erfundene Zahl
gibt es dafür nicht: Das Budget hat dieselbe Größe wie das der Verse, damit die
Registry weiterhin die einzige Stelle bleibt.

Gemessen greift es nie: 1220 Noten, höchstens 15 je Kapitel, 12 innerhalb der
ersten 20 Verse, 3 je Vers. Damit ist es Vorsorge wie `MAX_VERSES_LENGTH`, und
wie dort gibt es aus demselben Grund keinen Testfall: Er ließe sich mit diesen
Daten nicht herstellen.

**Ein leerer `text` in `bible_crossrefs` ist entfallen.** Findet sich zu einem
kapitelübergreifenden Ziel kein Vers in der gewählten Übersetzung, stand dort
seit je `""`. Seit die Grenze dasselbe Feld weglassen kann, stünden zwei
Bedeutungen nebeneinander, und die eine sähe aus wie die andere. Jetzt fehlt das
Feld in beiden Lagen. Der leere String war nie eine Aussage: Er sagte nicht, dass
der Vers fehlt, und auch sonst nichts.

---

## 2026-08-05: Der Anmerkungsapparat einer Ausgabe ist ein eigenes Feld, und die Registry ist keine Deklaration

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
Aufruf zu entscheiden, welches gilt. Hinzu kommt, dass die Lieferung in einer
anderen Versifikation zählt als der übrige Bestand (siehe unten): Ihre
Verweisziele stimmten mit den vorhandenen nicht überein.

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
alle 1220 haben die Form „K,V", und alle 1220 Ziele existieren als Vers
(gemessen 05.08.2026).

**Der Parser braucht eine Deny-Liste, und das ist der Fund, den eine
Gesamtsumme nicht hergibt.** 3885 der 31 171 Verse (12,5 %) überspannen eine
`<para>`-Grenze. Dazwischen liegen in fünf Fällen Dinge, die nicht zum Vers
gehören: Abschnittsüberschriften (Apg 9,19, Jes 59,15) und Sprecherangaben
(Hld 7,1, 7,10, 8,5). Wer „alle Textknoten zwischen `sid` und `eid`" einsammelt,
liefert die Überschrift als Verstext aus, und die Verszahl stimmt dabei. Nicht
auf der Liste steht `d`, die Psalmüberschrift (11 Fälle): Die deutsche Zählung
dieser Ausgabe führt sie als Vers 1, sie gehört hinein. Gegengeprüft wird gegen
`versification.vrs` der Lieferung, 1189 Kapitel, keine Abweichung.

**`fussnoten` steht nicht in `required`.** Es erscheint an 1134 von 31 171
Versen, rund 3,6 %. Damit hat `bible_lookup` zwei bedingte Felder statt einem;
die Tabelle im Eintrag vom 02.08.2026 nennt nur `hinweis` und ist insoweit
überholt. Die Auszählung steht am Schema, je ein Fall im Golden-Test. Auch die
Zahl beim Klammerhinweis hat sich bewegt: zu den 137 Menge-Versen kommen 1925
der neuen Ausgabe.

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
Verse führen, die Luther nicht hat. Stand 05.08.2026 vormittags: 582 Aufrufe,
578 geprüft, 0 Schemafehler; nach dem Anmerkungsapparat und der Wortlaut-Grenze
desselben Tages 597 Aufrufe und 593 geprüft.

Das gilt nicht nur für die neue Ausgabe. Menge zählt seit je ebenso, und
`books.chapters` stammt aus dem Luther-Lauf und führt Joel mit 3 und Maleachi
mit 4: für Menge heute schon falsch. Umgerechnet wird nichts, jede Ausgabe
behält ihre Zählung.

---

## 2026-08-03: Die Origin-Prüfung steht jetzt vorn, und `/mcp` hat eine Methodenweiche

Nachlese zum 405-Fund vom selben Tag. Weil jener Fehler dort saß, wo eigener
Code eine Anfrage abfängt, **bevor** das SDK sie sieht, wurde diese Zone
vollständig durchgemessen. Sie umfasst sechs Stellen: `OPTIONS`, `/health`,
Fremdpfade, Origin-Prüfung, die Methodenbehandlung und `noteProtocolVersion`.

Die Spec-Konformität selbst war in Ordnung: Vorschrift für Vorschrift geprüft
(Benachrichtigung 202, fehlender `Accept` 406, fehlerhaftes JSON 400, unbekannte
Protokollrevision 400, unbekannte Pfade 404) stimmte alles, und das meiste davon
leistet das SDK. Drei Abweichungen lagen ausschließlich im eigenen Vorfeld.

### Die Prüfung galt nicht für den Pfad, den ein Fremder zuerst probiert

`/health` wurde beantwortet, bevor der Origin geprüft war. Damit konnte eine
beliebige Webseite per JavaScript erfahren, dass auf einem lokalen Port dieser
Server läuft, und seinen Zustand samt Störungsgrund auslesen. Die Spezifikation
verlangt die Prüfung „on all incoming connections"; sie stand hinter zwei
Weichen.

Die Prüfung ist deshalb an den Anfang des Handlers gewandert und erfasst damit
in einem Schritt `/health`, die Vorabanfrage und unbekannte Pfade.

**Die Lage ist dabei beinahe invertiert, und das ist der Teil, der für künftige
Entscheidungen zählt.** Am öffentlichen, authlosen Endpunkt schützt die
Origin-Prüfung fast nichts: Es gibt keine Anmeldung, die eine fremde Seite im
Namen eines Nutzers missbrauchen könnte, und der Dienst steht ohnehin jedem
offen. Dort ist sie überwiegend ein Ausfallrisiko, denn ein Broker, der eines
Tages einen `Origin` schickte, liefe in 403, ohne dass irgendein Log es sagte.
Ihr Wert liegt beim lokalen Betrieb, den `MCP_HTTP_PORT` jederzeit erlaubt, und
genau dort hatte sie ihr Loch. Sie saß am schwächeren Ende scharf und am
stärkeren durchlässig.

Die Antwort auf beides ist verschieden: vorn die Prüfung schließen, hinten die
erlaubten Herkünfte im Betrieb vorsorglich eintragen.

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

Jetzt entscheidet eine Weiche im eigenen Handler: alles ausser `POST` und
`OPTIONS` bekommt 405 mit `Allow: POST, OPTIONS`. Die Methodenlisten stehen als
`METHODS_MCP` und `METHODS_HEALTH` an genau einer Stelle und speisen beide
Kopfzeilen, damit sie nicht wieder auseinanderlaufen können. `withCors` bekam
dafür einen Pflichtparameter ohne Vorgabewert: Ein Default hätte genau den
Fehler konserviert, den die Aufteilung behebt.

**Damit ist die Entscheidung von 0.5.13 zu `DELETE` umgekehrt.** Sie lautete,
es beim 200 des SDK zu belassen, weil die Spezifikation dort nur ein MAY kennt.
Das stand unter der Annahme, dass keine Kopfzeile etwas Gegenteiliges behauptet;
mit einer Methodenliste je Pfad gilt sie nicht mehr. Ein Server ohne Sitzung hat
nichts zu beenden, und 405 ist ausdrücklich erlaubt.

Dazu, klein und derselben Art: `/health` nahm jede Methode an und antwortete
mit 200, ein `DELETE` eingeschlossen. Jetzt `GET`, `HEAD` und `OPTIONS`, sonst
405.

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

Bis dahin prüfte `test-golden.ts` alles, was der Server *sagt*, und nichts
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

## 2026-08-03: `GET /mcp` antwortet 405, weil die 200 eine Wiederverbindungsschleife fütterte

Vom 1. August an zeigte die Nutzungsansicht ein Plateau, das kein Nutzungsprofil
ist: über elf Stunden am Stück eine gleichbleibende Rate, fast ausschließlich
Status 200. Der naheliegende Verdacht war ein Bot, der den authlosen Endpunkt
gefunden hat, und die naheliegende Antwort eine Sperre. Beides war falsch.

### Was gemessen wurde

Am 03.08.2026 am laufenden Dienst, gegen die Zähler von `cloudflared` und die
Sicherheitsansicht der Zone:

| Größe | Wert |
|-------|------|
| Anfragerate, laufend | 56 Anfragen in 60 s, also 0,93 je Sekunde |
| Methoden binnen 24 h | **GET 41 430**, POST 389, DELETE 2 |
| Status 404 | 22 von 106 466 |
| Von Cloudflare abgewehrt | 7 von 41 820 |
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

Nebenbefund, der die Betriebsdoku berührt: Von 41 820 Anfragen hat die
Ratenbegrenzung **7** abgewehrt. Sie wirkt gegen Stöße, wie beim Setzen
nachgewiesen, aber das reale Aufkommen lag stets unter ihrer Schwelle. Für dieses
Plateau war sie nie zuständig.

### Warum die frühere Begründung fiel

An der Stelle stand, 200 sei die gemessene Angleichung an den einzigen
nachweislich funktionierenden fremden Connector. Das war eine Beobachtung an
fremdem Gerät (n=1) und nie ein Beleg, dass claude.ai die 200 **braucht**; die
Fehlersuche-Anleitung von Claude nennt 405 beim Erreichbarkeitstest ausdrücklich
als unbedenklich. Was fehlte, war der Preis der Vorsicht, und der ist jetzt
beziffert: rund 40 000 Anfragen am Tag ohne jede Nutzlast.

`Allow: POST, OPTIONS` gehört zwingend dazu, RFC 9110 verlangt den Kopf bei 405.
Er ist zugleich die eigentliche Auskunft an den Aufrufer: nur POST, absichtlich
so. Der Wert weicht von der früher hier notierten Empfehlung
`Allow: GET, POST, DELETE` ab, weil GET nun eben nicht mehr erlaubt ist.

---

## 2026-08-02: Ein Aufruferfehler ist kein interner Fehler, und `McpError` ist der falsche Weg dorthin

Bis 0.5.10 verließ jede Ablehnung, die über den JSON-RPC-Kanal ging, den Server
als `-32603 InternalError`: unbekanntes Werkzeug, unbekannter Prompt, fehlendes
Prompt-Argument, jede fehlerhafte Ressourcen-URI. Gemessen am 02.08.2026 gegen
frische Prozesse, stdio und HTTP, in beiden Transporten gleich. Die Ursache war
kein Versehen an einer Stelle, sondern die Voreinstellung des SDK:
`protocol.js:397` reicht das Feld `code` eines geworfenen Fehlers durch, wenn es
eine ganze Zahl ist, und fällt sonst auf `InternalError` zurück. Ein nacktes
`new Error` bekommt also den Code für „der Server hat einen Defekt", auch wenn
die Anfrage der Grund war.

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
gewesen, wie es `server/mcp.js` tut. Gemessen am 02.08.2026 gegen einen
Probe-Server auf demselben SDK:

| geworfen | am Draht |
|---|---|
| `new McpError(-32602, "Die Meldung.")` | `{"code":-32602,"message":"MCP error -32602: Die Meldung."}` |
| `Object.assign(new Error("Die Meldung."), { code: -32602 })` | `{"code":-32602,"message":"Die Meldung."}` |

Der Konstruktor setzt `super("MCP error <code>: " + message)`
(`types.js:2031`), und der empfangende 1.x-Client stellt beim Wiederaufbau ein
zweites Präfix voran (`protocol.js:459`). Diese Meldungen sind aber zeichengleich
mit denen der Werkzeuge, absichtlich und getestet. Deshalb `rpcError()` in
`werkzeug-helfer.ts`, nicht `McpError`. Die exakten Meldungsvergleiche im Golden-Test
sind der Schutz davor, dass jemand später doch umstellt.

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
einem Rat, der hier nicht hilft. Gemessen am 02.08.2026 an zwei Fehlerarten
(unbekanntes Buch, zu wenige Segmente); ein gültiger Abruf funktioniert
unverändert, Prompts und Werkzeuge sind nicht betroffen. Der einzige geänderte
Faktor ist der Code, die Texte sind zeichengleich geblieben.

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

### Nicht geändert: `DELETE` antwortet weiter mit 200

Aus demselben Anlass geprüft. Das 200 stammt nicht aus diesem Repo, sondern aus
dem Transport des SDK (`webStandardStreamableHttp.js:565 ff.`): Im zustandslosen
Betrieb entfällt die Sitzungsprüfung, `close()` läuft, 200. Die Spezifikation
führt 405 hier nur als **MAY** („The server MAY respond to this request with
HTTP 405"), verlangt also nichts. Bei `GET` verlangt dieselbe Stelle ein MUST
(`text/event-stream` oder 405), und dort stand dieser Server bewusst auf 200,
weil das die gemessene Angleichung an claude.ai ist. Den weicheren Fall aus
Formtreue umzubauen, während der härtere aus Vorsicht bleibt, wäre die
inkonsistenteste der drei Kombinationen.

**Vollständig überholt am 03.08.2026**, siehe die beiden Einträge von diesem
Tag. `GET` steht auf 405, weil die 200 nachweislich eine
Wiederverbindungsschleife fütterte; `DELETE` steht seit der Methodenweiche
ebenfalls auf 405. Die Abwägung hier ist damit nicht widerlegt, sondern ihre
Prämisse ist entfallen: Sie ging davon aus, dass keine Kopfzeile etwas
Gegenteiliges behauptet, und seit `access-control-allow-methods` je Pfad gesetzt
wird, tut genau das eine. Auch der damals notierte Wert
`Allow: GET, POST, DELETE` gilt nicht mehr; der Endpunkt meldet
`Allow: POST, OPTIONS` auf `/mcp` und `GET, HEAD, OPTIONS` auf `/health`.

---

## 2026-08-02: Ressourcen liegen in Vorlagen, weil die Liste sonst der Katalog wäre

Die dritte MCP-Primitive ist die einzige, die dem **Nutzer** eine Geste gibt: ein
Kapitel anhängen, statt darauf zu hoffen, dass ein Werkzeugaufruf zustande kommt.
Der Fehlgriff, den das adressiert, ist gemessen (25.07.2026, „Hesekiel-Zusatz
1,1": kein Aufruf, Antwort aus dem Gedächtnis).

### Was die Liste kostet

`resources/list` geht bei jedem Sitzungsbeginn über die Leitung, und diese
Datenbank führt 31 102 Verse in 1190 Kapiteln. Gemessen gegen einen frischen
`bun run server.ts`, Zeichenzahl des `result`-Objekts:

| Methode | vorher | jetzt |
|---|---|---|
| `tools/list` | 14 969 | 15 171 |
| `prompts/list` | 972 | 972 |
| `resources/list` | 44 (Fehler −32601) | 939 (vier Einträge) |
| `resources/templates/list` | 44 (Fehler −32601) | 947 (drei Vorlagen) |

`tools/list` wächst um 202 Zeichen, weil `bible_server_info` ein Feld mehr
deklariert (siehe unten).

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
8600 Token. Der Grundtext steht deshalb je Vers und
nicht je Kapitel: Die Grenzkosten von `bible_original` betragen **161 Zeichen je
Wort** (Offb 20,1 byzantinisch, 19 Wörter: 3977 Zeichen; Offb 20,4, 59 Wörter:
10 434; fester Anteil 910), und das größte Grundtext-Kapitel hat 1285 Wörter
(`tr`, Joh 6), also rund 208 000 Zeichen. Der größte Vers hat 59 Wörter.

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

**Gemessen am 02.08.2026 in Claude Code, eine Sitzung, ein Beobachter:** Die
`@`-Vervollständigung listet neben den vier festen Einträgen auch die drei
Vorlagen, geschrieben als Präfix (`claude.ai Bibelstudium MCP:bible://kapitel/`),
die Variablen stehen in der Beschreibung. Ein Kontrollserver mit genau einer
festen Ressource und einer Vorlage zeigt dasselbe Bild; seine Vorlage steht
ausschließlich in `resources/templates/list`, also ruft dieser Client beide
Methoden ab. Angezeigt heißt aber nicht angehängt, und das ist die eigentliche
Auskunft dieser Messung: Beim Kontrollserver kam `@spike-resources:spike://statisch`
mit vollem Inhalt beim Modell an, `@spike-resources:spike://vorlage/testwert`
unmittelbar danach nur als getippte Zeile, obwohl der Server beide liest. An
diesem Server über HTTP dasselbe Bild, unter einem lokal vergebenen Namen ohne
Leerzeichen: `@bibelstudium:bible://quellen` kam vollständig an,
`@bibelstudium:bible://kapitel/LUT/Psalter/23` gar nicht. Die Geste, die in den
Vorlagen steckt, ist über `@` also nicht erreichbar, auf beiden Transporten.

Zweierlei kommt hinzu. Das Werkzeug, mit dem das Modell selbst Ressourcen
auflistet, liefert bei beiden Servern nur `resources/list`; dort sieht es die
Vorlagen ebenfalls nicht. Und der Name entscheidet mit: Als Connector heißt
dieser Server `claude.ai Bibelstudium MCP`, das Präfix setzt der Client (die
übrigen heißen `claude.ai Gmail`, `claude.ai Google Drive`,
`claude.ai Google Calendar`). Wegen der Leerzeichen setzt die Vervollständigung
ein öffnendes Anführungszeichen, das die dokumentierte Form nicht kennt
(`@server:protocol://resource/path`), und so kam auch die feste URI
`bible://quellen` in vier Versuchen nicht an. Unter dem kurzen Namen, gleicher
Endpunkt, gleicher Transport, kam sie an. Wer die vier festen Ressourcen
anhängen will, trägt den Endpunkt also lokal unter einem Namen ohne Leerzeichen
ein, statt den Connector zu benutzen. Ein frisch eingetragener Server wird
zudem erst nach einem Neustart der Sitzung wirksam; der erste Versuch lief
deshalb ins Leere und sah aus wie ein Fehlschlag des Namens.

**Nicht belegt:** wie Claude Desktop und claude.ai Ressourcen in der Oberfläche
anbieten.

Daraus folgt ein Feld, kein Verzicht: `bible_server_info` nennt jetzt die vier
URIs und die drei Vorlagen. Die vier festen Einträge stehen in `resources/list`
und werden von einem Client mit Ressourcen-Anzeige gefunden; die Vorlagen, in
denen die eigentliche Geste steckt, stehen in einer eigenen Methode, die die
Oberfläche zwar abruft, das Ressourcen-Werkzeug des Modells aber nicht.
`bible_server_info` ist der eine Kanal, der das
Modell nachweislich erreicht, und genau dafür wurde es gebaut, weil
`instructions` aus dem Handshake es nicht tut (26.07.2026). Gekostet hat das
359 Zeichen in der Antwort, 673 im vollständigen `result` und 202 in
`tools/list`. Gespeist wird das Feld aus denselben Konstanten und mit derselben
Datenbank-Sperre wie die beiden Listen, damit eine Instanz ohne Daten hier
nichts nennt, was dort nicht abrufbar ist; zwei Zusicherungen halten die
Gleichheit fest. Das ist nicht die Gegenrichtung zur verworfenen Ressource
`bible://server`: Dort ging es darum, die Fassung als Ressource auszuliefern,
hier darum, die Ressourcen in der Auskunft zu nennen.

Der Hilfeartikel zu lokalen MCP-Servern nennt nur Werkzeuge und Connectors. Das
MCPB-Manifest bleibt deshalb ohne Hinweis auf die Anhänge-Geste; sein Text steht
im Installationsdialog von Claude Desktop und darf dort nichts versprechen, was
dieser Client womöglich nicht kann. Ein `resources`-Array kennt das
MCPB-Schema ohnehin nicht („Resources are not included in the manifest because
MCP resources are inherently dynamic").

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

## 2026-08-02: Zwei Prüfarten für die Schemata, weil keine allein reicht

Seit 0.5.8 ist eine Erfolgsantwort ohne `structuredContent` kein unvollständiges
Ergebnis mehr, sondern ein harter Fehler beim Client. Der Golden-Test deckt die
Fälle in seiner `CALLS`-Liste ab; dazwischen liegt jeder selten genommene
Rückgabepfad. `tests/schema-coverage.ts` (`bun run test:schemas`) prüft deshalb
in die Breite: 420 Aufrufe, deterministisch gezogen (jeder 700. Luther-Vers
durch alle Werkzeuge, alle vier Übersetzungen, alle drei NT-Editionen, dazu die
neun NT-Verse ohne TAGNT-Zeile), jede Antwort gegen das `outputSchema` aus
`tools/list`.

Erster Lauf am 02.08.2026: 416 gültig, **0** Schemafehler, **0** Erfolgsantworten
ohne `structuredContent`, **0** Abweichungen zwischen Textblock und Struktur.
`required` ist damit auch dort nicht zu streng, wo es teuer wäre: Joh 7,53 steht
im Mehrheitstext, hat aber keine TAGNT-Zeile und liefert korrekt eine Antwort
ohne `bezeugung`.

Der eigentliche Befund ist aber die Arbeitsteilung. Die Breite fand keinen
einzigen Klammerhinweis von `bible_lookup`, und konnte es nicht: Klammern gibt es
in 137 von 31 166 Menge-Versen. Ein Zufallslauf findet falsche Typen und
vergessene Pfade, die benannte Liste findet das seltene Feld. Deshalb läuft der
Breitentest **nicht** bei jedem Commit (rund eine Minute, braucht die Datenbank),
sondern nach Änderungen an einem Schema oder einer Nutzlast, und die Ausgabe
nennt je Werkzeug die gesehenen Felder: Was dort fehlt, braucht einen benannten
Fall im Golden-Test.

Beide teilen sich den Prüfer in `tests/schema-validator.ts`. Er kann nur die
Teilmenge von JSON Schema, die hier vorkommt, und das ist Absicht: alles darüber
wäre ungeprüfter Code, der geprüften Code bewacht. `ajv` läge als transitive
SDK-Abhängigkeit bereit und wäre als devDependency vertretbar (die Laufzeit
bliebe bei einer Abhängigkeit), nur zu 95 Prozent ungenutzt. Dass der Prüfer
nicht alles durchwinkt, ist die eine Aussage, die er über sich selbst nicht
treffen kann; sie steht als fünf bekannt kaputte Antworten im Golden-Test, seit
dem 05.08.2026 im Bündel `tests/golden/search.ts` (dort liegt die echte Antwort,
an der sie gemessen werden). Die „rund eine Minute" ist überholt: Der Breitentest
läuft in 1,3 Sekunden und prüft inzwischen 593 Antworten.

---

## 2026-08-02: Was am laufenden 0.5.8 ankommt, gemessen an drei alten Fehlgriffen

Erster Durchgang gegen den öffentlichen Endpunkt, nachdem die Schemata live
waren. Drei Fragen, ausgewählt nach Fällen, die vorher nachweislich schiefgingen.

**Was ankommt.** Die Nutzlast erreicht das Modell **einmal**, nicht zweimal: Der
Client zeigt die Struktur und verwirft den Textblock (kompaktes JSON statt der
eingerückten Fassung, die der Server als Text baut). Der Aufschlag von 63 bis 80
Prozent bleibt damit auf der Leitung und belastet das Kontextfenster nicht. Zwei
Clients, ein Durchgang je Frage.

**Was richtig war.** Die Zahlentrennung (`treffer` 20 gegen `vorkommen_gesamt`
22) samt einer abgeleiteten Zusatzangabe, die stimmte (Joh 10,12 trägt
tatsächlich drei Vorkommen). Der Quellenkonflikt zu Mk 14,46 wurde wiedergegeben,
einschließlich des Satzes, dass der Editionstext maßgeblich ist; genau der fehlte
am 25.07.2026. Die zehn Querverweise zu Joh 11,25 kamen mit korrekten
Stimmenzahlen und die drei mehrversigen Ziele vollständig aus `verse_einzeln`,
ohne eingebettete Versnummern.

**Was nicht belegt ist.** Dass die Schemata das bewirkt haben. Es gibt keinen
Vergleichslauf gegen 0.5.7, und n = 1 je Frage. Belegt ist nur: nichts wurde
schlechter, die kritischen Felder werden benutzt, die Doppelung kostet keinen
Kontext.

**Was übrig blieb, und wohin es ging.** Zwei Abweichungen, beide clientseitig und
deshalb als Regeln in `docs/anweisungen/claude-desktop.txt`: Die `nennung` wurde
auf „OpenBible.info" gekürzt, ohne die Adresse, die bei CC BY zur Bedingung
gehört. Und die Variante ἐπέβαλον/ἐπέβαλαν bekam mit „alternative Aorist-Endung"
eine grammatische Benennung, die in keinem Feld steht. Sie trifft hier zu, ist
aber dasselbe Muster wie das falsche „bewegliche Ny" vom 25.07.2026: eine
Erscheinung benennen, die die Daten nicht nennen.

---

## 2026-08-02: Ausgabeschemata von Hand, und warum `required` die teuerste Zeile ist

Die sieben Lesewerkzeuge deklarieren seit 0.5.8 ein `outputSchema` und liefern
`structuredContent`. Was daran zu entscheiden war, und was es kostet.

### Was das SDK erzwingt

Gemessen am Code von `@modelcontextprotocol/sdk` 1.29.0 (deklariert ist
`^1.25.1`):

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

### Welche Felder bedingt sind (gemessen 02.08.2026)

| Werkzeug | fehlt bedingt | Beleg |
|---|---|---|
| `bible_lookup` | `hinweis` | nur bei Klammerwörtern; Menge hat 137 solche Verse, die anderen drei keine |
| `bible_original` | `woerter[].strong` | 137 554 von 137 554 SBLGNT-Wörtern ohne Strong-Nummer, WLC 5951 ohne, byzantine 0 ohne |
| `bible_crossrefs` | `verse_einzeln`, `lesehinweis`, `hinweis` | `verse_einzeln` nur bei mehrversigem Ziel im selben Kapitel |
| `bible_concordance` | sechs Lexikonfelder, `hinweis` | `hinweis` nur bei gekürzter Liste: G26 mit `limit=50` hat ihn, mit `limit=200` nicht |
| `bible_search` | `vorkommen_gesamt`, `verteilung` | beide entfallen oberhalb `OCCURRENCE_SCAN_LIMIT`, gemessen an „der" mit 13 033 Treffern |
| `bible_compare` | `warnung`, `quellenkonflikte`, `bezeugung` | `bezeugung` fehlt bei **9** NT-Versen ohne TAGNT-Zeile, darunter Joh 7,53 |
| `bible_server_info` | `daten_stand`, `hinweis` | |

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

Der Wächter ist deshalb der Golden-Test. Er prüft jede erfolgreiche Antwort
gegen das deklarierte Schema **und** darauf, dass `structuredContent` und
Textblock denselben Wert tragen. Sein Validator kann nur die hier benutzte
Teilmenge von JSON Schema; ajv als `devDependency` wäre unbedenklich gewesen und
wäre nur zu 95 Prozent ungenutzt geblieben. Wichtiger: Der Validator wird selbst
gegen fünf bekannt kaputte Antworten geprüft. Ein Validator, der versehentlich
alles durchwinkt, verhält sich exakt wie ein bestandener Test.

### Was es kostet (gemessen 02.08.2026, `JSON.stringify` über stdio)

`tools/list` wächst von **7201 auf 14969 Zeichen** (+107,9 %), je Werkzeug
zwischen 399 (`bible_lookup`) und 2048 Zeichen (`bible_compare`). Eine Antwort
wächst um 63,4 bis 79,5 Prozent, weil die Nutzlast zweimal übertragen wird
(`bible_concordance` G26: 8484 → 13877 Zeichen). Unter 100 Prozent bleibt der
Zuwachs, weil der Textblock eingerückt ist und `structuredContent` kompakt geht.

Die Spezifikation formuliert die Doppelung als SOLLTE. Weggelassen wird sie
trotzdem nicht: Ein Client, der `structuredContent` nicht anzeigt, bekäme sonst
eine leere Antwort.

### Was ausdrücklich nicht belegt ist

Ob Claude Desktop oder claude.ai `structuredContent` dem Modell überhaupt
zeigen, ist **nicht gemessen**, und ebenso wenig, ob eine `description`
**innerhalb** eines Ausgabeschemas beim Modell ankommt. Belegt ist nur die
Wirkung der `description` **am Werkzeug** (der Fall „Hesekiel-Zusatz",
25.07.2026); das ist eine andere Stelle im Protokoll. Dieser Server hat dieselbe
Annahme schon einmal teuer bezahlt: `instructions` und die Version stehen im
`initialize` und erreichen das Modell nicht, weshalb es `bible_server_info` gibt.

Die Protokollfassung der realen Aufrufer ist ebenfalls nicht belegt. Der Logger
aus 0.5.6 lag zum Zeitpunkt dieser Entscheidung noch nicht auf dem Endpunkt, und
er misst konstruktionsbedingt nur den HTTP-Pfad: `noteProtocolVersion()` wird in
`serveHttp()` aufgerufen, ein Client über das MCPB-Bundle spricht stdio und
erscheint dort nie.

---

## 2026-07-28: Protokollversionen werden protokolliert, statt auf ein Datum zu warten

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

Gemessen am 28.07.2026 gegen frische HTTP-Server in vierzehn Fällen, darunter:
Legacy-`initialize` ohne Kopfzeile, drei Folgeanfragen ohne zweite Zeile, eine
zweite Legacy-Version, moderne Anfrage mit `_meta`, unparsbarer Rumpf mit
anschließend funktionierendem Lookup, 30 moderne Fantasieversionen, 30
Legacy-Fantasieversionen gegen den Deckel, sowie drei Versuche,
Personenbezogenes ins Journal zu bekommen (E-Mail-Adresse und Klarname als
Protokollversion in Kopfzeile und Rumpf, Klarname als Client-Name). Keiner
davon erschien im Log.

## 2026-07-28: Für Clients beider Ären bleiben wir als alter Server erkennbar, und das hängt an einer Fehlernummer

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

Gemessen am 28.07.2026 gegen einen frischen HTTP-Server.
