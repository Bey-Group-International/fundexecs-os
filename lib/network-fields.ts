// lib/network-fields.ts
//
// Org-defined columns: the definitions, and the rules for what may be stored
// against them.
//
// Values live in a `custom` jsonb column on the row they describe, which means
// the database cannot type-check them the way it does a real column. That check
// has to happen here instead, on every write — otherwise "AUM" holds the number
// 2000000 for one contact, the string "$2m" for the next, and the column stops
// being sortable or reportable, which was the entire point of having it.
//
// So coerceFieldValue is the gate, and it is deliberately strict about types
// while being forgiving about shape: it accepts "2,000,000" and stores 2000000,
// accepts a date string and stores an ISO day, and rejects what it cannot read
// rather than silently keeping a string in a number column.

export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "currency",
  "percent",
  "date",
  "boolean",
  "select",
  "multi_select",
  "url",
  "email",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_ENTITIES = ["contact", "opportunity"] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];

export interface FieldDef {
  id: string;
  entity: FieldEntity;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  helpText: string | null;
  required: boolean;
  position: number;
}

/** Mirrors the field_key check constraint in 20260919140000. */
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

const MAX_TEXT = 500;
const MAX_LONG_TEXT = 10_000;
const MAX_SELECT_VALUES = 50;

/** Narrow an unchecked value from a request body to a supported column type. */
export function isFieldType(v: unknown): v is FieldType {
  return typeof v === "string" && (FIELD_TYPES as readonly string[]).includes(v);
}

/** Narrow an unchecked value to an object custom columns can be defined on. */
export function isFieldEntity(v: unknown): v is FieldEntity {
  return typeof v === "string" && (FIELD_ENTITIES as readonly string[]).includes(v);
}

/**
 * Turn a label into a usable field_key.
 *
 * "Investment Committee Date" → "investment_committee_date". A key that would
 * start with a digit gets an `f_` prefix rather than being rejected, so
 * "2024 Target" still produces something storable.
 */
export function slugifyFieldKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!base) return "";
  return KEY_PATTERN.test(base) ? base : `f_${base}`.slice(0, 40).replace(/_+$/, "");
}

/**
 * Whether a key satisfies the `network_field_defs.field_key` check constraint.
 *
 * Checked here so a bad key is a 400 rather than an opaque constraint error.
 */
export function isValidFieldKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

function emptyish(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** Parse a number the way a person types one: "2,000,000", "$2000000", "1.5". */
function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[,$\s]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate and normalise one value against its definition.
 *
 * Returns the value to STORE, which may differ from what was typed. An empty
 * value clears the field (null) unless the definition marks it required.
 */
export function coerceFieldValue(def: FieldDef, raw: unknown): CoerceResult {
  if (emptyish(raw)) {
    if (def.required) return { ok: false, error: `${def.label} is required.` };
    return { ok: true, value: null };
  }

  switch (def.type) {
    case "text":
    case "long_text": {
      const s = String(raw).trim();
      const max = def.type === "text" ? MAX_TEXT : MAX_LONG_TEXT;
      return { ok: true, value: s.slice(0, max) };
    }

    case "number":
    case "currency": {
      const n = parseNumber(raw);
      if (n === null) return { ok: false, error: `${def.label} must be a number.` };
      return { ok: true, value: n };
    }

    case "percent": {
      const n = parseNumber(typeof raw === "string" ? raw.replace(/%/g, "") : raw);
      if (n === null) return { ok: false, error: `${def.label} must be a number.` };
      if (n < 0 || n > 100) {
        return { ok: false, error: `${def.label} must be between 0 and 100.` };
      }
      return { ok: true, value: n };
    }

    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const s = String(raw).trim().toLowerCase();
      if (["true", "yes", "1", "y"].includes(s)) return { ok: true, value: true };
      if (["false", "no", "0", "n"].includes(s)) return { ok: true, value: false };
      return { ok: false, error: `${def.label} must be true or false.` };
    }

    case "date": {
      const text = String(raw).trim();
      const ms = Date.parse(text);
      if (Number.isNaN(ms)) return { ok: false, error: `${def.label} must be a valid date.` };
      const day = new Date(ms).toISOString().slice(0, 10);

      // Date.parse ROLLS OVER an impossible calendar date rather than refusing
      // it: "2026-02-30" parses happily and comes back as 2026-03-02. Storing
      // that silently changes what someone typed, so a plain YYYY-MM-DD input
      // has to round-trip to itself to be accepted. This also catches
      // "2025-02-29" in a non-leap year.
      const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (plain && day !== text) {
        return { ok: false, error: `${def.label} is not a real date.` };
      }

      // Stored as a plain day. A committee date is a date, not an instant, and
      // keeping a timezone on it makes it drift across a date line.
      return { ok: true, value: day };
    }

    case "email": {
      const s = String(raw).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        return { ok: false, error: `${def.label} must be a valid email address.` };
      }
      return { ok: true, value: s.slice(0, MAX_TEXT) };
    }

    case "url": {
      const s = String(raw).trim();
      // A bare domain is what people paste; make it a URL rather than refusing.
      const candidate = /^https?:\/\//i.test(s) ? s : `https://${s}`;
      try {
        const parsed = new URL(candidate);
        // Only web schemes: a javascript: or data: value here would be rendered
        // as a link on the record page.
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { ok: false, error: `${def.label} must be a web address.` };
        }
        return { ok: true, value: parsed.toString().slice(0, MAX_TEXT) };
      } catch {
        return { ok: false, error: `${def.label} must be a valid URL.` };
      }
    }

    case "select": {
      const s = String(raw).trim();
      if (def.options.length > 0 && !def.options.includes(s)) {
        return { ok: false, error: `${def.label} must be one of: ${def.options.join(", ")}.` };
      }
      return { ok: true, value: s.slice(0, MAX_TEXT) };
    }

    case "multi_select": {
      const list = Array.isArray(raw) ? raw : String(raw).split(",");
      const values = [...new Set(list.map((v) => String(v).trim()).filter(Boolean))].slice(
        0,
        MAX_SELECT_VALUES,
      );
      if (def.options.length > 0) {
        const unknown = values.filter((v) => !def.options.includes(v));
        if (unknown.length > 0) {
          return {
            ok: false,
            error: `${def.label} has unknown value${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`,
          };
        }
      }
      return { ok: true, value: values };
    }

    default:
      return { ok: false, error: `${def.label} has an unsupported type.` };
  }
}

