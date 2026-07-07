// lib/office/floor-activity.ts
// The Executive Floor's live activity feed contract. Real floor moments — Earn
// routing work, a meeting starting, a deal room opening, a listing published,
// someone joining — are announced through a single `floor:activity` window
// event, which the in-world FloorActivityFeed renders as a rolling ticker.
// Keeping the emitter and metadata here lets any surface post to the feed
// without importing the Phaser tree.

export type FloorActivityKind = "work" | "meeting" | "deal" | "listing" | "presence";

export type FloorEvent = {
  id: string;
  ts: number;
  kind: FloorActivityKind;
  text: string;
};

/** Per-kind display metadata — a short label and an accent color for the dot. */
export const FLOOR_ACTIVITY_META: Record<FloorActivityKind, { label: string; color: string }> = {
  work: { label: "Work", color: "#fbbf24" },
  meeting: { label: "Meeting", color: "#38bdf8" },
  deal: { label: "Deal room", color: "#c9a84c" },
  listing: { label: "Marketplace", color: "#2dd4bf" },
  presence: { label: "Presence", color: "#a855f7" },
};

export const FLOOR_ACTIVITY_EVENT = "floor:activity";

/**
 * Announce a floor moment. Fire-and-forget: dispatches a `floor:activity` window
 * CustomEvent the feed listens for. No-op on the server (no window).
 */
export function emitFloorActivity(kind: FloorActivityKind, text: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FLOOR_ACTIVITY_EVENT, { detail: { kind, text } }));
}

/**
 * Compact relative time for a feed entry: "now", "45s", "12m", "3h", then a
 * date-free day count "2d". Pure so it can be unit-tested; callers pass `now`.
 */
export function relativeTime(ts: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - ts) / 1000));
  if (secs < 5) return "now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
