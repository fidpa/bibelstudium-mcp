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
  `verses`-Normalisierung in `server.ts`.
- Heruntergeladene Strukturen prüfen, bevor sie in die DB gelangen
  (`Array.isArray`, Feldprüfungen wie in `download.ts`), und werfen statt still
  weiterlaufen: Der `abort()`-Pfad lässt die Live-DB unangetastet.
- Ungültige Nutzereingabe → klare Fehlermeldung als Tool-Ergebnis
  (`isError: true`); niemals eine Exception in die JSON-RPC-Schicht entkommen
  lassen.

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

## Bewusst nicht übernommen

| Gängige Regel | Warum hier nicht |
|---------------|------------------|
| Result-Typen, eigene Fehlerklassen | Überdimensioniert für die Anzahl der Handler; das MCP-Muster ist `errorResult()` oder throw + `abort()`. |
| Test-Framework, Coverage-Ziele | Kein Framework; verifiziert wird über einen stdio-Treiber gegen den echten Server (`tests/test-golden.ts`, Zusicherungen ohne `bun:test`, Aufruf mit `bun run test`) und per SQL gegen die echte DB. |
| Logging-Framework | `console.error` nach stderr ist im stdio-MCP-Kontext das richtige Logging (stdout gehört dem JSON-RPC). |
