# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei
dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
und dieses Projekt folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.2.1] - 2026-07-25

### Geändert

- Repository-Wurzel aufgeräumt: die neun Datenaufbau-Skripte und ihre Helfer (`schema.ts`, `atomic-db.ts`, `provenance.ts`, `aliases.ts`) liegen jetzt unter `scripts/`. Im Root bleiben nur `server.ts` und `translations.ts` — der Schnitt folgt der Laufzeitgrenze: `server.ts` importiert allein `translations.ts`, alles unter `scripts/` läuft ausschließlich beim Datenaufbau. Für Nutzer ändert sich nichts an den Kommandos.
- Dokumentation und Fehlermeldungen des Servers nennen die `package.json`-Aliase (`bun run download:byz`) statt der Dateipfade. Die Aliase gab es schon; sie bleiben gültig, wo auch immer die Dateien liegen. `bun run download` akzeptiert weiterhin ein Übersetzungskürzel (`bun run download SCH`).

## [0.2.0] - 2026-07-25

### Hinzugefügt

- `bible_compare`: Abgleich der TAGNT-Variantennotizen gegen die geladenen Editionstexte. Neue Felder in `bezeugung` — `in_dieser_db` (welche Edition welche Form tatsächlich liest, aus `original_words`), `abgleich` (Widersprüche zwischen Notiz und Editionstext) und `lesehinweis`. TAGNTs „Byz" ist nicht deckungsgleich mit Robinson-Pierpont 2005; über 400 zufällige NT-Verse gemessen weichen beide in rund 11 % der Verse voneinander ab (etwa 1Tim 3,16 `TR: ἀνελήφθη`, obwohl der Mehrheitstext ebenso liest, und Mk 14,46 `Byz: ἐπέβαλαν` gegen tatsächliches `επεβαλον`). Rein additiv — bestehende Felder bleiben unverändert.

- `bible_compare`: Widersprüche zwischen TAGNT-Notiz und Editionstext erscheinen jetzt zusätzlich als `warnung` und `quellenkonflikte` **oben** in der Antwort. Bisher standen sie nur in `bezeugung.abweichend[].abgleich` — vier Ebenen tief, und wer die Bezeugung als optionales Detail behandelt, übersah sie (beobachtet an Mk 14,46). Die Felder erscheinen nur, wenn es tatsächlich einen Widerspruch gibt.
- `bible_crossrefs`: Mehrversige Verweise tragen zusätzlich `verse_einzeln` — ein Eintrag je Vers mit `nr` und `text`, ohne die im String eingebetteten Versnummern. Das bisherige Feld `text` bleibt unverändert. Ein `lesehinweis` mahnt, beim Zitieren keine Verse anzuschneiden (beobachtet: Joh 11,25-26 ohne Redeeinleitung und Schlussfrage wiedergegeben).
- `bible_search`: Neues Feld `vorkommen_gesamt` — `treffer` zählt Verse, ein Vers kann den Suchbegriff aber mehrfach enthalten (1Joh 2,15 trägt drei Formen von `lieb*`). Der `hinweis` benennt den Unterschied jetzt ausdrücklich. Wird ab 1000 Treffern übersprungen, weil die Zählung alle passenden Verse liest.
- `bible_original`: Der `hinweis` jeder Edition beschreibt nun die Schreibweise des Feldes `wort` — Byzantinisch und TR liegen unakzentuiert vor, der WLC führt Vokal- und Akzentzeichen sowie den OSHB-Morphemtrenner `/`. Ohne diese Angabe ergänzen Modelle beim Zitieren Akzente, die nie in den Daten standen, oder entfernen vorhandene Zeichen.

### Geändert

