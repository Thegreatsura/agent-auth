import { describe, expect, it } from "vitest";
import { coerceArgsToSchema } from "../utils/coerce-args";

const schema = {
  type: "object",
  properties: {
    maxResults: { type: "integer" },
    amount: { type: "number" },
    dryRun: { type: "boolean" },
    label: { type: "string" },
    nullableCount: { type: ["integer", "null"] },
  },
};

describe("coerceArgsToSchema", () => {
  it("coerces numeric strings to numbers per the declared type", () => {
    expect(coerceArgsToSchema({ maxResults: "5" }, schema)).toEqual({ maxResults: 5 });
    expect(coerceArgsToSchema({ amount: "12.5" }, schema)).toEqual({ amount: 12.5 });
  });

  it("coerces 'true'/'false' to booleans only", () => {
    expect(coerceArgsToSchema({ dryRun: "true" }, schema)).toEqual({ dryRun: true });
    expect(coerceArgsToSchema({ dryRun: "false" }, schema)).toEqual({ dryRun: false });
    // not a boolean literal — left untouched
    expect(coerceArgsToSchema({ dryRun: "yes" }, schema)).toEqual({ dryRun: "yes" });
  });

  it("leaves string-typed fields and already-correct values untouched", () => {
    expect(coerceArgsToSchema({ label: "5" }, schema)).toEqual({ label: "5" });
    expect(coerceArgsToSchema({ maxResults: 5 }, schema)).toEqual({ maxResults: 5 });
  });

  it("does not coerce non-numeric strings (so validation still flags them)", () => {
    expect(coerceArgsToSchema({ maxResults: "abc" }, schema)).toEqual({ maxResults: "abc" });
    expect(coerceArgsToSchema({ amount: "" }, schema)).toEqual({ amount: "" });
  });

  it("handles nullable type arrays by using the concrete type", () => {
    expect(coerceArgsToSchema({ nullableCount: "3" }, schema)).toEqual({ nullableCount: 3 });
  });

  it("ignores fields not present in the schema", () => {
    expect(coerceArgsToSchema({ unknownField: "5" }, schema)).toEqual({ unknownField: "5" });
  });

  it("returns the same reference when there is no schema or nothing to change", () => {
    const args = { maxResults: 5 };
    expect(coerceArgsToSchema(args, undefined)).toBe(args);
    expect(coerceArgsToSchema(args, { type: "object" })).toBe(args);
    expect(coerceArgsToSchema(args, schema)).toBe(args);
  });

  it("returns undefined args unchanged", () => {
    expect(coerceArgsToSchema(undefined, schema)).toBeUndefined();
  });
});
