/**
 * lib/lifecycle.ts — the Wave-1 lifecycle engine.
 *
 * Pure, deterministic, unit-testable logic that maps an emerging manager's
 * real Supabase signals onto the capital-formation lifecycle described in
 * `docs/PRIVATE_MARKET_LIFECYCLE.md`. No I/O lives here: loaders gather the
 * inputs (see `lib/queries/dashboard`), then call these functions. Keeping
 * this layer side-effect-free means the Dashboard, Fund Profile, and any
 * future Earn narration can all derive the same stage + readiness from the
 * same numbers, and the thresholds below can be tested in isolation.
 *
 * The seven stages are a compounding loop, not a linear funnel — but at any
 * moment a manager has a single "current" stage: the earliest gate that is
 * not yet cleared. That is what `computeLifecycleStage` returns.
 */

/* ============================================================================
 * Stages
 * ========================================================================= */

/**
 * The seven lifecycle stages, in order. Maps 1:1 to the table in section 1 of
 * the spec. The string union is the stable contract Emergent's UI binds to.
 */
export type LifecycleStage =
  | 'establish_truth' // 1. Prove who you are: thesis, track record, team, terms.
  | 'get_raise_ready' // 2. Materials, governance, formation readiness.
  | 'source_lps' // 3. Build & qualify a targeted LP universe.
  | 'convert_lps' // 4. Move interest → soft-circle → commitment → close.
  | 'source_deals' // 5. Find, diligence, decide, deploy.
  | 'operate' // 6. Turn signal into action; reuse knowledge.
  | 'prove'; // 7. Make every action auditable & reusable.

/** Ordered list of stages — index doubles as the stage's ordinal (0-based). */
export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  'establish_truth',
  'get_raise_ready',
  'source_lps',
  'convert_lps',
  'source_deals',
  'operate',
  'prove'
] as const;

/** Human-readable label for each stage (UI eyebrow / heading copy). */
export const LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string> = {
  establish_truth: 'Establish truth',
  get_raise_ready: 'Get raise-ready',
  source_lps: 'Source LPs',
  convert_lps: 'Convert LPs',
  source_deals: 'Source & execute deals',
  operate: 'Operate & leverage',
  prove: 'Prove & compound'
};

/** One-line description of the manager's real job at each stage. */
export const LIFECYCLE_STAGE_BLURBS: Record<LifecycleStage, string> = {
  establish_truth: 'Prove who you are: thesis, track record, team, terms.',
  get_raise_ready: 'Assemble materials, governance, and formation readiness.',
  source_lps: 'Build and qualify a targeted LP universe.',
  convert_lps: 'Move interest → soft-circle → commitment → close.',
  source_deals: 'Find, diligence, decide, and deploy capital.',
  operate: 'Turn signal into action; reuse knowledge.',
  prove: 'Make every action auditable and reusable.'
};

/** Ordinal index of a stage (0 = establish_truth … 6 = prove). */
export function lifecycleStageIndex(stage: LifecycleStage): number {
  return LIFECYCLE_STAGES.indexOf(stage);
}

/* ============================================================================
 * Inputs
 * ========================================================================= */

/**
 * The raw, pre-aggregated signals the engine reasons over. Every field is a
 * plain number/boolean so the engine stays pure and trivially testable — the
 * loader is responsible for deriving these from Supabase rows.
 */
export interface LifecycleInputs {
  /**
   * Fund-profile completeness, 0–100. From `getFundProfile().completenessScore`
   * (thesis, strategy, target raise, terms, track record, team). This is the
   * "establish truth" signal.
   */
  profileCompleteness: number;

  /**
   * Chain-of-Trust layer completion, 0–100 each, mapped from `proof_layers`.
   * `truth` gates stage 1; `concept` gates stage 2; `execution`/`work` reflect
   * deployment maturity used by later stages.
   */
  trust: {
    truth: number;
    concept: number;
    execution: number;
    work: number;
  };

  /** Whether the org has at least one chain_of_trust record at all. */
  hasTrustRecord: boolean;

  /**
   * Raise-readiness materials progress, 0–100. Until a dedicated materials
   * model lands this is approximated from governance/objective completion;
   * the loader documents its source. Gates stage 2.
   */
  materialsReadiness: number;

  /** Pipeline counts used to detect LP-sourcing and conversion activity. */
  pipeline: {
    /** Total LP/deal pipeline entries (deals rows for the org). */
    total: number;
    /** Entries past the earliest "target/visitor" stage (real outreach). */
    contacted: number;
    /** Entries in a soft-circle stage. */
    softCircled: number;
    /** Entries committed or closed. */
    committed: number;
    /** Entries actively in diligence (deal-side execution signal). */
    inDiligence: number;
  };

