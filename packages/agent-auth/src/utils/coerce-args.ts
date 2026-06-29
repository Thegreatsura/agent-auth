import type { Capability } from "../types";

type JsonSchema = Record<string, unknown>;

/**
 * Resolve the scalar JSON Schema `type` for a property, tolerating the
 * `["integer", "null"]` nullable form by picking the first concrete type.
 */
function schemaType(schema: unknown): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const t = (schema as JsonSchema).type;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) {
    const concrete = t.find((x) => typeof x === "string" && x !== "null");
    return typeof concrete === "string" ? concrete : undefined;
  }
  return undefined;
}

/**
 * Coerce a single string value toward a declared scalar type. Non-strings and
 * un-coercible values pass through untouched so downstream validation can still
 * report a genuinely wrong type.
 */
function coerceScalar(value: unknown, type: string | undefined): unknown {
  if (typeof value !== "string") return value;
  switch (type) {
    case "integer":
    case "number": {
      if (value.trim() === "") return value;
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case "boolean": {
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    }
    default:
      return value;
  }
}

/**
 * Coerce execution arguments to the types declared by the capability's `input`
 * JSON Schema.
 *
 * Why: arguments arrive from LLM tool calls as JSON where numbers and booleans
 * are frequently emitted as strings ("5", "true"). Downstream APIs and the
 * constraint matcher expect real numbers/booleans — e.g. a `{ maxResults:
 * { max: 5 } }` grant would otherwise reject a valid `maxResults: "5"`.
 *
 * Coerces only when the schema declares a scalar type, only for string inputs,
 * and never throws. Shallow by design: constrainable fields are top-level.
 * Returns the original object reference when nothing changed.
 */
export function coerceArgsToSchema(
  args: Record<string, unknown> | undefined,
  inputSchema: Capability["input"],
): Record<string, unknown> | undefined {
  if (!args) return args;
  if (!inputSchema || typeof inputSchema !== "object") return args;
  const properties = (inputSchema as JsonSchema).properties;
  if (!properties || typeof properties !== "object") return args;

  const props = properties as Record<string, unknown>;
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const coerced = coerceScalar(value, schemaType(props[key]));
    if (coerced !== value) changed = true;
    result[key] = coerced;
  }
  return changed ? result : args;
}
