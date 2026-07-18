// lib/skills/validate.ts
// A dependency-free JSON-Schema validator — the SUBSET the skill runtime needs
// (type, required, properties, items, enum, min/max, minLength). Pure + tested.
// The repo deliberately avoids heavy deps (cf. the zero-dep cron parser and xlsx
// reader), and skill I/O schemas are small and hand-authored, so a focused
// validator is safer than pulling in a full JSON-Schema engine.
//
// Unknown schema keywords are IGNORED (never a validation failure), so a schema
// can carry documentation without breaking. Missing OPTIONAL fields pass; only
// declared `required` fields are enforced.

import type { JsonSchema, ValidationResult } from "./types";

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "object" | "string" | "number" | "boolean" | ...
}

function matchesType(value: unknown, type: NonNullable<JsonSchema["type"]>): boolean {
  const t = typeOf(value);
  if (type === "integer") return t === "number" && Number.isInteger(value as number);
  if (type === "number") return t === "number" && Number.isFinite(value as number);
  return t === type;
}

function validateNode(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path || "(root)"}: expected ${schema.type}, got ${typeOf(value)}`);
    return; // type mismatch — deeper checks would be noise.
  }

  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${path || "(root)"}: value ${JSON.stringify(value)} not in enum`);
  }

  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) {
      errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    }
    if (schema.maximum != null && value > schema.maximum) {
      errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
    }
  }

  if (typeof value === "string" && schema.minLength != null && value.length < schema.minLength) {
    errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
  }

  if (schema.type === "object" && typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
        errors.push(`${path ? `${path}.` : ""}${key}: required`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj && obj[key] !== undefined && obj[key] !== null) {
        validateNode(obj[key], sub, path ? `${path}.${key}` : key, errors);
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => validateNode(item, schema.items as JsonSchema, `${path}[${i}]`, errors));
  }
}

/** Validate a value against a JSON-Schema subset. Never throws. */
export function validate(value: unknown, schema: JsonSchema): ValidationResult {
  const errors: string[] = [];
  try {
    validateNode(value, schema, "", errors);
  } catch (e) {
    errors.push(`validator error: ${e instanceof Error ? e.message : "unknown"}`);
  }
  return { valid: errors.length === 0, errors };
}
