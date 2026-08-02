/**
 * Knapper JSON-Schema-Prüfer, geteilt von den beiden Prüfungen, die einen
 * brauchen: `test-golden.ts` (feste Fälle, läuft vor jedem Commit) und
 * `schema-coverage.ts` (Breite, von Hand nach Schemaänderungen).
 *
 * Bewusst keine allgemeine Umsetzung. Er deckt genau den Ausschnitt ab, den die
 * Ausgabeschemata nutzen: `type` (einzeln oder als Liste wie
 * ["string","null"]), `properties`, `required`, `items` und
 * `additionalProperties` als Schema. Alles darüber hinaus wäre ungetesteter
 * Code, der getesteten Code bewacht; ajv als devDependency wäre ebenso in
 * Ordnung (die Laufzeit bliebe so oder so bei einer Abhängigkeit), es läge hier
 * nur zu 95 Prozent brach.
 *
 * Er steht in einer eigenen Datei und nicht in `test-golden.ts`, weil ein
 * zweiter Aufrufer hinzukam: Zwei Kopien eines Prüfers sind zwei Gelegenheiten,
 * nur eine davon zu reparieren. `test-golden.ts` hält ihn gegen bekannt kaputte
 * Nutzlasten. Ein Prüfer, der alles durchwinkt, ist von einem bestandenen Test
 * nicht zu unterscheiden, und das ist der eine Fehler, den diese Datei über
 * sich selbst nicht melden kann.
 */

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `typeof` genügt nicht: null, Arrays und Ganzzahlen brauchen je einen eigenen Zweig. */
function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "object": return isRecord(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    // Ein unbekanntes Schlüsselwort muss scheitern statt durchgehen: Still
    // angenommen, machte ein Tippfehler im Schema den Test dauerhaft grün.
    default: return false;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Liefert die Verstöße, leer bei gültiger Nutzlast. */
export function schemaErrors(schema: Json, value: unknown, path = ""): string[] {
  const out: string[] = [];
  const where = path === "" ? "<root>" : path;
  const types =
    schema.type === undefined
      ? []
      : Array.isArray(schema.type)
        ? (schema.type as string[])
        : [String(schema.type)];

  if (types.length > 0 && !types.some((t) => matchesType(t, value))) {
    // Hier abbrechen: Beim falschen Typ wäre jede verschachtelte Meldung nur
    // Rauschen über denselben einen Fehler.
    return [`${where}: erwartet ${types.join("|")}, war ${describe(value)}`];
  }

  if (isRecord(value)) {
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in value)) out.push(`${where}: Pflichtfeld '${key}' fehlt`);
    }
    const props = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in value && isRecord(sub)) out.push(...schemaErrors(sub, value[key], `${path}/${key}`));
    }
    // Sinnvoll nur als Schema (die Abbildungen mit dynamischen Schlüsseln wie
    // `in_dieser_db`); `additionalProperties: false` kommt nirgends vor und
    // bleibt deshalb unbedient.
    if (isRecord(schema.additionalProperties)) {
      for (const [key, sub] of Object.entries(value)) {
        if (!(key in props)) {
          out.push(...schemaErrors(schema.additionalProperties, sub, `${path}/${key}`));
        }
      }
    }
  }

  if (Array.isArray(value) && isRecord(schema.items)) {
    value.forEach((item, i) => out.push(...schemaErrors(schema.items as Json, item, `${path}/${i}`)));
  }

  return out;
}
