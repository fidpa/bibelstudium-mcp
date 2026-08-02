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
