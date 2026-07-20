// Presence + proximity logic for the Virtual Office.
//
// Pure functions over participant positions: distance, who is within
// conversation range ("Spatial Meetings", SoWork-style), and a proximity
// volume falloff that models spatial audio even while the reboot is
// presence-only (used to fade/scale nearby avatars and draw the voice ring).
import { PROXIMITY_RADIUS } from "./layout";

export type PresenceStatus = "available" | "focusing" | "away" | "in_meeting";

export type ParticipantKind = "human" | "agent";

export interface Participant {
  /** Presence key — a user id for humans, the agent key for agents. */
  id: string;
  name: string;
  kind: ParticipantKind;
  /** Position in tile space. */
  x: number;
  y: number;
  /** Avatar accent color (hex). */
  color: string;
  status: PresenceStatus;
  /** Agents only: the catalog key and one-line role. */
  agentKey?: string;
  role?: string;
  /** Transient emote glyph shown above the avatar, if any. */
  emote?: string | null;
  /** Agents only: a short live-activity phrase shown under the name. */
  activityLabel?: string;
  /** Agents only: whether the agent is actively working (drives a busy pulse). */
  busy?: boolean;
}

export const STATUS_LABELS: Record<PresenceStatus, string> = {
  available: "Available",
  focusing: "Focusing",
  away: "Away",
  in_meeting: "In a meeting",
};

export const STATUS_COLORS: Record<PresenceStatus, string> = {
  available: "#22c55e",
  focusing: "#f59e0b",
  away: "#94a3b8",
  in_meeting: "#ef4444",
};

/** Euclidean distance in tile space. */
export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Participants within conversation range of `me`, nearest first. Excludes `me`
 * and anyone flagged "away" (out of the spatial conversation, like SoWork).
 */
export function nearby(
  me: { x: number; y: number },
  others: Participant[],
  radius: number = PROXIMITY_RADIUS,
): Participant[] {
  return others
    .filter((p) => p.status !== "away")
    .map((p) => ({ p, d: distance(me, p) }))
    .filter(({ d }) => d <= radius)
    .sort((a, b) => a.d - b.d)
    .map(({ p }) => p);
}

/**
 * Spatial-audio-style volume for a participant `dist` tiles away: 1 when
 * co-located, smoothly falling to 0 at (and beyond) the proximity radius.
 */
export function proximityVolume(
  dist: number,
  radius: number = PROXIMITY_RADIUS,
): number {
  if (dist <= 0) return 1;
  if (dist >= radius) return 0;
  const t = 1 - dist / radius;
  // Smoothstep for a natural falloff rather than a linear ramp.
  return t * t * (3 - 2 * t);
}

/** Derive a stable, deterministic avatar color from an id (for humans). */
export function colorFromId(id: string): string {
  const palette = [
    "#6366f1",
    "#ec4899",
    "#14b8a6",
    "#f97316",
    "#84cc16",
    "#06b6d4",
    "#a855f7",
    "#eab308",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}
