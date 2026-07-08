/**
 * FundExecs OS — operator availability status (Spot-style ambient presence).
 *
 * A small self-status the operator sets — Available / Focused / Do-not-disturb /
 * Away — shown on the floor's presence chrome so teammates can read whether
 * you're interruptible at a glance. This module owns the pure, framework-free
 * state: the status enum, its display metadata, and localStorage persistence.
 *
 * The core is dependency-free so it unit-tests in a Node environment; only the
 * load/save helpers touch a `Storage`, and they accept one so tests can inject
 * an in-memory stub. Saving emits a window event the UI reacts to live.
 */

export type PresenceStatus = "available" | "focus" | "dnd" | "away";

export type PresenceStatusMeta = {
  key: PresenceStatus;
  label: string;
  /** A short signal for the floor feed ("is focusing", "is away", …). */
  verb: string;
  /** Dot color (0xRRGGBB hex string) for the status indicator. */
  dot: string;
};

/** The statuses, in the order the pill cycles through them. */
export const PRESENCE_STATUSES: PresenceStatusMeta[] = [
  { key: "available", label: "Available", verb: "is available", dot: "#22c55e" },
  { key: "focus", label: "Focused", verb: "is focusing", dot: "#38bdf8" },
  { key: "dnd", label: "Do not disturb", verb: "is on do-not-disturb", dot: "#ef4444" },
  { key: "away", label: "Away", verb: "is away", dot: "#94a3b8" },
];

/** localStorage key the operator's status is persisted under. */
export const PRESENCE_STATUS_KEY = "office:presence-status";

/** Window event emitted after a change, so the UI can re-render live. */
export const PRESENCE_STATUS_EVENT = "office:presence-status-changed";

/** Minimal storage surface — `window.localStorage` satisfies it, as does a stub. */
export type StatusStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DEFAULT_STATUS: PresenceStatus = "available";

function isStatus(v: unknown): v is PresenceStatus {
  return PRESENCE_STATUSES.some((s) => s.key === v);
}

/** Metadata for a status, falling back to Available for an unknown key. Pure. */
export function statusMeta(status: PresenceStatus): PresenceStatusMeta {
  return PRESENCE_STATUSES.find((s) => s.key === status) ?? PRESENCE_STATUSES[0];
}

/** Parse a persisted value (string | null) to a valid status. Pure. */
export function parseStatus(raw: string | null): PresenceStatus {
  return isStatus(raw) ? raw : DEFAULT_STATUS;
}

/** The next status in the cycle — for a single click-to-advance pill. Pure. */
export function nextStatus(status: PresenceStatus): PresenceStatus {
  const i = PRESENCE_STATUSES.findIndex((s) => s.key === status);
  return PRESENCE_STATUSES[(i + 1) % PRESENCE_STATUSES.length].key;
}

/** Resolve a storage: an explicit stub (tests) or `window.localStorage`, or null. */
function resolveStorage(explicit?: StatusStorage): StatusStorage | null {
  if (explicit) return explicit;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

/** Load the operator's persisted status (defaults to Available). */
export function loadStatus(storage?: StatusStorage): PresenceStatus {
  const store = resolveStorage(storage);
  if (!store) return DEFAULT_STATUS;
  return parseStatus(store.getItem(PRESENCE_STATUS_KEY));
}

/** Persist the operator's status and emit the change event. */
export function saveStatus(status: PresenceStatus, storage?: StatusStorage): void {
  const store = resolveStorage(storage);
  if (store) store.setItem(PRESENCE_STATUS_KEY, status);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PRESENCE_STATUS_EVENT, { detail: status }));
  }
}
