# TypeScript-Richtlinien: bibelstudium-mcp

Code-Stil-Regeln für dieses Repository, zugeschnitten auf das, was hier
tatsächlich zutrifft: Bun, ein MCP-Server über stdio und optional HTTP, SQLite,
keine Oberfläche, kein Test-Framework, bewusst eine einzige
*Laufzeit*-Abhängigkeit (`@modelcontextprotocol/sdk`).

## Typecheck

```bash
bun run typecheck    # tsc --noEmit gegen tsconfig.json
```

`strict` plus `noUncheckedIndexedAccess` und `noFallthroughCasesInSwitch`; der
Code besteht das ohne einen einzigen Fehler, und die CI erzwingt es. TypeScript
und `@types/bun` sind **Dev**-Abhängigkeiten: Der Laufzeit-Footprint bleibt bei
einem Paket, und kompiliert wird nichts: Bun führt die `.ts`-Dateien weiterhin
direkt aus.

Die tsconfig ist keine optionale Zierde. Ohne sie kann ein Editor weder
`bun:sqlite` noch `import.meta.path` noch die `.ts`-Importendungen dieses
Repositories auflösen und begrüßt jede mitwirkende Person mit Phantom-Fehlern in
Dateien, die in Wirklichkeit korrekt sind.

## Regeln

### 1. Externe Daten immer validieren (`unknown` + Typprüfungen)

Externe Daten heißt hier: **MCP-Tool-Argumente** (LLM-Clients senden regelmäßig
falsche Typen: `"3"` statt `3`, eine Zahl statt einer Zeichenkette) und
**API-/Download-Antworten** (bolls.life, rohe GitHub-Dateien).

- Tool-Argumente als `unknown` typisieren und explizit prüfen, niemals blind
  casten. Muster im Code: `toInt()` (akzeptiert Zahl *und* Ziffernfolge),
  `resolveEdition()` / `resolveTranslation()` (Typprüfung vor `.trim()`), die
  `verses`-Normalisierung in `handlers/lookup.ts`.
- Heruntergeladene Strukturen prüfen, bevor sie in die DB gelangen
  (`Array.isArray`, Feldprüfungen wie in `download.ts`), und werfen statt still
  weiterlaufen: Der `abort()`-Pfad lässt die Live-DB unangetastet.
- Ungültige Nutzereingabe an ein **Werkzeug** → klare Fehlermeldung als
  Tool-Ergebnis (`isError: true`), niemals eine Exception. Nur so liest das
  Modell die Meldung und kann sie beantworten.
- **Prompts und Ressourcen** haben kein `isError`; dort ist der JSON-RPC-Fehler
  der vorgesehene Weg, und zwar über `rpcError(ErrorCode.InvalidParams, …)`
  aus `werkzeug-helfer.ts`, nicht über ein nacktes `throw new Error` (das meldet
  `InternalError`) und nicht über `McpError` (das stellt der Meldung ein Präfix
  voran). `InternalError` bleibt Zuständen des Servers vorbehalten, etwa einer
  Instanz ohne Datenbank.

### 2. `??` statt `||` bei numerischen/booleschen Vorgabewerten

`0`, `false` und `""` sind gültige Werte: `||` ersetzt sie fälschlich durch den
Rückfallwert. `||` nur dort nutzen, wo eine leere Zeichenkette bzw. ein leeres
Ergebnis *bewusst* als „kein Wert" gelten soll (z. B. `lemma || "—"` in der
Ausgabe).

### 3. String-Unions und `as const` statt Enums

Keine TypeScript-Enums (Laufzeit-Overhead). Literal-Unions wie
`decoder: "robinson" | "morphgnt" | "hebrew"` und `as const` /
`ReadonlyArray` für statische Tabellen (`BOOK_ALIASES`, `EDITION_META`,
`TRANSLATIONS`).

### 4. Kein `any`

`unknown` + Einengung (`typeof`, `in`, Typprüfungen). Casts von
`request.params.arguments` nur auf Formen mit `unknown`-Feldern, anschließend
validiert (siehe Regel 1).

### 5. Non-Null-Assertion `!` nur mit struktureller Begründung

