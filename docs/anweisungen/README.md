# Client-Anweisungen

## Was hier liegt

`claude-desktop.txt` und `claude-desktop.md` tragen **denselben Text**. Die
`.txt` ist zum Kopieren, die `.md` zum Lesen auf GitHub; wer eine ändert, ändert
beide.

Der Text gehört in Claude Desktop unter *Einstellungen › Anweisungen für
Claude*. Für einen Connector über `claude.ai` gehört er an die entsprechende
Stelle der Projektanweisungen.

## Wozu das gut ist

**Ob ein Werkzeug aufgerufen wird und wie sein Ergebnis wiedergegeben wird,
entscheidet der Client, nicht der Server.** Der Server kann seine Daten nur
anbieten, mit Feldern, Hinweisen und Vorbehalten. Was davon in der Antwort
ankommt, hängt am Modell auf der anderen Seite.

Die Anweisungen schließen diese Lücke: Zitiertreue, Übersetzungsangabe,
Zahlenangaben, und der Umgang mit den Feldern, die eine Aussage einschränken.
Ohne sie funktioniert der Server, aber Zitate werden geglättet, Zahlen geschätzt
und Vorbehalte übergangen.

## Warum jedes Wort hier teuer ist

**Dieser Text wird in jeder Sitzung geladen, auch wenn nie eine biblische Frage
gestellt wird.** Er kostet also nicht dann, wenn er nützt, sondern immer. Das ist
der Unterschied zu jeder anderen Datei in diesem Repository und die einzige
Regel, aus der sich alle folgenden ableiten.

Gemessen am 06.08.2026:

| Posten | Zeichen | wann geladen |
|---|---|---|
| `tools/list` | 21 017 | jede Sitzung mit Connector |
| **diese Anweisungen** | **2 450** | jede Sitzung |
| `instructions` aus dem Handshake | 176 | jede Sitzung |

Am selben Tag von 3526 auf 2228 Zeichen gekürzt, 14 Regeln auf 9, ohne dass eine
Verhaltensregel entfiel; seither 2287, weil die Regel zur Variantenart eine
falsche Zusage enthielt (sie nannte `schreibvariante` und `bedeutungsvariante`
als gesetzt, während sie bei 55,6 % der aufgeführten Formen fehlen), und 2450 mit
der Regel zur Zitierform: `kurzref` sagt durch seinen Namen, was es ist, aber
dass es die Vorlage zum Zitieren ist, sagt allein die Feldbeschreibung im
Ausgabeschema, und
ob die ein Modell erreicht, ist nicht belegt. Die Regel fällt weg, sobald ein
Durchgang zeigt, dass der Client das Feld von selbst nimmt.

## Regeln für das Pflegen dieser Datei

**1. Nichts aufnehmen, was die Antwort selbst schon sagt.** Das ist der größte
Hebel und war die gesamte Ersparnis vom 06.08.2026. Trägt eine Antwort ihre
Handhabung bereits im `hinweis` oder `lesehinweis`, dann steht die Anweisung
genau dann da, wenn sie zutrifft, statt in jeder Sitzung. Eine Regel hier ist
nur nötig für das, was **kein** Feld sagt.

**2. Eine Regel geht auf einen gemessenen Fehlgriff zurück, nicht auf eine
Vermutung.** Jede Zeile im Anweisungstext steht dort, weil ein Modell einmal
etwas anderes getan hat. „Könnte schiefgehen" reicht nicht; sonst wächst die
Datei um Fälle, die nie eintreten.

**3. Keine Begründungen in den Anweisungstext.** Warum eine Regel dasteht, gehört
in `../ENTSCHEIDUNGEN.md` oder hierher, nicht in den Text, den das Modell
dauerhaft mitträgt. Der Anweisungstext sagt, was zu tun ist, nicht warum.

**4. Feldnamen nennen, nicht umschreiben.** „Das Feld `vorkommen_gesamt`" ist
kürzer und eindeutiger als eine Beschreibung desselben Sachverhalts, und das
Modell sieht den Namen in der Antwort wieder.

**5. Verwandte Regeln zusammenlegen.** Vier Regeln über Zitiertreue sind ein
Absatz, nicht vier Aufzählungspunkte. Am 06.08.2026 ließen sich drei Regeln über
einschränkende Felder zu einer zusammenziehen, die die Felder namentlich
aufzählt.

**6. Vor dem Ergänzen zwei Fragen stellen.** Deckt eine bestehende Regel das
schon ab? Und könnte der Server es stattdessen selbst sagen? Eine Ergänzung im
`hinweis` eines Werkzeugs ist fast immer besser als eine Zeile hier.

## Fallstricke

**Ein Beispielwort wird als Etikett aufgegriffen.** Ein konkretes Beispiel in
einem Hinweistext des Servers wurde einmal auf einen unpassenden Fall
übertragen, weil es griffig war und dastand. Dasselbe gilt hier: Ein Beispiel
kostet Platz und wird gelegentlich falsch angewandt. Nur setzen, wo die Regel
ohne es mehrdeutig bliebe.

**Eine Regel, die anderswo stimmt, stimmt hier nicht automatisch.** Die Datenlage
dieses Repositories ist zu prüfen, bevor eine Formulierung übernommen wird:
Klammer-Einschübe gibt es nur in bestimmten Ausgaben, Fußnotenziffern im
Verstext in keiner, Trefferzahlen gelten je Übersetzung. Eine Regel gegen ein
Problem, das die Daten hier nicht haben, ist reine Last.

**Kürzen verschiebt Verantwortung auf den Client.** Regel 1 setzt voraus, dass
der Client die `hinweis`-Felder durchreicht. Für Claude Desktop ist das gemessen,
für beliebige Clients nicht. Wer weiter kürzt, sollte wissen, dass er diese
Annahme vergrößert.

**Telegrammstil spart weniger, als er kostet.** Geschätzte 15 bis 20 Prozent
gegen eine Eindeutigkeit, für die das Dokument da ist. Eine Regel, die kürzer,
aber mehrdeutig ist, hat ihren Zweck verfehlt.

**Der größere Posten liegt in `tools/list`.** Es ist rund neunmal so groß wie
diese Datei, und 56 Prozent davon sind die Ausgabeschemata. Wer den Kontext
ernsthaft entlasten will, sieht zuerst dort hin; diese Datei weiter zu pressen,
bringt vergleichsweise wenig.

## Prüfen

```bash
# Umfang
wc -l -w -c claude-desktop.txt

# Beide Fassungen identisch (muss leer bleiben)
diff claude-desktop.md claude-desktop.txt

# Kein Em-Dash im deutschen Text (muss 0 ergeben)
grep -c "—" claude-desktop.txt
```

Ändert sich der Anweisungstext, gehört der neue Umfang in die Tabelle oben, samt
Datum. Eine Zahl ohne Datum verfällt unbemerkt.
