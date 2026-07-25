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
| SCH | Schlachter 1951 | **CC BY 4.0** — © Genfer Bibelgesellschaft (siehe unten) |
| ELB | Elberfelder 1871 | Public Domain |
| MB | Menge | Public Domain (Hermann Menge † 1939) |

**Namensnennung Schlachter 1951** (von CC BY 4.0 vorgeschrieben): Die Heilige
Schrift, Schlachter 1951, © 1951 Genfer Bibelgesellschaft (Geneva Bible
Society). Die Übersetzung wird unter den Bedingungen der Creative-Commons-
Namensnennung-Lizenz 4.0 bereitgestellt; Lizenzerklärung:
<https://ebible.org/deu1951/copyright.htm>. Der Text wird unverändert
gespeichert (abgesehen von der Entfernung des HTML-Fußnoten-Markups).

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
| [STEPBible-Data](https://github.com/STEPBible/STEPBible-Data) TBESH | Tyndale-Glossen (hebräisch) | CC BY 4.0 — das TBESH-Feld „Meaning" ist © Online Bible (Larry Pierce) und wird **bewusst nicht gespeichert** |
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

## Was bei einer Weitergabe der Datenbank gälte

Dieses Projekt liefert keine Datenbank aus (siehe oben), deshalb ist der
folgende Punkt heute gegenstandslos. Er steht hier, damit er nicht übersehen
wird, falls sich das ändert.

Zwei der Quellen stehen unter **CC BY-SA**: die MorphGNT-Morphologie (3.0) und
die Strong-Wörterbücher. Beide werden hier bearbeitet, nicht nur weitergereicht
(Morphologie-Dekodierung, Überführung des Lexikons in ein eigenes Schema). Eine
ausgelieferte Datenbank müsste deshalb selbst unter CC BY-SA stehen; CC BY-SA
4.0 wäre zulässig, weil CC BY-SA 3.0 die Weitergabe unter einer späteren Version
derselben Lizenz erlaubt. Betroffen wären die **Daten**, nicht der Code dieses
Repositories, der unter MIT steht.

Hinzu kämen die Pflichten aller CC-BY-Quellen: Urheber, Copyright-Vermerk,
Lizenzhinweis und Link müssten die Datei **begleiten**, nicht nur im Repository
stehen. Außerdem verlangt CC einen Hinweis darauf, dass das Material verändert
wurde, was hier mehrfach zutrifft (HTML-Bereinigung, Normalisierung, Umbau in
SQLite, das bewusst weggelassene TBESH-Feld „Meaning").

**Hinweis zur STEPBible-Weiterverbreitung**: STEPBible bittet darum, die eigenen
Datendateien nur aus dem eigenen Repository zu verbreiten („Refer others to
github.com/STEPBible as the source of the data. Please do not redistribute it
yourself."). Dieses Projekt kommt der Bitte nach, indem es **weder eine
Datenbank noch Datendateien mitliefert** — jede Nutzerin und jeder Nutzer baut
die Datenbank lokal aus den Originalquellen auf.
