# Datenquellen & Lizenzen Dritter

Dieses Repository enthält **ausschließlich Code** (MIT, siehe [LICENSE](LICENSE)).
Die Bibeldaten werden von den `download-*.ts`-Skripten lokal heruntergeladen und
niemals mitgeliefert oder weiterverbreitet. Jeder Download protokolliert seine
Quell-URL, die Anzahl der Anfragen und eine SHA-256-Prüfsumme über alle
Nutzdaten in der Tabelle `provenance` der lokalen Datenbank:

```bash
sqlite3 data/bible.db "SELECT * FROM provenance ORDER BY script"
```

## Deutsche Übersetzungen (über die [bolls.life](https://bolls.life)-API)

| Kürzel | Übersetzung | Lizenz |
|--------|-------------|--------|
| LUT | Luther 1912 | Public Domain |
| SCH | Schlachter 1951 | **CC BY 4.0**, © Genfer Bibelgesellschaft (siehe unten) |
| ELB | Elberfelder 1871 | Public Domain |
| MB | Menge 1939 | Public Domain (Hermann Menge † 1939) |

**Namensnennung Schlachter 1951** (von CC BY 4.0 vorgeschrieben): Die Heilige
Schrift, Schlachter 1951, © 1951 Genfer Bibelgesellschaft (Geneva Bible
Society). Die Übersetzung wird unter den Bedingungen der Creative-Commons-
Namensnennung-Lizenz 4.0 bereitgestellt; Lizenzerklärung:
<https://ebible.org/deu1951/copyright.htm>. Der Text wird unverändert
gespeichert; die Quelle enthält kein Markup (geprüft am 28.07.2026 über alle
31 101 Verse, zeichengenau gegen den statischen Export).

## Schlachter 2000

| Kürzel | Übersetzung | Verfügbar |
|--------|-------------|-----------|
| SLT | Schlachter 2000 | über den gehosteten Dienst |

**Namensnennung Schlachter 2000:** © 2000 Genfer Bibelgesellschaft.

Die Ausgabe ist nicht Teil dieses Repositories und wird von `bible_setup` nicht
geladen; eine selbst aufgebaute Datenbank führt sie nicht.

## Grundtexte & Morphologie

