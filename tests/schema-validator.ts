/**
 * Minimal JSON Schema validator, shared by the two checks that need one:
 * `test-golden.ts` (fixed cases, run before every commit) and
 * `schema-coverage.ts` (breadth, run by hand after schema changes).
 *
 * Deliberately not a general implementation. It covers exactly the subset the
 * output schemas use: `type` (single or a union list like ["string","null"]),
 * `properties`, `required`, `items`, and `additionalProperties` as a schema.
 * Everything beyond that would be untested code guarding tested code; ajv as a
 * devDependency would be fine too (the runtime stays at one dependency either
 * way), it would just be 95 % unused here.
 *
 * It lives in its own file rather than in `test-golden.ts` because a second
 * caller appeared: two copies of a validator are two chances to fix only one of
 * them. `test-golden.ts` checks it against known-broken payloads — a validator
 * that accepts everything is indistinguishable from a passing test, and that is
 * the one defect this file cannot report about itself.
 */

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `typeof` is not enough: null, arrays and integers each need their own case. */
function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "object": return isRecord(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    // An unknown keyword must fail rather than pass: silently accepting it would
    // turn a typo in a schema into a permanently green test.
    default: return false;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Returns the violations, empty when valid. */
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
    // Stop here: with the wrong type every nested message would be noise about
    // the same single defect.
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
    // Only meaningful as a schema (the dynamic-key maps such as `in_dieser_db`);
    // `additionalProperties: false` is not used anywhere and stays unsupported.
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
