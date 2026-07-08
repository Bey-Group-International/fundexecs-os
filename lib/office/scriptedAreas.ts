/**
 * FundExecs OS — declarative scripted areas.
 *
 * A WorkAdventure-style area system: rectangular zones on the floor that
 * auto-fire a trigger the moment the operator walks into them — no key press,
 * unlike the press-X hotspots. This module owns the pure, framework-free data
 * model and geometry; the Phaser scene detects enter transitions and emits a
 * game event, and the React layer maps each trigger to a concrete action.
 *
 * It is intentionally data-driven so a future office/map editor can define
 * areas without touching the engine. Dependency-free (no React, no renderer),
 * so it is safe to import anywhere and easy to unit test.
 */

/** What a scripted area does when the operator enters it. */
export type AreaTrigger =
  /** Show a "Say" text bubble over the operator (reuses office:say). */
  | { kind: "say"; text: string }
  /** Announce a moment in the floor activity feed. */
  | { kind: "toast"; text: string }
  /** Convene an in-office meeting (reuses office:start-meeting). */
  | { kind: "start-meeting" }
  /**
   * Broadcast an all-hands announcement to the whole floor: posts to the live
   * floor activity feed everyone sees and pops a Say bubble over the operator.
   */
  | { kind: "broadcast"; text: string };

export type ScriptedArea = {
  /** Stable id — also the de-dupe key for `once`. */
  id: string;
  /** Human label for the floor marker. */
  label: string;
  /** World-space rectangle. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fired on entering the area. */
  trigger: AreaTrigger;
  /** When true, fire at most once per session. Default: re-fire on re-entry. */
  once?: boolean;
  /** Marker accent (`#rrggbb`). Defaults to the house gold. */
  accent?: string;
};

/** True when the point falls inside the area's rectangle. */
export function pointInArea(a: ScriptedArea, x: number, y: number): boolean {
  return x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h;
}

/**
 * The first area (in declaration order) whose rectangle contains the point, or
 * null. Declaration order is the priority when areas overlap.
 */
export function areaAt(areas: ScriptedArea[], x: number, y: number): ScriptedArea | null {
  for (const a of areas) {
    if (pointInArea(a, x, y)) return a;
  }
  return null;
}

// The office world is a 3×3 grid of 384×288 rooms; the operator spawns at the
// center of the top-left Command Center (192, 144). The welcome area covers
// that room so a one-time greeting fires on arrival. More areas are meant to be
// added declaratively (e.g. by the map editor) — the engine needs no changes.
export const SCRIPTED_AREAS: ScriptedArea[] = [
  {
    id: "welcome",
    label: "Command Center",
    x: 20,
    y: 20,
    w: 344,
    h: 248,
    once: true,
    accent: "#c9a84c",
    trigger: {
      kind: "say",
      text: "Welcome to the Executive Floor — walk up to an executive to delegate a task.",
    },
  },
  // All-Hands: the center-room auditorium. Stepping in broadcasts an all-hands
  // announcement floor-wide (activity feed + Say bubble). Re-fires on re-entry
  // so it can be convened again. The center room spans x[384,768] y[288,576];
  // this rectangle is that room inset by a 20px margin.
  {
    id: "all-hands",
    label: "All-Hands Auditorium",
    x: 404,
    y: 308,
    w: 344,
    h: 248,
    accent: "#38bdf8",
    trigger: {
      kind: "broadcast",
      text: "All-hands convened on the Executive Floor — everyone gather in the auditorium.",
    },
  },
];