| Quelle | Daten | Lizenz |
|--------|-------|--------|
| [byztxt/byzantine-majority-text](https://github.com/byztxt/byzantine-majority-text) | Byzantinischer Mehrheitstext (Robinson-Pierpont 2005) mit Strong-Nummern + Robinson-Parsing | Public Domain |
| [byztxt (Textus Receptus)](https://github.com/byztxt) | Textus Receptus (Scrivener-/Stephanus-Tradition) mit Strong-Nummern + Robinson-Parsing | Public Domain |
| [MorphGNT/sblgnt](https://github.com/morphgnt/sblgnt) | SBLGNT-Text + MorphGNT-Morphologie | Text: CC BY 4.0 (SBL); Morphologie: **CC BY-SA 3.0** |
| [openscriptures/morphhb (OSHB)](https://github.com/openscriptures/morphhb) | Westminster Leningrad Codex + hebräische Morphologie | Text: Public Domain; Morphologie und Lemmata: CC BY 4.0, Namensnennung „Open Scriptures Hebrew Bible Project" |

## Lexika & Studiendaten

| Quelle | Daten | Lizenz |
|--------|-------|--------|
| [openscriptures/strongs](https://github.com/openscriptures/strongs) | Strong-Wörterbücher 1890 (Grundformen, Umschriften, Definitionen) | **CC BY-SA, Version nicht angegeben** (siehe Anmerkung unten) |
| [STEPBible-Data](https://github.com/STEPBible/STEPBible-Data) TBESG | Tyndale-Glossen + Abbott-Smith-Lexikoneinträge (griechisch) | CC BY 4.0 (Tyndale House, Cambridge) |
| [STEPBible-Data](https://github.com/STEPBible/STEPBible-Data) TBESH | Tyndale-Glossen (hebräisch) | CC BY 4.0, das TBESH-Feld „Meaning" ist © Online Bible (Larry Pierce) und wird **bewusst nicht gespeichert** |
| [STEPBible-Data](https://github.com/STEPBible/STEPBible-Data) TAGNT | Bezeugung jedes Wortes über acht griechische Editionen (NA27/28, Tyndale House, SBL, Westcott-Hort, Tregelles, TR, Byzantinisch) | CC BY 4.0 (Tyndale House, Cambridge) |
| [OpenBible.info](https://www.openbible.info/labs/cross-references/) | Querverweise (Treasury of Scripture Knowledge, erweitert, mit Community-Stimmen) | CC BY 4.0 |

## Anmerkungen zu einzelnen Angaben (geprüft am 25.07.2026)

**SBLGNT**: Die Lizenz unter <https://sblgnt.com/license/> ist heute die
Creative-Commons-Namensnennung-Lizenz 4.0. Ältere Beschreibungen des SBLGNT
nennen eine EULA mit einer Obergrenze von 1000 Versen je Veröffentlichung; eine
solche Grenze steht in der aktuellen Lizenz nicht mehr. Verlangt wird allein die
Namensnennung.

**openscriptures/strongs**: Das Repository enthält **keine** Lizenzdatei, und
GitHub weist für es keine Lizenz aus. Die einzige Angabe steht im Kopf der
Datendateien: „Copyright 2009, Open Scriptures. CC-BY-SA. Derived from XML."
Eine Versionsnummer der Lizenz wird nicht genannt. Das zugrunde liegende Werk
(James Strong, 1890) ist wegen seines Alters gemeinfrei; die Share-Alike-Pflicht
kann sich daher nur auf die digitale Aufbereitung von 2009 beziehen.

**Menge**: Über bolls.life bezogen. Hermann Menge starb 1939, das Werk ist in
Deutschland seit 2010 gemeinfrei. bolls.life selbst macht zu keiner Übersetzung
eine Lizenz- oder Copyright-Angabe; die Einordnung in der Tabelle oben stützt
sich auf das Sterbejahr des Übersetzers, nicht auf eine Aussage der Quelle.

## Weitergabe: was schon jetzt gilt

Zwei Fälle sind zu unterscheiden, und der erste ist **nicht** hypothetisch.

### Wer Antworten dieses Servers Dritten zugänglich macht, gibt weiter

„Share" heißt in CC 4.0 ausdrücklich auch, Material öffentlich verfügbar zu
machen, nicht nur eine Datei auszuliefern. Ein Server, den Fremde benutzen,
verbreitet die Texte also, obwohl keine Datenbank den Rechner verlässt. Die
Namensnennung muss dann **bei der Antwort** ankommen, denn wer den Server über
MCP benutzt, sieht dieses Repository nicht.

Der Server tut das seit 0.4.0 von selbst. Jede Antwort trägt ein Feld `quellen`
mit Werk, Lizenz und der verlangten Nennung, und zwar für genau die Quellen, aus
denen sie stammt. Wer den Server nur lokal für sich betreibt, verbreitet nichts
und braucht sich darum nicht zu kümmern.

CC verlangt zusätzlich den Hinweis, dass das Material verändert wurde. Das
trifft hier mehrfach zu: HTML-Bereinigung, Normalisierung, Umbau in SQLite,
Auflösung der Morphologiecodes und das bewusst weggelassene TBESH-Feld
„Meaning".

### Wer die aufgebaute Datenbank weitergibt, muss mehr beachten

Dieses Projekt liefert keine Datenbank aus, dieser Teil ist also heute
gegenstandslos. Er steht hier für den Fall, dass jemand seine eigene
weitergibt.

Zwei der Quellen stehen unter **CC BY-SA**: die MorphGNT-Morphologie (3.0) und
die Strong-Wörterbücher. Beide werden hier bearbeitet, nicht nur weitergereicht
(Morphologie-Dekodierung, Überführung des Lexikons in ein eigenes Schema). Eine
ausgelieferte Datenbank müsste deshalb selbst unter CC BY-SA stehen; CC BY-SA
4.0 wäre zulässig, weil CC BY-SA 3.0 die Weitergabe unter einer späteren Version
derselben Lizenz erlaubt. Betroffen wären die **Daten**, nicht der Code dieses
Repositories, der unter MIT steht.

Ob dasselbe schon für die *Ausgaben* eines gehosteten Servers gilt, ist eine
offene Frage. Ausgegeben werden bearbeitete Morphologiedaten, aber versweise und
nicht als Datensammlung. Der Server nennt die Share-Alike-Lizenz deshalb in
`quellen`, damit ein Weiterverwender sie kennt, statt sie selbst herleiten zu
müssen.

**Hinweis zur STEPBible-Weiterverbreitung**: STEPBible bittet darum, die eigenen
Datendateien nur aus dem eigenen Repository zu verbreiten („Refer others to
github.com/STEPBible as the source of the data. Please do not redistribute it
yourself."). Dieses Projekt kommt der Bitte nach, indem es **weder eine
Datenbank noch Datendateien mitliefert**. Jede Nutzerin und jeder Nutzer baut
die Datenbank lokal aus den Originalquellen auf.
