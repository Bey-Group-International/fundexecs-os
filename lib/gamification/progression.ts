/**
 * UI-side XP / level progression curve.
 *
 * The live `ExecutionScore` contract carries `xp` (accumulated, verified-action
 * XP) and `level` (server-derived). Phase 2 will own the authoritative level
 * thresholds; until then the dashboard derives a *display* "XP to next level"
 * purely on the client so the progression bar/ring has something honest to show.
 *
 * Curve (documented so Phase 2 can match or replace it):
 *   threshold(L) = BASE * L + GROWTH * L * (L - 1) / 2
 * i.e. a gently accelerating cost per level (level 1→2 costs BASE, each
 * subsequent level costs BASE + GROWTH more than the last). This is a pure
 * function of the level integer — no randomness, SSR-stable.
 *
 *   BASE = 250, GROWTH = 150
 *   L1→L2:   250 XP total to reach L2
 *   L2→L3:   650 XP total to reach L3   (+400 step)
 *   L3→L4:  1200 XP total to reach L4   (+550 step)
 */

const BASE = 250;
const GROWTH = 150;

/** Total accumulated XP required to *reach* the given level (level 1 = 0). */
export function xpForLevel(level: number): number {
  const L = Math.max(1, Math.floor(level));
  if (L <= 1) return 0;
  // Sum of step costs from level 1 up to L.
  const n = L - 1;
  return BASE * n + (GROWTH * n * (n - 1)) / 2;
}

export interface LevelProgress {
  /** Current level (echoed from input). */
  level: number;
  /** XP accumulated within the current level. */
  intoLevel: number;
  /** XP span between the current and next level. */
  levelSpan: number;
  /** XP remaining to the next level. */
  toNext: number;
  /** 0–100 progress through the current level. */
  pct: number;
}

/**
 * Derive within-level progress from accumulated XP + the server's level.
 * Defensive against XP that's behind/ahead of the nominal level threshold
 * (the server is the source of truth for `level`; we only render the bar).
 */
export function levelProgress(xp: number, level: number): LevelProgress {
  const L = Math.max(1, Math.floor(level));
  const floor = xpForLevel(L);
  const ceil = xpForLevel(L + 1);
  const span = Math.max(1, ceil - floor);
  const into = Math.max(0, Math.min(span, xp - floor));
  const pct = Math.round((into / span) * 100);
  return {
    level: L,
    intoLevel: into,
    levelSpan: span,
    toNext: Math.max(0, span - into),
    pct
  };
}