`!` ist zulässig, wenn die Struktur den Zugriff garantiert, eine Schleifengrenze
(`i < arr.length`), ein erfolgreicher Regex-Treffer (`m[1]!` für Gruppen ohne
`?`), ein zuvor geprüfter Schlüssel. Bei externen Daten ohne solche Garantie:
explizite Prüfung + Fehler mit Kontext (Index/Feldname in der Meldung).

### 6. Fehlermeldungen mit Kontext, früh scheitern

Downloads brechen bei unerwarteten Daten sofort mit aussagekräftiger Meldung ab
(was, wo, welcher Wert), kein stilles Auffüllen mit Vorgabewerten, das kaputte
Bibeldaten in die DB schriebe. Startfehler des Servers (fehlende DB/Tabellen)
nennen den konkreten Reparaturbefehl.

### 7. Mutation vermeiden, wo sie nichts kostet

Neue Arrays/Objekte statt Änderungen an Ort und Stelle (`[...verses].sort()`,
Spread). Kein Dogma: lokale Sammler in Schleifen (Zähler, `out.push(...)` in
Dekodern) sind in Ordnung.

## Kommentare

Dieser Code ist ungewöhnlich dicht kommentiert: 1203 von 4643 Zeilen in
`server.ts` sind Kommentar, also 26 Prozent, dazu 24 Blöcke von mehr als zwölf
Zeilen (gemessen 05.08.2026; am 03.08.2026, nach der Umstellung auf Deutsch,
waren es 1065 von 4424 Zeilen und 20 solcher Blöcke, davor 935 von 4293 und
15).

Am 05.08.2026 sind in zwei Zügen Blöcke in eigene Dateien gezogen: erst drei
zustandsfreie (`morphology.ts`, `verse-budget.ts`, `greek-diff.ts`), dann die
Datenschicht (`db.ts`) und die Editionen (`editions.ts`), zuletzt die geteilten
Werkzeughelfer (`werkzeug-helfer.ts`) und die sechs Handler unter `handlers/`.
Die Kommentare gingen jeweils mit. `server.ts` hat seither 2360 Zeilen, die
übrigen Laufzeitmodule zusammen 3146, und der Anteil bleibt in derselben
Größenordnung: gemessen 30 Prozent in `server.ts`, 20 bis 36 Prozent in den
Modulen (gezählt über Zeilen, die mit `//`, `/*` oder `*` beginnen). Die Zahlen
der Reihe darüber sind nicht fortgeschrieben, sie belegen den damaligen Stand
einer einzigen Datei.

Das ist Absicht. Ein großer Teil der
Entscheidungen hier beruht auf Messungen an fremden Clients, fremden Quellen
und dem MCP-SDK, und ohne die Begründung daneben sieht eine solche Stelle aus
wie eine willkürliche Zeile, die der nächste Umbau geradezieht. Die folgenden
Regeln sollen diese Dichte nicht senken, sondern sie tragfähig halten.

### K1. Sprache: Deutsch

Kommentare sind deutsch, wie die gesamte übrige Dokumentation dieses
Repositories. Englisch bleiben, weil sie fremde Software oder fremde Leser
adressieren: Bezeichner, Tool-Namen, die Tool-`description`s, das
`instructions`-Feld des Handshakes, Commit-Nachrichten.

Der Grund ist nicht Geschmack: Die längeren Blöcke hier sind Begründungsprosa,
oft mit Messwerten und Abwägungen, und dieselbe Sache steht deutsch in
`docs/ENTSCHEIDUNGEN.md`. Zwei Sprachen für denselben Gedanken kosten bei jeder
Änderung eine Übersetzung.

**Die Umstellung ist erfolgt** (03.08.2026, alle 21 `.ts`-Dateien in einem Zug).
Gemessen danach über den ganzen Baum: 1147 Kommentarzeilen eindeutig deutsch,
24 eindeutig englisch, 853 zu kurz oder gemischt für eine Zuordnung; in
`server.ts` 668 deutsch gegen 4 englisch. Die verbliebenen englischen Zeilen
sind wörtliche Zitate: Meldungen fremder Software, Sätze aus der Spezifikation
und aus Quellen-Dokumentation. Sie bleiben englisch, weil ein übersetztes Zitat
kein Zitat mehr ist.

