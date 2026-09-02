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

Der gehostete Dienst unter `mcp.bibelstudium-mcp.de` bietet die Ausgabe mit
Genehmigung der Genfer Bibelgesellschaft an. Sie ist nicht Teil dieses
Repositories und wird von `bible_setup` nicht geladen; eine selbst aufgebaute
Datenbank führt sie nicht.

## Grundtexte & Morphologie

| Quelle | Daten | Lizenz |
|--------|-------|--------|
| [byztxt/byzantine-majority-text](https://github.com/byztxt/byzantine-majority-text) | Byzantinischer Mehrheitstext (Robinson-Pierpont 2018) mit Strong-Nummern + Robinson-Parsing | Public Domain |
| [byztxt (Textus Receptus)](https://github.com/byztxt) | Textus Receptus (Scrivener-/Stephanus-Tradition) mit Strong-Nummern + Robinson-Parsing | Public Domain |
| [MorphGNT/sblgnt](https://github.com/morphgnt/sblgnt) | SBLGNT-Text + MorphGNT-Morphologie | Text: CC BY 4.0 (SBL); Morphologie: **CC BY-SA 3.0** |
| [openscriptures/morphhb (OSHB)](https://github.com/openscriptures/morphhb) | Westminster Leningrad Codex + hebräische Morphologie | Text: Public Domain; Morphologie und Lemmata: CC BY 4.0, Namensnennung „Open Scriptures Hebrew Bible Project" |

## Lexika & Studiendaten

| Quelle | Daten | Lizenz |
|--------|-------|--------|
| [openscriptures/strongs](https://github.com/openscriptures/strongs) | Strong-Wörterbücher 1890 (Grundformen, Umschriften, Definitionen) | **CC BY-SA, Version nicht angegeben** (siehe Anmerkung unten) |
| [STEPBible-Data](https://github.com/STEPBible/STEPBible-Data) TBESG | Tyndale-Glossen + Abbott-Smith-Lexikoneinträge (griechisch) | CC BY 4.0 (Tyndale House, Cambridge) |
| [STEPBible-Data](https://github.com/STEPBible/STEPBible-Data) TBESH | Tyndale-Glossen (hebräisch) | CC BY 4.0, das TBESH-Feld „Meaning" ist © Online Bible (Larry Pierce) und wird **bewusst nicht gespeichert** |
| [STEPBible-Data](https://github.com/STEPBible/STEPBible-Data) TAGNT | Bezeugung jedes Wortes über acht griechische Editionen (NA28, NA27, Tyndale House, SBL, Westcott-Hort, Tregelles, TR, Byzantinisch) | CC BY 4.0 (Tyndale House, Cambridge) |
| [OpenBible.info](https://www.openbible.info/labs/cross-references/) | Querverweise (Treasury of Scripture Knowledge, erweitert, mit Community-Stimmen) | CC BY 4.0 |
| [ubsicap/ubs-open-license](https://github.com/ubsicap/ubs-open-license) | Parallelstellen und AT-Zitate im NT (UBS Parallel Passage Database, 2193 Gruppen) | **CC BY-SA 4.0**, © 2023 United Bible Societies (siehe Anmerkung unten) |

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

**UBS Parallel Passage Database**: Die Quelle verlangt die Nennung im Wortlaut
„(UBS Parallel Passage Database, © 2023 United Bible Societies.)", und genau so
steht sie am Anfang des `nennung`-Feldes jeder betroffenen Antwort. Übernommen
sind allein die Versreferenzen. Die Ziffernfolgen der Datei markieren je Wort,
wie genau es der Parallele entspricht, und zählen dabei die Wörter von BHS und
UBSGNT5; dieser Server führt keine dieser beiden Textformen, die Ziffern wären
hier nicht zuzuordnen und werden nicht gespeichert. Die Bearbeitung besteht
darin, die Referenzen zu zerlegen und auf die Buchnummerierung dieses Servers
aufzulösen; eine Beziehungsart, eine Richtung, eine Bewertung oder eine
erschlossene Parallele kommt dabei nicht hinzu. Im Alten Testament zählt die
Quelle nach der hebräischen Bibel, dieser Server nach seinen deutschen Ausgaben;
die Referenz im Wortlaut der Quelle geht deshalb als `locator` mit hinaus, und
wo die Zählungen nachweislich auseinandergehen, sagt die Antwort es.

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

Drei der Quellen stehen unter **CC BY-SA**, und sie sind verschieden bestimmt:

- die **MorphGNT-Morphologie** unter CC BY-SA **3.0**,
- die **Strong-Wörterbücher** unter CC BY-SA **ohne genannte Version** (siehe
  die Anmerkung oben),
- die **UBS Parallel Passage Database** unter CC BY-SA **4.0**.

Alle drei werden hier bearbeitet, nicht nur weitergereicht
(Morphologie-Dekodierung, Überführung des Lexikons in ein eigenes Schema,
Zerlegung und Auflösung der Parallelstellen-Referenzen). Eine ausgelieferte
Datenbank müsste deshalb selbst unter CC BY-SA stehen. Bis zur Aufnahme der
UBS-Daten war die Zielversion frei wählbar: CC BY-SA 3.0 erlaubt die Weitergabe
unter einer späteren Version derselben Lizenz, 4.0 war damit zulässig, aber
nicht vorgeschrieben. **Mit einer originären 4.0-Quelle ist sie es jetzt.** Für
die Strong-Wörterbücher folgt daraus nichts Neues: Ohne genannte Version lässt
sich aus ihnen keine Zielversion herleiten, und dieses Repository behauptet auch
weiterhin keine. Betroffen wären in jedem Fall die **Daten**, nicht der Code
dieses Repositories, der unter MIT steht.

Ob dasselbe schon für die *Ausgaben* eines gehosteten Servers gilt, ist eine
offene Frage, und die UBS-Daten machen sie spitzer. Bei der Morphologie ließ
sich noch sagen, ausgegeben werde versweise und nicht als Datensammlung; eine
Parallelgruppe ist dagegen genau die Struktur, die den Wert der Quelle ausmacht,
und sie geht als Gruppe hinaus. Eine Antwort trägt allerdings die Gruppen zu
einem einzigen Vers, nie den Datensatz. Der Server nennt die
Share-Alike-Lizenz und ihre URI deshalb in `quellen`, damit ein
Weiterverwender die Bedingung kennt und erfüllen kann, statt sie herleiten zu
müssen.

**Hinweis zur STEPBible-Weiterverbreitung**: STEPBible bittet darum, die eigenen
Datendateien nur aus dem eigenen Repository zu verbreiten („Refer others to
github.com/STEPBible as the source of the data. Please do not redistribute it
yourself."). Dieses Projekt kommt der Bitte nach, indem es **weder eine
Datenbank noch Datendateien mitliefert**. Jede Nutzerin und jeder Nutzer baut
die Datenbank lokal aus den Originalquellen auf.
