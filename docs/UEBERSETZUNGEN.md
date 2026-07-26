# Weitere Übersetzungen: geprüfte Optionen

Recherchestand **26.07.2026**. Alle Angaben unten sind an den Quellen selbst
geprüft, nicht aus dem Gedächtnis übernommen: Übersetzungslisten abgerufen,
Lizenzfelder gelesen, Datendateien heruntergeladen und gegen die eigene
Datenbank gestellt.

**Entschieden ist nichts.** Der Server führt weiterhin die vier Übersetzungen aus
`translations.ts`. Diese Datei hält fest, welche Optionen es gäbe und was sie
kosten würden, damit die Frage nicht bei jeder Gelegenheit neu recherchiert wird.

## Was heute geführt wird

| Code | Ausgabe | Lizenz |
|---|---|---|
| `LUT` | Luther 1912 | Public Domain |
| `ELB` | Elberfelder 1871 | Public Domain |
| `MB` | Menge 1939 | Public Domain |
| `SCH` | Schlachter 1951 | CC BY 4.0 (Genfer Bibelgesellschaft) |

Maßgeblich ist `translations.ts`; dort steht neben jeder Ausgabe auch die
Nennung, die ihre Lizenz beim Weitergeben verlangt (`null` bei Public Domain).

## Die bisherige Quelle ist ausgeschöpft

Die Download-Skripte holen die deutschen Texte von der bolls.life-API. Deren
Sprachliste führt für Deutsch **sechs** Ausgaben: die vier oben plus zwei
weitere, die **beide urheberrechtlich geschützt** sind (eine moderne
Übertragung, eine neuere Revision einer der geführten Ausgaben).

Daraus folgt: **Über die bestehende Quelle ist keine weitere Ausgabe möglich.**
Die vier geführten sind genau das, was dort frei verfügbar ist. Jede Ergänzung
bedeutet eine zweite Quelle und damit ein eigenes Downloadskript.

## Freie Kandidaten bei eBible.org

`https://ebible.org/Scriptures/translations.csv` listet 1548 Ausgaben, davon
fünf deutsche. Die Spalten `Copyright` und `Redistributable` stammen aus dieser
Datei, der Wortlaut aus der jeweiligen `copyright.htm`:

| ID | Titel | Copyright-Feld | Für dieses Projekt |
|---|---|---|---|
| `deuelo` | Darby Unrevidierte Elberfelder (Unrevised Elberfelder 1905) | public domain | ✅ Kandidat |
| `deutkw` | Textbibel von Kautzsch und Weizsäcker | public domain | ✅ Kandidat |
| `deuelbbk` | Elberfelder Übersetzung (Version von bibelkommentare.de) | © 2019 Verbreitung des christlichen Glaubens e.V. | ❌ geschützt |
| `deu1912` | Lutherbibel 1912 | public domain | bereits geführt |
| `deu1951` | Die Schlachter-Bibel 1951 | © 1951 Genfer Bibelgesellschaft | bereits geführt |

Zwei Fallstricke, an denen eine Prüfung scheitern kann:

- **`Redistributable: True` ist keine Lizenz für uns.** Das Feld sagt, dass
  eBible.org die Ausgabe verbreiten darf. Bei `deuelbbk` steht es auf `True`,
  und die Ausgabe ist trotzdem geschützt. Maßgeblich ist allein das
  Copyright-Feld beziehungsweise die `copyright.htm`.
- **Die beiden Elberfelder sind nicht dieselbe Ausgabe.** `deuelo` ist die
  unrevidierte Fassung von 1905 und gemeinfrei, `deuelbbk` die sprachlich
  revidierte von 2019 und geschützt. Die Namen ähneln sich, der Lizenzstatus
  nicht.

### Zu `deuelo` (Elberfelder 1905)

Die Copyright-Seite nennt: „The Holy Bible in German, Unrevised Elberfelder
1905, Public Domain, Translation by: Julius Anton von Poseck, Carl Brockhaus,
and John Nelson Darby." Gemeinfrei, also ohne Nennungspflicht, wie Luther 1912
und Elberfelder 1871.

