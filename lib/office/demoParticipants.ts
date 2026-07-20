// Demo seed for the Virtual Office — a handful of lifelike "ghost" teammates
// that wander the floor so the room feels alive before real co-presence is
// wired up (or when showing the office off in a demo).
//
// PURE + DOM-free: `demoParticipants(now)` is a deterministic function of the
// clock only. Same `now` → same output, with no `Math.random` / `Date.now`,
// so it is safe to call from the render loop and trivial to unit-test. Each
// ghost follows a smooth, looping path (a Lissajous-style orbit around a home
// point) and is clamped inside the office bounds.
import { clampToBounds } from "./layout";
import type { Participant, PresenceStatus } from "./presence";

interface GhostSpec {
  /** Suffix appended after the `demo:` id prefix. */
  slug: string;
  name: string;
  color: string;
  /** Orbit center in tile space. */
  home: { x: number; y: number };
  /** Orbit radii (tiles) on each axis. */
  rx: number;
  ry: number;
  /** Angular speeds (radians/sec) — different ratios keep paths from syncing. */
  sx: number;
  sy: number;
  /** Phase offset (radians) so ghosts don't all start co-located. */
  phase: number;
  /** Rotating status cycle; dwell is STATUS_DWELL_MS per entry. */
  statuses: PresenceStatus[];
  /** Optional emote and the fraction-of-loop window it shows for. */
  emote?: string;
}

// Fixed personas, clearly labelled as demo. Homes are spread across the hub
// rooms and the Commons (see lib/office/layout ROOMS) so movement reads across
// the whole floor rather than clustering in one corner.
const GHOSTS: GhostSpec[] = [
  {
    slug: "ava",
    name: "Ava (demo)",
    color: "#ec4899",
    home: { x: 7, y: 6 }, // Build Studio
    rx: 3,
    ry: 2.2,
    sx: 0.42,
    sy: 0.31,
    phase: 0,
    statuses: ["available", "focusing"],
    emote: "💡",
  },
  {
    slug: "malik",
    name: "Malik (demo)",
    color: "#f59e0b",
    home: { x: 32, y: 6 }, // Source Floor
    rx: 3.2,
    ry: 2,
    sx: 0.35,
    sy: 0.5,
    phase: 1.7,
    statuses: ["available", "in_meeting"],
    emote: "🤝",
  },
  {
    slug: "nadia",
    name: "Nadia (demo)",
    color: "#22d3ee",
    home: { x: 7, y: 18 }, // Run War Room
    rx: 2.8,
    ry: 2.4,
    sx: 0.48,
    sy: 0.27,
    phase: 3.1,
    statuses: ["focusing", "in_meeting"],
  },
  {
    slug: "theo",
    name: "Theo (demo)",
    color: "#22c55e",
    home: { x: 32, y: 18 }, // Execute Ops
    rx: 3,
    ry: 2.2,
    sx: 0.29,
    sy: 0.44,
    phase: 4.6,
    statuses: ["available", "away"],
    emote: "☕",
  },
  {
    slug: "priya",
    name: "Priya (demo)",
    color: "#a855f7",
    home: { x: 20, y: 11 }, // The Commons
    rx: 2.6,
    ry: 4,
    sx: 0.5,
    sy: 0.23,
    phase: 2.2,
    statuses: ["available", "focusing", "in_meeting"],
    emote: "👋",
  },
];

/** How long (ms) each ghost dwells on one status before rotating to the next. */
const STATUS_DWELL_MS = 6000;
/** Emote shows for this fraction at the start of every ~9s emote cycle. */
const EMOTE_PERIOD_MS = 9000;
const EMOTE_SHOWN_FRACTION = 0.25;

/**
 * Deterministic ghost teammates for the demo office at time `now` (ms). Returns
 * a stable roster (one `Participant` per persona, `kind:"human"`), each on a
 * smooth looping orbit clamped inside the floor, with a rotating status and the
 * occasional emote. Purely a function of `now` — no randomness, no DOM.
 */
export function demoParticipants(now: number): Participant[] {
  const t = now / 1000; // seconds
  return GHOSTS.map((g): Participant => {
    const { x, y } = clampToBounds(
      g.home.x + Math.cos(t * g.sx + g.phase) * g.rx,
      g.home.y + Math.sin(t * g.sy + g.phase) * g.ry,
    );

    const statusIdx =
      Math.floor(now / STATUS_DWELL_MS) % g.statuses.length;
    const status = g.statuses[statusIdx];

    let emote: string | null = null;
    if (g.emote) {
      const phaseInCycle = (now % EMOTE_PERIOD_MS) / EMOTE_PERIOD_MS;
      if (phaseInCycle < EMOTE_SHOWN_FRACTION) emote = g.emote;
    }

    return {
      id: `demo:${g.slug}`,
      name: g.name,
      kind: "human",
      x,
      y,
      color: g.color,
      status,
      emote,
    };
  });
}
