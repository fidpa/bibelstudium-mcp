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

**Nicht belegt:** wie Claude Desktop und claude.ai Ressourcen in der Oberfläche
anbieten, und ob irgendein Client `resources/templates/list` anzeigt.

Daraus folgt ein Feld, kein Verzicht: `bible_server_info` nennt jetzt die vier
URIs und die drei Vorlagen. Die vier festen Einträge stehen in `resources/list`
und werden von einem Client mit Ressourcen-Anzeige gefunden; die Vorlagen, in
denen die eigentliche Geste steckt, stehen nur in einer Methode, die seine
Oberfläche womöglich nie abruft. `bible_server_info` ist der eine Kanal, der das
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
treffen kann; sie steht als fünf bekannt kaputte Antworten in `test-golden.ts`.

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
