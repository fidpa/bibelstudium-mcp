# Dokumentation

Diese Datei ist der Index über die Dokumentation dieses Repositories. Sie trägt
selbst keine Frontmatter: Sie ordnet die Zweige, statt in einem zu liegen.

## Die Zweige

Die Dokumentation ist nach dem gegliedert, was jemand gerade braucht, nicht nach
Themen. Der `type:`-Eintrag jeder Datei nennt ihren Zweig.

| Zweig | Für wen, wozu |
|---|---|
| `reference` | Nachschlagen: geltende Regeln, geprüfte Optionen, gemessenes Verhalten |
| `explanation` | Verstehen: warum der Server so gebaut ist und was verworfen wurde |
| `how-to` | Erledigen: eine konkrete Aufgabe von Anfang bis Ende |
| `anweisungen/` | **Kein Dokument, sondern Text zum Einsetzen.** Was ein Nutzer in die Einstellungen seines Clients kopiert, samt Begründung je Regel |

## Was wo liegt

```
docs/
├── BEISPIELE.md          how-to      Aufrufe, die zeigen, wie die Werkzeuge gemeint sind
├── FEHLERBEHEBUNG.md     how-to      Wenn ein Aufruf nicht liefert, was er soll
├── ENTSCHEIDUNGEN.md     explanation Warum der Server ist, wie er ist, samt Messreihen
├── TYPESCRIPT.md         reference   Code-Stil und Kommentarregeln, vor dem Schreiben zu lesen
├── UEBERSETZUNGEN.md     reference   Geprüfte Optionen für weitere Ausgaben, mit Lizenzlage
└── anweisungen/
    ├── README.md         Woher jede Regel des Anweisungstextes kommt
    ├── claude-desktop.md Der Text für „Einstellungen › Anweisungen für Claude"
    └── claude-desktop.txt Dieselbe Fassung zum Kopieren, zeichengleich mit der .md
```

**Die beiden Anweisungsdateien sind byteidentisch, und das ist eine Zusage, keine
Verdopplung.** Die `.txt` ist das, was ein Nutzer kopiert; die `.md` ist das, was
GitHub rendert. Läuft eine der beiden weg, kopiert jemand einen anderen Text, als
hier besprochen wird. Die drei Dateien unter `anweisungen/` tragen deshalb keine
Frontmatter: Sie wäre in der kopierten Fassung ein Fremdkörper.

## Was `status:` bedeutet

Die Frage, die der Wert beantwortet, lautet: **Darf ich mich darauf verlassen, und
wird das noch angefasst?**

| Wert | Bedeutung |
|---|---|
| `draft` | Gilt, ist aber unfertig und wird weiter angefasst |
| `active` | Gilt und wird gepflegt. Wer es ändert, hält es aktuell |
| `final` | Hält einen abgeschlossenen Vorgang zu einem Datum fest. Wird nicht fortgeschrieben, höchstens berichtigt, wo es Falsches behauptet |
| `superseded` | Von einer neueren Fassung abgelöst, als Bezugspunkt aufgehoben |
| `deprecated` | Verworfen. Steht da, damit die Entscheidung nachvollziehbar bleibt |

**Der Unterschied zwischen `final` und `active` ist der Gegenstand, nicht die
Fertigstellung.** Eine Messung zu einem Datum ist `final`, auch wenn sie später
berichtigt wird; eine Anleitung, die den heutigen Weg beschreibt, bleibt `active`,
auch wenn gerade nichts daran zu tun ist.

Drei Werte haben derzeit keine Datei im Repository. Sie stehen in der Tabelle,
damit eine Datei, die einmal in diese Lage gerät, nicht neu erfunden wird.

## Wo Frontmatter steht und wo nicht

`type`, `status`, `last_updated` und `related_docs` tragen die fünf Dateien
unmittelbar unter `docs/`. **Ohne Frontmatter bleiben**, jeweils aus einem Grund:

- die drei Dateien unter `anweisungen/`, siehe oben
- `README.md` und `CONTRIBUTING.md` im Wurzelverzeichnis sowie diese Datei:
  GitHub rendert die `README.md` jedes Verzeichnisses unter der Dateiliste und
  zeigt Frontmatter dort als Tabelle

**Weicht der `type:` einer Datei von ihrem Inhalt ab, liegt die Datei falsch.**

## Weiteres im Repository

| Datei | Wofür |
|---|---|
| [../README.md](../README.md) | Einrichtung, Werkzeuge, Umgebungsvariablen |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Welche Datei was tut, und wie mitgewirkt wird |
| [../CHANGELOG.md](../CHANGELOG.md) | Was sich je Version geändert hat |
| [../THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md) | Herkunft und Lizenz jeder Textquelle |
