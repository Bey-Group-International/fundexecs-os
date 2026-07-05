// lib/proactive/prioritize.ts
// The Prioritize stage — the make-or-break, and it matters MORE with ~15 agents
// all producing. Candidates compete on urgency × blast_radius × confidence
// (× a learned weight). A hard, configurable TRUST BUDGET caps how many items
// reach the operator per period; everything below the per-hub cutoff is
// SUPPRESSED, not queued. Restraint is the feature — enforced here, in code.
//
// PMI feeds this stage: a candidate's urgency/confidence already reflect
// intelligence (a cold-LP signal jumps when Carta shows top-quartile DPI to
// re-approach with, or the LP is allocating to comparables now). This module is
// pure — it takes finished candidates + a budget + learned weights and returns
// the surface/suppress verdict, so the cutoff and budget are unit-testable.

import type { Hub } from "@/lib/supabase/database.types";
import type { GateTier } from "@/lib/gates";
import { TRUST_BUDGET, type TrustBudgetConfig } from "./config";
import type { ProactiveCandidate, RankedCandidate } from "./types";

export interface ScoredInput {
  candidate: ProactiveCandidate;
  /** 0–100, post-PMI. */
  urgency: number;
  /** 0–100, post-PMI. */
  confidence: number;
  blastRadius: GateTier;
  /** From learn.ts; 1.0 when no history. */
  learnedWeight: number;
}

/**
 * Composite priority: urgency × confidence × blast-radius weight × learned
 * weight, normalized to 0–100. Multiplicative so a candidate must be BOTH
 * urgent AND well-grounded to rank — a certain-but-trivial or urgent-but-
 * unfounded item scores low.
 */
export function compositePriority(
  input: ScoredInput,
  budget: TrustBudgetConfig = TRUST_BUDGET,
): number {
  const u = clamp01(input.urgency / 100);
  const c = clamp01(input.confidence / 100);
  const brw = budget.blastRadiusWeight[input.blastRadius] ?? 1.0;
  const lw = input.learnedWeight;
  return Math.round(u * c * brw * lw * 100);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export interface PrioritizeResult {
  ranked: RankedCandidate[];
  surfaced: RankedCandidate[];
  suppressed: RankedCandidate[];
}

/**
 * Enforce the trust budget. Steps:
 *  1. Score every candidate.
 *  2. Drop anything below its hub's cutoff (suppressed, not queued).
 *  3. Within each hub, keep at most that hub's ceiling (highest priority first).
 *  4. Across hubs, keep at most the global ceiling.
 * Everything not surfaced is returned as suppressed with a reason — nothing is
 * silently dropped, so coverage is observable.
 */
export function prioritize(
  inputs: ScoredInput[],
  budget: TrustBudgetConfig = TRUST_BUDGET,
): PrioritizeResult {
  // Score + tag with surface eligibility.
  const scored: RankedCandidate[] = inputs.map((input) => {
    const priority = compositePriority(input, budget);
    return {
      candidate: input.candidate,
      urgency: input.urgency,
      confidence: input.confidence,
      blastRadius: input.blastRadius,
      learnedWeight: input.learnedWeight,
      priority,
      surfaced: false,
      reason: "",
    };
  });

  // Highest priority first (stable: preserve input order on ties).
  scored.sort((a, b) => b.priority - a.priority);

  const perHubCount: Partial<Record<Hub, number>> = {};
  let globalCount = 0;

  for (const item of scored) {
    const hub = item.candidate.signal.hub;
    const hubBudget = budget.perHub[hub];

    if (item.priority < hubBudget.cutoff) {
      item.reason = `Below ${hub} cutoff (${item.priority} < ${hubBudget.cutoff}) — suppressed.`;
      continue;
    }
    if ((perHubCount[hub] ?? 0) >= hubBudget.maxPerPeriod) {
      item.reason = `${hub} budget full (${hubBudget.maxPerPeriod}/period) — suppressed.`;
      continue;
    }
    if (globalCount >= budget.globalMaxPerPeriod) {
      item.reason = `Global budget full (${budget.globalMaxPerPeriod}/period) — suppressed.`;
      continue;
    }

    item.surfaced = true;
    item.reason = `Surfaced (priority ${item.priority} ≥ ${hub} cutoff ${hubBudget.cutoff}).`;
    perHubCount[hub] = (perHubCount[hub] ?? 0) + 1;
    globalCount += 1;
  }

  return {
    ranked: scored,
    surfaced: scored.filter((s) => s.surfaced),
    suppressed: scored.filter((s) => !s.surfaced),
  };
}