### Zu `deutkw` (Textbibel)

eBible datiert sie auf **1906**. Wer sie unter „Textbibel 1899" sucht, meint
dieselbe Übersetzung, deren Teile ab 1899 erschienen; die Jahreszahl im Namen
einer Ausgabe ist hier aber eine inhaltliche Angabe und keine Nebensache, und
die Quelle sagt 1906.

## Technische Passung (an den Daten geprüft)

Geprüft an `deuelo`, stellvertretend für beide Kandidaten:

| Punkt | Befund |
|---|---|
| Formate | USFX (XML, 1,6 MB), USFM (1,5 MB), VPL (4,7 MB) |
| Einfachster Weg | **VPL**, eine Zeile je Vers: `GEN 1:1 Im Anfang schuf Gott…` |
| Umfang | 31.102 Verse, 66 Bücher, keine Apokryphen |
| Verssystem | passt: LUT hat in unserer Datenbank ebenfalls 31.102 Verse (ELB 31.072, MB 31.166, SCH 31.101) |
| Buchkürzel | `JOH`, `MAT`, `LUK` statt der sonst üblichen `JHN`, `MAT`, `LUK`; braucht eine eigene Zuordnung |
| Stichprobe | Joh 3,16: „Denn also hat Gott die Welt geliebt, daß er seinen eingeborenen Sohn gab…" |

## Was eine Aufnahme kosten würde

**Laufende Kosten je Sitzung: vernachlässigbar.** Gemessen über einen
stdio-Client an `JSON.stringify(result)`:

| Stelle | Zuwachs je zusätzlicher Übersetzung | Wann es anfällt |
|---|---|---|
| `tools/list` (Beschreibung von `bible_lookup`) | +28 Zeichen (7201 auf 7229) | jede Sitzung |
| `bible_server_info` | +57 Zeichen | je Aufruf |
| Fehlermeldung „Unknown translation" | +25 Zeichen, dynamisch aus `TRANSLATIONS` | nur im Fehlerfall |

Nicht betroffen: `bible_lookup` liefert je Aufruf genau eine Übersetzung, der
Payload wächst also nicht. `bible_compare` vergleicht Urtext-**Editionen**, nicht
Übersetzungen, und bleibt davon ebenfalls unberührt.

**Einmaliger Aufwand: deutlich höher als ein Eintrag in `translations.ts`.**
Nötig wären ein eigenes Downloadskript (die bestehenden sprechen bolls-JSON, hier
käme ein Zip mit VPL), eine Zuordnung der Buchkürzel auf das eigene Schema, ein
Eintrag in der `provenance`-Tabelle, ein Abschnitt in THIRD_PARTY_LICENSES und
Zusicherungen in den Golden-Tests.

## Abwägung

- **Elberfelder 1905** stünde neben der bereits geführten Elberfelder 1871. Beide
  gehen auf dieselbe Übersetzungsarbeit zurück und ähneln sich in weiten Teilen;
  für einen Übersetzungsvergleich ist der Zugewinn entsprechend klein.
- **Die Textbibel** wäre eine eigenständige Übersetzung und brächte damit mehr
  Breite als eine zweite Elberfelder.
- Beide sind gemeinfrei und über denselben Weg zu holen.

## Kriterium für jede künftige Ergänzung

Der Server ist über HTTP öffentlich und ohne Anmeldung erreichbar. Jeder Abruf
liefert Bibeltext an Dritte aus, das ist Verbreitung und nicht Privatgebrauch.
Deshalb gilt: **Aufgenommen wird nur, was frei lizenziert ist** (Public Domain
oder eine Lizenz, die die Weitergabe erlaubt), und eine geforderte Nennung wird
an jede betroffene Antwort gehängt (Feld `quellen`), nicht bloß in einer
Repository-Datei vermerkt. Dass eine API einen Text ausliefert, ist kein
Lizenznachweis.
