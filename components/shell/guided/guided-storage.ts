/**
 * Client persistence for Guided Mode (Phase 5) — the hand-on-the-wheel
 * walkthrough that drives the operating loop turn by turn. UX-only; never gates
 * data or auth. Backed by `localStorage` and exposed as a tiny external store so
 * both the rail's launch button and the shell-level overlay consume one source
 * of truth via `useSyncExternalStore` (SSR-safe, no hydration mismatch).
 *
 * Shape: `{ on, collapsed }`. `on` is whether guided mode is engaged;
 * `collapsed` is whether it's minimized to the docked pill (so the operator can
 * actually work the surface) versus showing the full focus card.
 */

const STORAGE_KEY = 'fx.guided.v1';

export interface GuidedState {
  /** Whether guided mode is engaged. */
  on: boolean;
  /** Whether the focus card is minimized to the docked pill. */
  collapsed: boolean;
  /** Whether the operator has explicitly toggled guided mode. Once true, the
   *  low-readiness auto-engage never fires (we don't re-open what they closed). */
  userSet: boolean;
}

/** Stable default — same identity every read so SSR/initial render is stable. */
const DEFAULT: GuidedState = { on: false, collapsed: false, userSet: false };

let cache: GuidedState | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): GuidedState {
  if (!raw) return DEFAULT;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return DEFAULT;
    const obj = parsed as Record<string, unknown>;
    return {
      on: typeof obj.on === 'boolean' ? obj.on : false,
      collapsed: typeof obj.collapsed === 'boolean' ? obj.collapsed : false,
      userSet: typeof obj.userSet === 'boolean' ? obj.userSet : false
    };
  } catch {
    return DEFAULT;
  }
}

function load(): GuidedState {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT;
  }
}

/** Subscribe to guided-state changes (this tab's writes + cross-tab `storage`). */
export function subscribeGuided(callback: () => void): () => void {
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

/** Current snapshot (referentially stable until a write occurs). */
export function getGuidedSnapshot(): GuidedState {
  if (typeof window === 'undefined') return DEFAULT;
  if (cache === null) cache = load();
  return cache;
}

/** Server snapshot — always the stable default. */
export function getGuidedServerSnapshot(): GuidedState {
  return DEFAULT;
}

function write(next: GuidedState): void {
  cache = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore — persistence is best-effort, UX-only
    }
  }
  for (const listener of listeners) listener();
}

/** Engage or disengage guided mode (an explicit operator action). Engaging
 *  always opens the focus card; either way it marks the choice as user-set. */
export function setGuidedOn(on: boolean): void {
  write({ on, collapsed: false, userSet: true });
}

/** Minimize the focus card to the pill (or restore it). */
export function setGuidedCollapsed(collapsed: boolean): void {
  const cur = getGuidedSnapshot();
  if (!cur.on) return;
  write({ on: true, collapsed, userSet: true });
}

/**
 * Auto-surface guided mode for a low-readiness / new operator — as the calm
 * docked pill, not the blocking card. No-op once the operator has set guided
 * themselves, or if it's already engaged, so we never re-open what they closed.
 */
export function autoEngageGuided(): void {
  const cur = getGuidedSnapshot();
  if (cur.userSet || cur.on) return;
  write({ on: true, collapsed: true, userSet: false });
}