  /** Raise progress, derived from allocations (or capital_stack later). */
  raise: {
    /** Target raise amount, 0 when unknown. */
    target: number;
    /** Soft-circled capital (status soft-circle / interested). */
    softCircled: number;
    /** Committed/closed capital (status accepted / funded / closed). */
    committed: number;
  };

  /** Whether any capital has actually been deployed into deals (operate). */
  hasDeployedCapital: boolean;

  /** Count of completed diligence runs / IC memos (proving execution). */
  completedDiligenceRuns: number;
}

/* ============================================================================
 * Stage computation
 * ========================================================================= */

/**
 * Documented gate thresholds. A stage is "cleared" once its gate predicate is
 * true; the current stage is the first gate that is NOT cleared. Exported so
 * the UI and tests can reference the exact numbers rather than hard-coding.
 */
export const LIFECYCLE_THRESHOLDS = {
  /** Stage 1 → 2: profile is substantially complete AND Proof of Truth is solid. */
  establishTruth: { profileCompleteness: 70, trustTruth: 60 },
  /** Stage 2 → 3: raise materials assembled AND Proof of Concept underway. */
  getRaiseReady: { materialsReadiness: 60, trustConcept: 40 },
  /** Stage 3 → 4: a real LP universe exists (enough contacted entries). */
  sourceLps: { contacted: 3 },
  /** Stage 4 → 5: conversion is happening (soft-circled or committed capital). */
  convertLps: { softCircledOrCommittedEntries: 1 },
  /** Stage 5 → 6: deals are being executed (diligence or deployed capital). */
  sourceDeals: { inDiligenceOrDeployed: 1 },
  /** Stage 6 → 7: enough completed work exists to be worth proving/auditing. */
  operate: { completedDiligenceRuns: 1 }
} as const;

/**
 * Per-stage gate predicates — `true` means the stage is cleared and the
 * manager has progressed past it.
 */
function gatesCleared(inputs: LifecycleInputs): Record<LifecycleStage, boolean> {
  const t = LIFECYCLE_THRESHOLDS;
  const conversionEntries = inputs.pipeline.softCircled + inputs.pipeline.committed;
  const executionSignals = inputs.pipeline.inDiligence + (inputs.hasDeployedCapital ? 1 : 0);

  return {
    establish_truth:
      inputs.profileCompleteness >= t.establishTruth.profileCompleteness &&
      inputs.trust.truth >= t.establishTruth.trustTruth,
    get_raise_ready:
      inputs.materialsReadiness >= t.getRaiseReady.materialsReadiness &&
      inputs.trust.concept >= t.getRaiseReady.trustConcept,
    source_lps: inputs.pipeline.contacted >= t.sourceLps.contacted,
    convert_lps: conversionEntries >= t.convertLps.softCircledOrCommittedEntries,
    source_deals: executionSignals >= t.sourceDeals.inDiligenceOrDeployed,
    operate: inputs.completedDiligenceRuns >= t.operate.completedDiligenceRuns,
    // The final stage has no "next" gate — it is never "cleared past".
    prove: false
  };
}

/**
 * Derive the manager's current lifecycle stage. Deterministic: walks the
 * ordered gates and returns the first stage whose gate is not yet cleared.
 * If every prior gate is cleared, the manager is in `prove` (the compounding
 * end-state of the loop).
 */
export function computeLifecycleStage(inputs: LifecycleInputs): LifecycleStage {
  const cleared = gatesCleared(inputs);
  for (const stage of LIFECYCLE_STAGES) {
    if (!cleared[stage]) return stage;
  }
  return 'prove';
}

/**
 * Richer stage result: the current stage plus which gates are cleared and a
 * coarse "progress through the loop" percentage (cleared gates / total gates).
 * Useful for a progress rail without re-deriving the gates in the UI.
 */
export interface LifecycleStageResult {
  stage: LifecycleStage;
  stageIndex: number;
  label: string;
  blurb: string;
  /** Map of stage → whether its forward gate is cleared. */
  gatesCleared: Record<LifecycleStage, boolean>;
  /** 0–100: share of the six forward gates cleared. */
  loopProgress: number;
}

