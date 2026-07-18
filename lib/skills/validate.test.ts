// Tests for the dependency-free JSON-Schema subset validator.
import { validate } from "./validate";
import type { JsonSchema } from "./types";

const schema: JsonSchema = {
  type: "object",
  required: ["name", "amount"],
  properties: {
    name: { type: "string", minLength: 1 },
    amount: { type: "number", minimum: 0, maximum: 100 },
    kind: { type: "string", enum: ["a", "b"] },
    tags: { type: "array", items: { type: "string" } },
    nested: { type: "object", required: ["x"], properties: { x: { type: "integer" } } },
  },
};

describe("validate", () => {
  it("accepts a valid object", () => {
    const r = validate({ name: "ok", amount: 50, kind: "a", tags: ["x"], nested: { x: 3 } }, schema);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("flags missing required fields", () => {
    const r = validate({ name: "ok" }, schema);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("amount: required");
  });

  it("flags type mismatches", () => {
    const r = validate({ name: 5, amount: "x" }, schema);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("enforces enum, min/max, and integer", () => {
    expect(validate({ name: "n", amount: 200 }, schema).valid).toBe(false); // > max
    expect(validate({ name: "n", amount: 10, kind: "z" }, schema).valid).toBe(false); // enum
    expect(validate({ name: "n", amount: 10, nested: { x: 1.5 } }, schema).valid).toBe(false); // integer
  });

  it("validates array items", () => {
    expect(validate({ name: "n", amount: 1, tags: ["a", 2] }, schema).valid).toBe(false);
  });

  it("ignores optional missing fields and unknown keywords", () => {
    expect(validate({ name: "n", amount: 1, extra: "whatever" }, schema).valid).toBe(true);
  });

  it("never throws on odd input", () => {
    expect(() => validate(null, schema)).not.toThrow();
    expect(() => validate(undefined, schema)).not.toThrow();
  });
});
