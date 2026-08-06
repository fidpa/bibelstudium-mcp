# Beispiele: was die Werkzeuge zurückgeben

Im Normalfall ruft man die Werkzeuge nicht selbst auf: Man stellt dem
Assistenten eine Frage, und er holt sich die Daten. Diese Seite zeigt, was er
dabei bekommt. Alle Ausgaben sind gekürzt.

## Grundtext Wort für Wort

> „Was steht in Johannes 1,1 wörtlich im Griechischen?"

`bible_original` liefert jedes Wort einzeln, mit Grundform, aufgelöster
Morphologie und Strong-Nummer:

```json
{
  "reference": "Johannes 1,1",
  "texttyp": "byzantine",
  "edition": "Byzantinischer Mehrheitstext (Robinson-Pierpont 2005)",
  "woerter": [
    { "wort": "εν",     "grundform": "ἐν",    "morphologie": "Präposition",                                   "strong": "G1722" },
    { "wort": "αρχη",   "grundform": "ἀρχή",  "morphologie": "Substantiv Dativ Singular feminin",             "strong": "G746"  },
    { "wort": "ην",     "grundform": "εἰμί",  "morphologie": "Verb Imperfekt Aktiv Indikativ 3. Person Sing.", "strong": "G1510" },
    { "wort": "λογος",  "grundform": "λόγος", "morphologie": "Substantiv Nominativ Singular maskulin",        "strong": "G3056" }
  ]
}
```

Das Feld `wort` ist quellentreu und nicht geglättet: `byzantine` und `tr` liegen
unakzentuiert vor, `sblgnt` akzentuiert, `wlc` mit Teamim und dem
OSHB-Morphemtrenner. Der `hinweis` jeder Antwort sagt, was für die abgerufene
Edition gilt.

## Textkritik mit Zeugenbestand

> „Ist das Comma Johanneum in 1. Johannes 5,7 echt?"

`bible_compare` stellt die drei griechischen Editionen gegenüber und legt die
Bezeugung jedes Wortes über acht Editionen daneben. Der Zusatz steht nur im
Textus Receptus, alle betroffenen Wörter tragen `typ: "K"` (KJV-/TR-Tradition):

```json
{
  "reference": "1 Johannes 5,7",
  "vergleiche": [
    { "paar": "byzantine ↔ sblgnt", "ergebnis": "identisch (nach Normalisierung)" },
    { "paar": "byzantine ↔ tr",
      "unterschiede": ["nur in tr: \"εν τω ουρανω ο πατηρ ο λογος και το αγιον πνευμα …\""] }
  ],
  "bezeugung": {
    "woerter_gesamt": 22,
    "von_allen_acht_bezeugt": 5,
    "abweichend": [
      { "wort": "οὐρανῷ", "typ": "K", "editionen": "TR" },
      { "wort": "πατήρ",  "typ": "K", "editionen": "TR" }
    ]
  }
}
```

Widerspricht die Bezeugungsnotiz dem Text der Edition, steht das als `warnung`
und `quellenkonflikte` **oben** in der Antwort, nicht in einer Fußnote.

## Verstext mit Vorbehalt

> „Wie lautet 3. Mose 6,20 in der Elberfelder?"

`bible_lookup` liefert den Text, nennt die Ausgabe und weist auf etwas hin, das
sonst niemand bemerkt: In 140 der 1190 Kapitel zählen die Ausgaben verschieden,
und dieselbe Stellenangabe trifft dann verschiedene Texte.

```json
{
  "reference": "3 Mose 6,20",
  "kurzref": "3Mo 6,20",
  "translation": "Elberfelder 1871",
  "text": "Alles, was sein Fleisch anrührt, wird heilig sein; …",
  "hinweis": "Die geführten Ausgaben zählen dieses Kapitel verschieden: Elberfelder 1871 hat hier 23 Verse, Luther 1912 30, Schlachter 1951 30. …",
  "quellen": [{ "werk": "Elberfelder 1871", "lizenz": "Public Domain", "nennung": null }]
}
```

`quellen` steht unter jeder Antwort und nennt nur die Quellen, die diese Antwort
tatsächlich benutzt hat. `nennung: null` heißt, dass die Lizenz keine
Namensnennung verlangt.

`reference` trägt den Buchnamen der Datenbank, `kurzref` dieselbe Stelle in der
deutschen Kurzform („3Mo 6,20“, „2Kor 8,9.13-15“). Die Kurzform ist zum Zitieren
gedacht und geht unverändert wieder als `book` in ein Werkzeug hinein.

## Selbst ausprobieren, ohne MCP-Client

JSON-RPC-Zeilen lassen sich direkt in den Server leiten:

```bash
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bible_lookup","arguments":{"book":"Johannes","chapter":3,"verses":"16"}}}'
} | bun run src/server.ts
```

## Weitere typische Fragen

- „Wo kommt ἀγάπη im Neuen Testament überall vor?" (`bible_concordance`)
- „Zeig mir Johannes 3,16 in allen Übersetzungen" (Prompt `translation-compare`)
- „Welche Verse sprechen von Gnade?" (`bible_search`)
- „Welche Querverweise gibt es zu Römer 8,1?" (`bible_crossrefs`)
- „Steht in Epheser 2,8 Singular oder Plural?" (`bible_original`)