export function computeLifecycleStageResult(inputs: LifecycleInputs): LifecycleStageResult {
  const cleared = gatesCleared(inputs);
  const stage = computeLifecycleStage(inputs);
  // Six forward gates (prove has no forward gate).
  const forwardGates = LIFECYCLE_STAGES.slice(0, -1) as LifecycleStage[];
  const clearedCount = forwardGates.filter((s) => cleared[s]).length;
  const loopProgress = Math.round((clearedCount / forwardGates.length) * 100);

  return {
    stage,
    stageIndex: lifecycleStageIndex(stage),
    label: LIFECYCLE_STAGE_LABELS[stage],
    blurb: LIFECYCLE_STAGE_BLURBS[stage],
    gatesCleared: cleared,
    loopProgress
  };
}

/* ============================================================================
 * Readiness score
 * ========================================================================= */

/** The five readiness dimensions and their relative weights (sum = 100). */
export const READINESS_WEIGHTS = {
  /** Fund Profile completeness — the Source of Truth. */
  profile: 25,
  /** Chain-of-Trust proof depth — credibility an LP can verify. */
  proof: 20,
  /** Raise materials & governance readiness. */
  materials: 15,
  /** Pipeline depth & momentum. */
  pipeline: 20,
  /** Capital progress against target. */
  capital: 20
} as const;

export type ReadinessDimension = keyof typeof READINESS_WEIGHTS;

/** A single dimension's contribution to the overall readiness score. */
export interface ReadinessDimensionScore {
  dimension: ReadinessDimension;
  /** 0–100 raw score for this dimension. */
  score: number;
  /** This dimension's weight in the overall score. */
  weight: number;
  /** Weighted points contributed to the 0–100 total (score × weight / 100). */
  contribution: number;
}

export interface ReadinessResult {
  /** Overall institutional-readiness score, 0–100. */
  score: number;
  /** Per-dimension breakdown, in display order. */
  breakdown: ReadinessDimensionScore[];
}

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * Compute a 0–100 institutional-readiness score with a per-dimension
 * breakdown. Pure function over the same inputs the stage engine uses, so the
 * Dashboard can show one number ("how investable am I right now?") that an LP
 * would broadly agree with. Each dimension is normalized to 0–100, then
 * combined by `READINESS_WEIGHTS`.
 */
export function computeReadinessScore(inputs: LifecycleInputs): ReadinessResult {
  // 1. Profile — directly the Source-of-Truth completeness.
  const profile = clamp100(inputs.profileCompleteness);

  // 2. Proof — weighted blend of the four proof layers (earlier layers matter
  //    more for raise-readiness; execution/work add credibility).
  const proof = clamp100(
    inputs.trust.truth * 0.4 +
      inputs.trust.concept * 0.3 +
      inputs.trust.execution * 0.2 +
      inputs.trust.work * 0.1
  );

  // 3. Materials — readiness of decks/memos/governance.
  const materials = clamp100(inputs.materialsReadiness);

  // 4. Pipeline — depth (contacted entries, saturating at 8) blended with
  //    momentum (share of entries that advanced past first contact).
  const depth = clamp100((Math.min(inputs.pipeline.contacted, 8) / 8) * 100);
  const momentum =
    inputs.pipeline.total > 0
      ? clamp100((inputs.pipeline.contacted / inputs.pipeline.total) * 100)
      : 0;
  const pipeline = clamp100(depth * 0.6 + momentum * 0.4);

  // 5. Capital — progress toward target. Committed counts full; soft-circled
  //    counts half. When no target is set, fall back to whether any capital is
  //    in motion (so a manager who hasn't sized the raise isn't zeroed out).
  let capital: number;
  if (inputs.raise.target > 0) {
    const effective = inputs.raise.committed + inputs.raise.softCircled * 0.5;
    capital = clamp100((effective / inputs.raise.target) * 100);
  } else {
    capital = inputs.raise.committed > 0 ? 50 : inputs.raise.softCircled > 0 ? 25 : 0;
  }

  const dims: Record<ReadinessDimension, number> = {
    profile,
    proof,
    materials,
    pipeline,
    capital
  };

  const order: ReadinessDimension[] = ['profile', 'proof', 'materials', 'pipeline', 'capital'];
  const breakdown: ReadinessDimensionScore[] = order.map((dimension) => {
    const score = Math.round(dims[dimension]);
    const weight = READINESS_WEIGHTS[dimension];
    const contribution = (score * weight) / 100;
    return { dimension, score, weight, contribution };
  });

  const score = Math.round(breakdown.reduce((sum, d) => sum + d.contribution, 0));
  return { score, breakdown };
}
