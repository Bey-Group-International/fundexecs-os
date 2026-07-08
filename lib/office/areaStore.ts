/**
 * FundExecs OS — scripted-area store (persistence + validation).
 *
 * The WorkAdventure-style map editor lets an operator author scripted areas
 * (see `scriptedAreas.ts`) live on the floor. This module owns the pure,
 * framework-free glue between that editor and localStorage: it validates a
 * declarative area set, (de)serialises it, and loads/saves the persisted set
 * with the built-in `SCRIPTED_AREAS` as the default seed.
 *
 * The parse/validate/serialise core is dependency-free so it unit-tests in a
 * Node environment; only `loadScriptedAreas`/`saveScriptedAreas` touch a
 * `Storage`, and they accept one so tests can inject an in-memory stub. Saving
 * also emits a window event the scene/VOG can react to for a live re-render.
 */
import {
  SCRIPTED_AREAS,
  type AreaTrigger,
  type ScriptedArea,
} from "./scriptedAreas";

/** localStorage key the edited area set is persisted under. */
export const AREA_STORAGE_KEY = "office:scripted-areas";

/** Window event emitted after a save, so the scene can re-render live. */
export const AREA_STORE_EVENT = "office:areas-changed";

/** The trigger kinds the editor can author. */
export const AREA_TRIGGER_KINDS: AreaTrigger["kind"][] = ["say", "toast", "start-meeting"];

/** Minimal storage surface — `window.localStorage` satisfies it, as does a stub. */
export type AreaStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A structured validation outcome, so callers can surface a field-level error. */
export type ValidationResult =
  | { ok: true; area: ScriptedArea }
  | { ok: false; error: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

function validateTrigger(raw: unknown): { ok: true; trigger: AreaTrigger } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Trigger is required." };
  const t = raw as Record<string, unknown>;
  if (t.kind === "say" || t.kind === "toast") {
    const text = typeof t.text === "string" ? t.text.trim() : "";
    if (!text) return { ok: false, error: "This trigger needs some text." };
    return { ok: true, trigger: { kind: t.kind, text } };
  }
  if (t.kind === "start-meeting") return { ok: true, trigger: { kind: "start-meeting" } };
  return { ok: false, error: "Unknown trigger type." };
}

/**
 * Validate a single raw area, returning a normalized `ScriptedArea` (trimmed
 * strings, only the recognised fields) or a human-readable error. Pure.
 */
export function validateArea(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Area must be an object." };
  const a = raw as Record<string, unknown>;

  const id = typeof a.id === "string" ? a.id.trim() : "";
  if (!id) return { ok: false, error: "Area id is required." };

  const label = typeof a.label === "string" ? a.label.trim() : "";
  if (!label) return { ok: false, error: "Label is required." };

  if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y)) return { ok: false, error: "x and y must be numbers." };
  if (!isFiniteNumber(a.w) || a.w <= 0) return { ok: false, error: "Width must be greater than zero." };
  if (!isFiniteNumber(a.h) || a.h <= 0) return { ok: false, error: "Height must be greater than zero." };

  const trig = validateTrigger(a.trigger);
  if (!trig.ok) return trig;

  const area: ScriptedArea = { id, label, x: a.x, y: a.y, w: a.w, h: a.h, trigger: trig.trigger };
  if (a.once === true) area.once = true;
  if (isHexColor(a.accent)) area.accent = a.accent;
  return { ok: true, area };
}

/**
 * Validate a whole set: every entry must be valid and ids must be unique.
 * Returns the normalized areas or the first error encountered. Pure.
 */
export function validateAreas(raw: unknown): { ok: true; areas: ScriptedArea[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Expected a list of areas." };
  const areas: ScriptedArea[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const res = validateArea(entry);
    if (!res.ok) return res;
    if (seen.has(res.area.id)) return { ok: false, error: `Duplicate area id "${res.area.id}".` };
    seen.add(res.area.id);
    areas.push(res.area);
  }
  return { ok: true, areas };
}

/** Serialize an area set to the persisted JSON string. Pure. */
export function serializeAreas(areas: ScriptedArea[]): string {
  return JSON.stringify(areas);
}

/**
 * Parse a persisted JSON string into a valid area set, or fall back to the
 * built-in defaults when it is missing, malformed, or fails validation. Pure —
 * safe to call with a `localStorage.getItem` result (string | null). Returns a
 * deep copy of the defaults so callers can mutate freely.
 */
export function parseAreas(json: string | null): ScriptedArea[] {
  if (!json) return defaultAreas();
  try {
    const parsed = JSON.parse(json);
    const res = validateAreas(parsed);
    return res.ok ? res.areas : defaultAreas();
  } catch {
    return defaultAreas();
  }
}

/** A fresh deep copy of the built-in seed set. */
export function defaultAreas(): ScriptedArea[] {
  return SCRIPTED_AREAS.map((a) => ({ ...a, trigger: { ...a.trigger } }));
}

/** Resolve a storage: an explicit stub (tests) or `window.localStorage`, or null. */
function resolveStorage(storage?: AreaStorage): AreaStorage | null {
  if (storage) return storage;
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    /* access can throw in privacy modes */
  }
  return null;
}

/**
 * Load the persisted area set, seeding from the built-in defaults when nothing
 * has been saved (or the saved value is unusable). Never throws.
 */
export function loadScriptedAreas(storage?: AreaStorage): ScriptedArea[] {
  const store = resolveStorage(storage);
  if (!store) return defaultAreas();
  try {
    return parseAreas(store.getItem(AREA_STORAGE_KEY));
  } catch {
    return defaultAreas();
  }
}

/**
 * Persist an area set (validating first) and notify listeners so the live floor
 * re-renders. Returns the validation result. When `storage` is omitted it uses
 * `window.localStorage`; the window event only fires in a browser.
 */
export function saveScriptedAreas(
  areas: ScriptedArea[],
  storage?: AreaStorage,
): { ok: true; areas: ScriptedArea[] } | { ok: false; error: string } {
  const res = validateAreas(areas);
  if (!res.ok) return res;
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.setItem(AREA_STORAGE_KEY, serializeAreas(res.areas));
    } catch {
      /* quota / privacy mode — keep the in-memory set */
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AREA_STORE_EVENT, { detail: res.areas }));
  }
  return res;
}

/** Clear the persisted set so the floor reverts to the built-in defaults. */
export function resetScriptedAreas(storage?: AreaStorage): ScriptedArea[] {
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.removeItem(AREA_STORAGE_KEY);
    } catch {
      /* no-op */
    }
  }
  const areas = defaultAreas();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AREA_STORE_EVENT, { detail: areas }));
  }
  return areas;
}
