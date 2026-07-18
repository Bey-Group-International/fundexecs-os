/**
 * Minimal, dependency-free JSON Schema (draft-07 subset) validator.
 *
 * The repo does not ship ajv/zod, and adding a heavy dependency for build-time
 * validation is undesirable. This covers exactly the keywords our schemas use:
 * type, properties, required, additionalProperties, items, enum, const,
 * minimum/maximum, minLength/maxLength, minItems/maxItems, pattern, $ref
 * (local "#/definitions/*"), oneOf, and nullable via type arrays.
 *
 * It returns *actionable* messages (JSON pointer path + reason) rather than a
 * single generic failure, satisfying the brief's "display actionable
 * validation messages" requirement.
 */

export interface ValidationError {
  path: string;
  message: string;
}

export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  title?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  definitions?: Record<string, JsonSchema>;
  patternProperties?: Record<string, JsonSchema>;
  [k: string]: unknown;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  switch (t) {
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "number":
      return typeof v === "number";
    case "string":
      return typeof v === "string";
    case "boolean":
      return typeof v === "boolean";
    case "object":
      return typeOf(v) === "object";
    case "array":
      return Array.isArray(v);
    case "null":
      return v === null;
    default:
      return false;
  }
}

export function validate(
  data: unknown,
  schema: JsonSchema,
  root: JsonSchema = schema,
  path = "",
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    if (!resolved) {
      errors.push({ path, message: `unresolved $ref ${schema.$ref}` });
      return errors;
    }
    return validate(data, resolved, root, path);
  }

  if (schema.const !== undefined && JSON.stringify(data) !== JSON.stringify(schema.const)) {
    errors.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
  }

  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(data))) {
    errors.push({ path, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}` });
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(data, t))) {
      errors.push({ path, message: `expected type ${types.join("|")}, got ${typeOf(data)}` });
      return errors; // further checks would be noise once type is wrong
    }
  }

  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum)
      errors.push({ path, message: `must be >= ${schema.minimum}` });
    if (schema.maximum !== undefined && data > schema.maximum)
      errors.push({ path, message: `must be <= ${schema.maximum}` });
  }

  if (typeof data === "string") {
    if (schema.minLength !== undefined && data.length < schema.minLength)
      errors.push({ path, message: `must have length >= ${schema.minLength}` });
    if (schema.maxLength !== undefined && data.length > schema.maxLength)
      errors.push({ path, message: `must have length <= ${schema.maxLength}` });
    if (schema.pattern && !new RegExp(schema.pattern).test(data))
      errors.push({ path, message: `must match /${schema.pattern}/` });
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems)
      errors.push({ path, message: `must have >= ${schema.minItems} items` });
    if (schema.maxItems !== undefined && data.length > schema.maxItems)
      errors.push({ path, message: `must have <= ${schema.maxItems} items` });
    if (schema.items) {
      data.forEach((item, i) => {
        errors.push(...validate(item, schema.items!, root, `${path}/${i}`));
      });
    }
  }

  if (typeOf(data) === "object") {
    const obj = data as Record<string, unknown>;
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) errors.push({ path: `${path}/${key}`, message: "required property missing" });
      }
    }
    const props = schema.properties ?? {};
    for (const [key, value] of Object.entries(obj)) {
      // Absent optional properties surface as `undefined` on in-memory objects;
      // JSON serialization drops them entirely, so treat them as not present.
      if (value === undefined) continue;
      const childPath = `${path}/${key}`;
      if (props[key]) {
        errors.push(...validate(value, props[key], root, childPath));
      } else if (schema.patternProperties) {
        const pat = Object.entries(schema.patternProperties).find(([p]) => new RegExp(p).test(key));
        if (pat) errors.push(...validate(value, pat[1], root, childPath));
      } else if (schema.additionalProperties === false) {
        errors.push({ path: childPath, message: "additional property not allowed" });
      } else if (typeof schema.additionalProperties === "object") {
        errors.push(...validate(value, schema.additionalProperties, root, childPath));
      }
    }
  }

  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => validate(data, s, root, path).length === 0);
    if (passing.length !== 1)
      errors.push({ path, message: `must match exactly one schema (matched ${passing.length})` });
  }
  if (schema.anyOf) {
    const passing = schema.anyOf.some((s) => validate(data, s, root, path).length === 0);
    if (!passing) errors.push({ path, message: "must match at least one schema" });
  }

  return errors;
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema | null {
  if (!ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let cur: unknown = root;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return cur as JsonSchema;
}

/** Convenience: format errors as human-readable lines. */
export function formatErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "valid";
  return errors.map((e) => `  • ${e.path || "(root)"}: ${e.message}`).join("\n");
}
