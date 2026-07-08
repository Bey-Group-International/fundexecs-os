/**
 * FundExecs OS — desk claim (Spot-style persistent desk / "your spot").
 *
 * The floor already seats executives at per-department desks and lets the
 * operator sit at the nearest free one (press E). This adds a persistent claim:
 * the operator can mark one seat as *their* desk, which is then reserved for
 * them (executives won't take it), badged on the floor, and reachable with a
 * single "Go to my desk".
 *
 * This module owns the pure, framework-free state: a stable seat key + which
 * seat is claimed, persisted to localStorage. The core is dependency-free so it
 * unit-tests in Node; only the load/save helpers touch a `Storage`, and they
 * accept one so tests can inject a stub. Saving emits a window event the scene
 * and UI react to live.
 */

/** localStorage key the claimed desk is persisted under. */
export const DESK_CLAIM_KEY = "office:claimed-desk";

/** Window event emitted after a claim/release, so the scene + UI update live. */
export const DESK_CLAIM_EVENT = "office:desk-claim-changed";

/** Minimal storage surface — `window.localStorage` satisfies it, as does a stub. */
export type DeskStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The shape of a seat we key on (room-relative anchor). */
export type SeatLike = { roomKey: string; x: number; y: number };

/**
 * A stable id for a seat: its room + rounded position. Room keys never contain
 * a colon, so this parses back unambiguously. Pure.
 */
export function seatKey(seat: SeatLike): string {
  return `${seat.roomKey}:${Math.round(seat.x)}:${Math.round(seat.y)}`;
}

/** The room key a claimed-desk key belongs to. Pure. */
export function roomOfDeskKey(key: string): string {
  return key.split(":")[0] ?? "";
}

/** Resolve a storage: an explicit stub (tests) or `window.localStorage`, or null. */
function resolveStorage(explicit?: DeskStorage): DeskStorage | null {
  if (explicit) return explicit;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

/** The currently-claimed desk key, or null if none. */
export function loadClaimedDesk(storage?: DeskStorage): string | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  const v = store.getItem(DESK_CLAIM_KEY);
  return v && v.length > 0 ? v : null;
}

/** Whether a given seat key is the claimed desk. */
export function isClaimedDesk(key: string, storage?: DeskStorage): boolean {
  return !!key && loadClaimedDesk(storage) === key;
}

function emit(key: string | null): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DESK_CLAIM_EVENT, { detail: key }));
  }
}

/** Claim a seat as the operator's desk. Returns the claimed key. */
export function claimDesk(key: string, storage?: DeskStorage): string | null {
  if (!key) return loadClaimedDesk(storage);
  const store = resolveStorage(storage);
  if (store) store.setItem(DESK_CLAIM_KEY, key);
  emit(key);
  return key;
}

/** Release the claimed desk. */
export function releaseDesk(storage?: DeskStorage): void {
  const store = resolveStorage(storage);
  if (store) store.removeItem(DESK_CLAIM_KEY);
  emit(null);
}
