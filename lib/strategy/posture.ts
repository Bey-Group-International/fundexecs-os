/* ============================================================================
 * lib/strategy/posture.ts — Institutional Posture composite (pure, no schema).
 *
 * Phase 3 (migration-free core) of memory/STRATEGY_COMPOUNDING_BLUEPRINT.md:
 * the "operate like a seasoned investment-firm executive" scorecard. Composes
 * four pillars — Compliance · Governance · Execution · Capital — from inputs the
 * /strategy page already loads (Chain-of-Trust layers, the lifecycle engine's
 * capital readiness dimension, and the 100/30/10 objectives). No peer percentile
 * and no momentum Δ here: those need the `org_posture_snapshots` table (a later
 * migration), and the blueprint's guardrail is to never fabricate a rank or a
 * delta. Pure and deterministic, like lib/lifecycle.ts — unit-tested.
 * ========================================================================= */

export type PostureDimensionKey = 'compliance' | 'governance' | 'execution' | 'capital';

/** One objective, reduced to what the governance pillar needs. */
export interface PostureObjectiveInput {
  priority: 'High' | 'Medium' | 'Low';
  done: boolean;
}

export interface PostureInput {
  /** Chain-of-Trust layer completion, 0–100 each (truth/concept/execution/work). */
  trust: { truth: number; concept: number; execution: number; work: number };
  /**
   * The lifecycle engine's capital readiness dimension, 0–100, or null when the
   * dimension is absent. Null is treated as unmeasured (excluded from the
   * composite) rather than coerced to a fabricated 0.
   */
  capitalReadiness: number | null;
  /** The 100/30/10 objectives — drives the governance pillar. */
  objectives: PostureObjectiveInput[];
}

/** A band turns the composite into a one-word institutional standing. */
export type PostureBand = 'institutional' | 'emerging' | 'building' | 'unmeasured';

export interface PostureDimension {
  key: PostureDimensionKey;
  label: string;
  /** 0–100, or null when the pillar isn't measurable yet (excluded from composite). */
  score: number | null;
  /** Relative weight in the composite (renormalized over measurable pillars). */
  weight: number;
  /** Action-oriented, one-line cue for raising this pillar. */
  cue: string;
}

export interface PostureResult {
  /** Weighted composite over measurable pillars (0–100), or null when none are. */
  composite: number | null;
  band: PostureBand;
  dimensions: PostureDimension[];
}

/** Priority → capital proxy weight (matches the Phase-1 governance rollup). */
const PRIORITY_WEIGHT: Record<PostureObjectiveInput['priority'], number> = {
  High: 3,
  Medium: 2,
  Low: 1
};

const DIMENSION_LABEL: Record<PostureDimensionKey, string> = {
  compliance: 'Compliance',
  governance: 'Governance',
  execution: 'Execution',
  capital: 'Capital'
};

const DIMENSION_CUE: Record<PostureDimensionKey, string> = {
  compliance: 'Lock your source of truth and document the thesis — audit-ready beats audited.',
  governance: 'Close high-priority 100/30/10 objectives to prove operating discipline.',
  execution: 'Ship the work and log it — execution proof is what compounds.',
  capital: 'Advance commitments against target to lift the capital pillar.'
};

/** Equal base weights; the composite renormalizes over the pillars in play. */
const BASE_WEIGHT = 0.25;

const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Capital-weighted completion of the 100/30/10 plan: each done objective
 * contributes its priority weight, over the total priority weight. Returns null
 * when there are no objectives (governance not yet authored — not a zero).
 */
function governanceScore(objectives: PostureObjectiveInput[]): number | null {
  if (objectives.length === 0) return null;
  let earned = 0;
  let total = 0;
  for (const o of objectives) {
    const w = PRIORITY_WEIGHT[o.priority];
    total += w;
    if (o.done) earned += w;
  }
  if (total === 0) return null;
  return clamp100((earned / total) * 100);
}

/** Composite band thresholds — aligned with the readiness hero's bands. */
function bandFor(composite: number | null): PostureBand {
  if (composite === null) return 'unmeasured';
  if (composite >= 75) return 'institutional';
  if (composite >= 50) return 'emerging';
  return 'building';
}

/**
 * Compute the four-pillar Institutional Posture from already-loaded inputs.
 *
 * - Compliance — audit-readiness & a documented thesis (Chain-of-Trust
 *   truth + concept). The verifiable-record proxy until the standing compliance
 *   tier (blueprint Phase 4) lands.
 * - Governance — capital-weighted completion of the 100/30/10 operating plan.
 * - Execution — that you ship and log it (Chain-of-Trust execution + work).
 * - Capital — the lifecycle engine's capital readiness dimension.
 *
 * The composite is a weight-renormalized mean over the measurable pillars, so a
 * not-yet-authored plan shows "—" rather than dragging the number to zero.
 */
export function computeInstitutionalPosture(input: PostureInput): PostureResult {
  const { trust, capitalReadiness, objectives } = input;

  const compliance = clamp100(0.6 * trust.truth + 0.4 * trust.concept);
  const execution = clamp100(0.55 * trust.execution + 0.45 * trust.work);
  const capital = capitalReadiness === null ? null : clamp100(capitalReadiness);
  const governance = governanceScore(objectives);

  const scores: Record<PostureDimensionKey, number | null> = {
    compliance,
    governance,
    execution,
    capital
  };

  const dimensions: PostureDimension[] = (
    ['compliance', 'governance', 'execution', 'capital'] as const
  ).map((key) => ({
    key,
    label: DIMENSION_LABEL[key],
    score: scores[key],
    weight: BASE_WEIGHT,
    cue: DIMENSION_CUE[key]
  }));

  // Composite = weighted mean over measurable pillars, weights renormalized so
  // the absent ones don't silently count as zero.
  const measurable = dimensions.filter(
    (d): d is PostureDimension & { score: number } => d.score !== null
  );
  const weightSum = measurable.reduce((s, d) => s + d.weight, 0);
  const composite =
    measurable.length > 0 && weightSum > 0
      ? clamp100(measurable.reduce((s, d) => s + d.score * d.weight, 0) / weightSum)
      : null;

  return { composite, band: bandFor(composite), dimensions };
}
