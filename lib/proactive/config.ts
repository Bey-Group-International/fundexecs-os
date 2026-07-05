// lib/proactive/config.ts
// Config for the proactive layer. EVERYTHING that decides how much initiative
// Earn takes lives here, not hardcoded per case: the trust budget, the per-hub
// cutoffs, the blast-radius weights, and the learning decay bounds. Tuning
// Earn's restraint is a config edit, not a code change.
//
// The trust budget is the make-or-break stage. With ~15 agents all producing,
// restraint is the feature — a hard ceiling on how many proactive items reach
// the operator per period, enforced in code (see prioritize.ts). The cutoff is
// PER-HUB, not global: Build is bounded and front-loaded (rare, decision-
// critical nudges → run loose); Run is unbounded and continuous (constant
// marks, sector signals, LP timers → run tight, or it floods the operator and
// burns the trust the whole layer depends on).

import type { Hub } from "@/lib/supabase/database.types";
import type { GateTier } from "@/lib/gates";

export interface HubBudget {
  /** Hard ceiling on items surfaced for this hub per sweep period. */
  maxPerPeriod: number;
  /** Minimum composite priority (0–100) to surface. Below → suppressed. */
  cutoff: number;
}

export interface TrustBudgetConfig {
  /** Global ceiling across all hubs per period — the outer restraint. */
  globalMaxPerPeriod: number;
  /** Per-hub ceiling + cutoff. */
  perHub: Record<Hub, HubBudget>;
  /**
   * Blast-radius multipliers into the priority score. A higher-stakes move
   * needs a higher confidence×urgency to clear the same bar, so Tier 3 is
   * weighted DOWN — Earn must be more sure before it proposes something binding.
   */
  blastRadiusWeight: Record<GateTier, number>;
}

/**
 * Default trust budget. Build runs loose (few, decision-critical); Run runs
 * tight (continuous, floods easily). Source/Execute sit between.
 */
export const TRUST_BUDGET: TrustBudgetConfig = {
  globalMaxPerPeriod: 5,
  perHub: {
    build: { maxPerPeriod: 3, cutoff: 35 },
    source: { maxPerPeriod: 3, cutoff: 45 },
    run: { maxPerPeriod: 2, cutoff: 60 },
    execute: { maxPerPeriod: 2, cutoff: 65 },
  },
  // Tier 1 (draft/internal) rarely surfaces alone; Tier 2 neutral; Tier 3
  // discounted so only high-conviction binding items clear the bar.
  blastRadiusWeight: { 1: 1.0, 2: 1.0, 3: 0.8 },
};

/**
 * Per-signal-type learning bounds. A proposed-Command type that keeps getting
 * dismissed decays out of the budget; one that keeps getting approved recovers.
 * The multiplier is clamped so learning nudges, never zeroes, a signal type.
 */
export const LEARNING = {
  /** Min feedback events before learning adjusts anything (confidence floor). */
  minFeedback: 3,
  /** Multiplier floor — a hated signal type decays to at most this. */
  minWeight: 0.4,
  /** Multiplier ceiling — a loved signal type recovers to at most this. */
  maxWeight: 1.25,
  /** A snooze counts as a fractional dismissal. */
  snoozeWeight: 0.5,
};

/**
 * Per-source staleness TTLs (seconds). Intelligence older than its TTL is
 * marked stale and MUST NOT silently enter a live investor draft — the draft
 * either refreshes or drops the stale claim. Mirrors lib/source-cache TTLs.
 */
export const PMI_TTL_SECONDS: Record<string, number> = {
  carta: 43_200, // 12h — fund marks / benchmarks move slowly
  apollo: 86_400, // 24h
  default: 21_600, // 6h
};

/**
 * Ship-order flag. Surface-on-open ships first: proactive Commands appear on
 * the Report dashboard when the operator looks. Background push interruption is
 * a later graduation for high-confidence Execute signals only — a config flag,
 * not a rewrite. When false, the cron sweep computes + persists items but does
 * not push any notification.
 */
export const PROACTIVE_BACKGROUND_PUSH = false;

/** Master switch for the whole layer (off by default until enabled per env). */
export const PROACTIVE_ENABLED =
  process.env.PROACTIVE_INITIATIVE_ENABLED === "true";