Seither gilt: Kommentare sind deutsch, auch neue. Ein englischer Kommentar ist
ein Befund, kein Bestand.

**Kommentare fallen damit unter die Em-Dash-Regel dieses Repositories.** Der
Halbgeviertstrich `–` mit Leerzeichen steht nur, wo wirklich ein Gedankenstrich
hingehört; sonst Doppelpunkt, Punkt, Komma oder Semikolon. Ein aus dem
Englischen mitgeschleppter Em-Dash `—` ist im deutschen Satz falsch. Gemessen
am 03.08.2026 trägt kein Kommentar mehr einen; die verbliebenen `—` im Code
stehen in englischen Zeichenketten oder sind der Platzhalter `"—"` für „kein
Wert", der ein Symbol ist und kein Satzzeichen.

### K2. Warum, nicht was

Was der Code tut, sagt der Code. Der Kommentar sagt, warum er es so tut, und
zwar dann, wenn die Antwort nicht offensichtlich ist: eine Grenze, die aus einer
Messung stammt; eine Reihenfolge, die einen Fehler verhindert; eine Bibliothek,
die sich anders verhält als erwartet; eine Alternative, die verworfen wurde.

Eine Zeile, die nur den Code nacherzählt (`// Buch auflösen` über
`resolveBook(book)`), wird beim nächsten Umbau nicht mitgepflegt und ist dann
falsch.

### K3. Selbsttragend, ohne Verweis auf Ungeteiltes

Wer das Repository von GitHub klont, muss jeden Kommentar verstehen. Nicht
verweisen auf: `CLAUDE.md`, `.claude/`, `TODO.md`, `docs/intern/`, `data/`.
Alles davon ist gitignored und im Klon nicht vorhanden; ein Verweis darauf ist
ein toter Link, der schlimmer ist als kein Kommentar, weil er Vollständigkeit
vortäuscht.

Erlaubt und erwünscht: `docs/ENTSCHEIDUNGEN.md` und die übrigen versionierten
Dateien unter `docs/`, externe URLs (Spezifikation, SDK-Quelle, Datenquellen),
und Fundstellen im SDK mit Datei und Zeile (`protocol.js:397`). Letztere altern
mit der SDK-Fassung: Wer sie schreibt, nennt die geprüfte Fassung mit.

Gemessen am 02.08.2026 verweist keine `.ts`-Datei dieses Repos auf einen
gitignorierten Pfad. Das ist der Zustand, der zu halten ist.

### K4. Länge und der richtige Ort

Die Länge entscheidet sich an der Reichweite, nicht am Geschmack:

| Reichweite | Ort |
|---|---|
| Erklärt **diese** Stelle | Kommentar daneben. Immer und zuerst. |
| Betrifft mehrere Stellen, eine Messreihe, eine verworfene Alternative | `docs/ENTSCHEIDUNGEN.md`, im Kommentar nur das Ergebnis plus Verweis |
| Was sich für Nutzende je Fassung ändert | `CHANGELOG.md` |
| Wie man den Server benutzt | `README.md` |

