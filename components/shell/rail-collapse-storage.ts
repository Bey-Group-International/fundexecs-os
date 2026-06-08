/**
 * Lightweight client persistence for the side rail's manual expand/collapse
 * state, per section. UX-only — this never gates data or auth. Backed by
 * `localStorage` and exposed as a tiny external store so the rail can consume
 * it via `useSyncExternalStore` (SSR-safe, no hydration mismatch, no
 * setState-in-effect).
 *
 * Shape: a partial map of section key → user's explicit open/closed choice. A
 * section absent from the map has no manual override and falls back to that
 * section's default (cluster auto-expand logic, or a section's own default).
 * Keys are the rail-group keys (`build`/`source`/…) plus rail pseudo-sections
 * like `momentum` (the operating spine).
 */

const STORAGE_KEY = 'fx.rail.collapse.v1';

export type RailCollapseState = Record<string, boolean>;

/** Stable empty snapshot — same identity every read so SSR/initial render is stable. */
const EMPTY: RailCollapseState = {};

/** Client-side cache so getSnapshot returns a referentially-stable object. */
let cache: RailCollapseState | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): RailCollapseState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: RailCollapseState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function load(): RailCollapseState {
  if (typeof window === 'undefined') return EMPTY;
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Subscribe to override changes (this tab's writes + cross-tab `storage`). */
export function subscribeRailCollapse(callback: () => void): () => void {
  listeners.add(callback);
  function onStorage(e: StorageEvent) {
    if (e.key === STORAGE_KEY) {
      cache = parse(e.newValue);
      callback();
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/** Current overrides snapshot (referentially stable until a write occurs). */
export function getRailCollapseSnapshot(): RailCollapseState {
  if (typeof window === 'undefined') return EMPTY;
  if (cache === null) cache = load();
  return cache;
}

/** Server snapshot — always the stable empty map. */
export function getRailCollapseServerSnapshot(): RailCollapseState {
  return EMPTY;
}

/** Persist a single section's manual override and notify subscribers. */
export function writeRailCollapseState(key: string, expanded: boolean): void {
  cache = { ...getRailCollapseSnapshot(), [key]: expanded };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      // ignore — persistence is best-effort, UX-only
    }
  }
  for (const listener of listeners) listener();
}
