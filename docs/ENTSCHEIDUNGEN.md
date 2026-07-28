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