Richtwert für den Kommentar: bis etwa zwölf Zeilen. Wird ein Block länger,
steckt meist eine Herleitung darin, die nach `docs/ENTSCHEIDUNGEN.md` gehört,
während an der Codestelle das Ergebnis genügt („X, weil Y; Messung und
verworfene Alternativen siehe `docs/ENTSCHEIDUNGEN.md`").

`server.ts` hat 20 Blöcke über zwölf Zeilen (03.08.2026, davor 15). Der Zuwachs
kommt aus der Umstellung selbst: Deutsch braucht für denselben Inhalt mehr
Zeilen. Geprüft wurde jeder von ihnen, und keiner ist eine Herleitung, die
verlagert gehörte; sie erklären ihre Codestelle, und dafür gilt der Richtwert
nicht als Obergrenze. Bei einem **neuen** langen Block bleibt er es.

### K5. Messwerte mit Datum

Jede Zahl und jede Verhaltensbeobachtung im Kommentar ist gemessen und nennt das
Datum: „gemessen 25.07.2026", „(26.07.2026)". Das ist hier bereits Konvention,
30 Datumsangaben in `server.ts`. Der Grund: Aussagen über fremde Clients, fremde
Quellen und das SDK verfallen, und ohne Datum lässt sich später nicht
entscheiden, ob eine Aussage neu zu prüfen ist.

Was nicht gemessen ist, wird als solches gekennzeichnet („nicht belegt",
„Vorsichtsmaßnahme"). Eine Vermutung, die wie ein Befund klingt, ist der
teuerste Kommentar überhaupt.

### K6. Bannerkommentare gliedern die Datei

`server.ts` ist in Abschnitte geteilt, jeder mit `// --- Titel ---` auf
78 Spalten. Neue Deklarationen kommen in den passenden Abschnitt, nicht ans
Dateiende.

Die Regel gilt für `server.ts`, nicht für jede Datei. Ein Laufzeitmodul trägt
stattdessen einen JSDoc-Kopf, der sagt, was drin ist und warum es dort steht
(`db.ts`, `editions.ts`, `morphology.ts`, `verse-budget.ts`, `greek-diff.ts`,
`translations.ts`, `werkzeug-helfer.ts`, dazu die sechs Dateien unter
`handlers/`). Banner innerhalb eines Moduls sind kein Fehler, wenn sie wirklich
gliedern: `morphology.ts` führt drei, eines je Kodierschema, weil die drei
einander ähnlich genug sind, um verwechselt zu werden, `db.ts` acht, eines je
Tabelle, weil eine Abfrage über ihre Tabelle gesucht wird, und
`werkzeug-helfer.ts` vier, weil dort vier Arbeitsschritte nebeneinanderliegen,
die nichts miteinander zu tun haben außer ihren Aufrufern.

Eine Handler-Datei braucht keinen Banner: Sie enthält ein Werkzeug, und ihr
Name sagt bereits, welches.

### K7. Ein Kommentar, der nicht mehr stimmt, ist ein Fehler

Wer Verhalten ändert, prüft die Kommentare an derselben Stelle **und** die, die
dasselbe an anderer Stelle behaupten. Zwei Kommentare zu einem Sachverhalt sind
schon einmal auseinandergelaufen (`createServer()` und die Tool-Registrierung).
Wo sich das nicht vermeiden lässt, benennt jeder der beiden den anderen.

### Prüfbefehle

```bash
# Verweise auf Ungeteiltes: muss 0 Treffer ergeben
grep -rn "CLAUDE\.md\|\.claude/\|docs/intern\|TODO\.md" --include="*.ts" . | grep -v node_modules

# Em-Dash in Kommentaren: muss 0 Treffer ergeben
grep -rnE "^\s*(//|\*|/\*).*—" --include="*.ts" . | grep -v node_modules

# Englisch gebliebene Kommentare: Treffer sind Zitate oder ein Befund
grep -rnE "^\s*(//|\*|/\*)" --include="*.ts" . | grep -v node_modules \
  | grep -P "\b(the|and|of|to|that|with|not|this|are|be|which|would|because)\b"

# Datumslose Messaussagen: Treffer ohne Datum in der Nähe manuell ansehen
grep -n "gemessen\|measured" server.ts
```

## Bewusst nicht übernommen

| Gängige Regel | Warum hier nicht |
|---------------|------------------|
| Result-Typen, eigene Fehlerklassen | Überdimensioniert für die Anzahl der Handler; das MCP-Muster ist `errorResult()` oder throw + `abort()`. |
| Test-Framework, Coverage-Ziele | Kein Framework; verifiziert wird über einen stdio-Treiber gegen den echten Server (`tests/test-golden.ts`, Zusicherungen ohne `bun:test`, Aufruf mit `bun run test`) und per SQL gegen die echte DB. |
| Logging-Framework | `console.error` nach stderr ist im stdio-MCP-Kontext das richtige Logging (stdout gehört dem JSON-RPC). |
