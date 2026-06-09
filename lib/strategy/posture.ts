/**
 * lib/strategy/posture.ts — the Institutional Posture composite.
 *
 * Pure, deterministic, unit-testable (like `lib/lifecycle.ts`). Turns four
 * already-derived signals into one 0–100 "how institutional is this operation"
 * score with a per-lane breakdown an LP would recognize:
 *
 *   Compliance · Governance · Execution · Capital
 *
 * No I/O here — the strategy page gathers the four lane inputs from loaders it
 * already runs (the lifecycle readiness breakdown + the live/draft objective
 * split) and calls `computePosture`. Keeping this side-effect-free means the
 * weights below can be tested in isolation and reused anywhere.
 */

/** The four posture lanes, in display order. */
export type PostureLaneKey = 'compliance' | 'governance' | 'execution' | 'capital';

export const POSTURE_LANE_ORDER: readonly PostureLaneKey[] = [
  'compliance',
  'governance',
  'execution',
  'capital'
] as const;

export const POSTURE_LANE_LABEL: Record<PostureLaneKey, string> = {
  compliance: 'Compliance',
  governance: 'Governance',
  execution: 'Execution',
  capital: 'Capital'
};

/**
 * Lane weights (sum = 100). Compliance and governance lead because the brand
 * promise is institutional posture an LP/regulator trusts; execution and
 * capital prove you ship and raise. Exported so UI/tests reference the exact
 * numbers rather than hard-coding.
 */
export const POSTURE_WEIGHTS: Record<PostureLaneKey, number> = {
  compliance: 30,
  governance: 20,
  execution: 25,
  capital: 25
};

/** Raw 0–100 inputs for each lane (the page derives these from its loaders). */
export type PostureInputs = Record<PostureLaneKey, number>;

export interface PostureLane {
  key: PostureLaneKey;
  label: string;
  /** 0–100 score for this lane. */
  score: number;
  /** This lane's weight in the composite. */
  weight: number;
}

export interface PostureResult {
  /** Overall institutional-posture score, 0–100. */
  score: number;
  /** Per-lane breakdown, in display order. */
  lanes: PostureLane[];
}

const clamp100 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

/**
 * Compute the 0–100 institutional-posture composite with a per-lane breakdown.
 * Each lane input is clamped to 0–100, then combined by `POSTURE_WEIGHTS`.
 */
export function computePosture(inputs: PostureInputs): PostureResult {
  const lanes: PostureLane[] = POSTURE_LANE_ORDER.map((key) => ({
    key,
    label: POSTURE_LANE_LABEL[key],
    score: clamp100(inputs[key]),
    weight: POSTURE_WEIGHTS[key]
  }));

  const score = Math.round(lanes.reduce((sum, lane) => sum + (lane.score * lane.weight) / 100, 0));
  return { score, lanes };
}

/**
 * Compliance lane from the live/draft compliance objective split. A standing
 * compliance tier is seeded as drafts; posture rises as the operator approves
 * them into the plan and completes them.
 *
 * - `done` live compliance objectives count fully,
 * - `open` live (approved) ones count half (acknowledged, not yet closed),
 * - `pendingDrafts` (unapproved) count as outstanding.
 *
 * With no compliance items at all, returns 100 (nothing outstanding).
 */
export function complianceLaneScore(input: {
  doneLive: number;
  openLive: number;
  pendingDrafts: number;
}): number {
  const total = input.doneLive + input.openLive + input.pendingDrafts;
  if (total === 0) return 100;
  return clamp100(((input.doneLive + input.openLive * 0.5) / total) * 100);
}