export interface CustomPatchResult {
  ok: boolean;
  /** The merged custom object to store. */
  custom: Record<string, unknown>;
  /** Keys the patch cleared, so a caller doing a database-side merge knows
   *  what to remove rather than inferring it from the merged object. */
  removed: string[];
  errors: string[];
}

export interface CustomPatchOptions {
  /** Creating a record rather than editing one. A required column has to be
   *  supplied at creation, but must NOT be demanded again on an unrelated
   *  partial update — the value is already on the row. */
  creating?: boolean;
}

/**
 * Merge a patch of custom values onto what a row already holds.
 *
 * Only keys the org has actually defined are written — an unknown key is
 * ignored rather than stored, so a stale client or a hand-rolled request cannot
 * accumulate junk in the jsonb that no column definition explains. A key set to
 * null is removed outright rather than stored as a null.
 */
export function applyCustomPatch(
  defs: FieldDef[],
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
  options: CustomPatchOptions = {},
): CustomPatchResult {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const custom: Record<string, unknown> = { ...existing };
  const removed: string[] = [];
  const errors: string[] = [];

  for (const [key, raw] of Object.entries(patch)) {
    const def = byKey.get(key);
    if (!def) continue;

    const result = coerceFieldValue(def, raw);
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    if (result.value === null) {
      delete custom[key];
      removed.push(key);
    } else {
      custom[key] = result.value;
    }
  }

  // On creation every required column must end up with a value. Without this a
  // client can simply omit a required key and the record is born incomplete,
  // because coerceFieldValue only sees the keys it was handed.
  if (options.creating) {
    for (const def of defs) {
      if (def.required && (custom[def.key] === undefined || custom[def.key] === null)) {
        errors.push(`${def.label} is required.`);
      }
    }
  }

  return { ok: errors.length === 0, custom, removed, errors };
}

/** Map a network_field_defs row onto the client shape. */
export function mapFieldDef(row: Record<string, unknown>): FieldDef {
  const rawOptions = row.options;
  return {
    id: String(row.id),
    entity: isFieldEntity(row.entity) ? row.entity : "contact",
    key: String(row.field_key),
    label: String(row.label),
    type: isFieldType(row.field_type) ? row.field_type : "text",
    options: Array.isArray(rawOptions)
      ? rawOptions.filter((o): o is string => typeof o === "string")
      : [],
    helpText: typeof row.help_text === "string" ? row.help_text : null,
    required: row.is_required === true,
    position: typeof row.position === "number" ? row.position : 0,
  };
}