- `bible_lookup`: Die Tool-Beschreibung verweist jetzt ausdrücklich auf Existenz- und Kanonfragen („gibt es dieses Buch?", unbekannte oder verdächtig aussehende Referenzen). Bisher warb sie nur mit „für alle Bibelzitate" — Fragen nach einem nicht existierenden Buch fielen nicht darunter und wurden ohne Werkzeugaufruf beantwortet.
- Fehlermeldungen zu unbekannten Büchern beginnen mit dem Sachverhalt statt mit `Error:`; das `isError`-Flag bleibt unverändert. Rein redaktionell — die ursprüngliche Begründung, `Error:`-Meldungen würden von Konsumenten verworfen, hielt der Nachprüfung nicht stand.
- Unbekannte Buchnamen: Alle fünf Werkzeuge melden den Fehler jetzt einheitlich über `bookNotFound`. Die Meldung nennt das nächstliegende bekannte Buch (`Am nächsten kommt "Hesekiel" — falls das gemeint war, damit erneut abfragen.` für `Hesekiel-Zusatz` oder den Tippfehler `Hesekil`) und weist apokryphe/deuterokanonische Titel — Sirach, Tobit, Judit, Weisheit, Baruch, Makkabäer, Zusätze zu Daniel und Ester — ausdrücklich als nicht enthalten aus, statt ein ähnlich klingendes Buch des Kanons vorzuschlagen.
- `bible_compare`: Der abschließende `hinweis` nennt kein Beispiel für eine Variantenart mehr. Das frühere „(z. B. bewegliches Ny)" wurde als Etikett aufgegriffen und auf einen unpassenden Fall geklebt — `ἐπέβαλον`/`ἐπέβαλαν` in Mk 14,46 als bewegliches Ny bezeichnet, obwohl es um thematische gegen Alpha-Aoristendung geht. Der Hinweis verweist jetzt auf die klassifizierenden Felder in `bezeugung`.
- `bible_compare`: Die Einträge in `quellenkonflikte` nennen zuerst, was die Edition liest, und erst danach die widersprechende TAGNT-Notiz. In der umgekehrten Reihenfolge las sich der Eintrag wie eine Randbemerkung zur Datenqualität und entfiel beim Wiedergeben.
- `bible_search` markiert Fundstellen im Verstext jetzt mit `⟦…⟧` statt `«…»`. Die alten Marker kollidierten mit den Anführungszeichen der Übersetzungen selbst (Menge 8339 Verse, Schlachter 887) — und weil dort `»Zitat«` herum verschachtelt wird, war ein schließendes `«` von einem Marker nicht zu unterscheiden. Wer die Marker auswertet, muss das Zeichen anpassen.
- `server.ts` neu gegliedert — **ohne jede Verhaltensänderung**: 22 Abschnittsbanner statt 7 über die ganze Datei, acht Deklarationen an ihren fachlichen Ort verschoben (`resolveEdition` zu den Editionen, `getBookDisplayName` vor seine Aufrufer, `editDistance` neben `suggestBook`, `formatVerseReference` und `requireTranslation` zu den `bible_lookup`-Helfern, `findStoredLemma` zu den Konkordanz-Helfern, `buildFtsQuery` zu den Such-Helfern, die Suchkonstanten hinter die Statements, die sie ergänzen), elf überlange Morphologie-Tabellen umbrochen (längste Zeile 215 → 163 Zeichen) und JSDoc entfernt, das nur die Signatur nachsprach. Die Helferblöcke stehen jetzt in derselben Reihenfolge wie die Handler weiter unten. Belegt gegen einen Golden-Snapshot aus 79 stdio-Aufrufen (alle sechs Werkzeuge, alle vier Übersetzungen, drei Prompts, 27 Fehlerpfade): Antworten vorher und nachher byteweise identisch.

### Behoben

- `download.ts` normalisiert Buchnamen der Quelle, denen das Leerzeichen vor der Klammer fehlt (`2. Mose(Exodus)` → `2. Mose (Exodus)`). Luther 1912 als Standardquelle für Anzeigenamen ist nicht betroffen; ein mit einer anderen Übersetzung begonnener Lauf schreibt die Namen jedoch selbst. Buchnamen erscheinen in jeder Konkordanz-, Such- und Querverweisausgabe.
- Griechische Formen wurden für den Editionsabgleich samt Koronis `᾽` (U+1FBD) verglichen, sodass `ἀλλ᾽` nie auf das gespeicherte `αλλ` traf; jetzt werden nur Buchstaben verglichen. Reine Elisionsunterschiede (`ἀλλ᾽`/`ἀλλά`) erscheinen in `in_dieser_db`, lösen aber keine Widerspruchsmeldung mehr aus.

## [0.1.0] - 2026-07-23

### Hinzugefügt

- Sechs MCP-Werkzeuge: `bible_lookup`, `bible_original`, `bible_concordance`, `bible_crossrefs`, `bible_search`, `bible_compare`
- Vier frei lizenzierte deutsche Übersetzungen (Luther 1912 als Voreinstellung, Schlachter 1951, Elberfelder 1871, Menge) mit Übersetzungswahl je Werkzeug
- Grundtext Wort für Wort über vier Editionen (hebräisch WLC; griechisch Byzantinisch/SBLGNT/TR) mit drei nativ dekodierten Morphologie-Schemata (Robinson, MorphGNT, OSHB)
- Bezeugung jedes Wortes über acht griechische Editionen (STEPBible TAGNT) in `bible_compare`
- Lexikondaten: Strong 1890 + STEPBible-Tyndale-Glossen + vollständige Abbott-Smith-Einträge (griechisch)
- Querverweise (OpenBible.info TSK, nach Stimmen gewichtet) mit deutschem Zieltext
- FTS5-Volltextsuche mit Umlautfaltung, Phrasen- und Präfixunterstützung
- Drei geführte MCP-Prompts: `word-study`, `variant-check`, `translation-compare`
- Herkunftsnachweis (Quell-URL, Anzahl Anfragen, SHA-256) für jeden Download
- Atomarer Datenbankaufbau (temporäre Kopie + Umbenennen), sicher bei parallelen Lesern
- Strikter Typecheck (`bun run typecheck`: `strict` + `noUncheckedIndexedAccess`) und GitHub-Actions-CI, die ihn zusammen mit den Startprüfungen und yamllint ausführt
