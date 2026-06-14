/* ============================================================================
 * lib/intelligence/velocity.ts — Pipeline Velocity & Stuck-Deal Detector.
 *
 * A proprietary, key-free signal: how long each live deal has sat in its current
 * formation stage, and which have stalled. Time-in-stage is read from the deal's
 * own loop-event history (the `deal_stage` transitions already loaded on every
 * pipeline deal) — when the deal last *moved*, not merely when its row was last
 * touched. Nothing fades silently: a deal parked in a stage surfaces here.
 *
 * Pure + total — no DB, no model, trivially unit-testable.
 * ========================================================================= */

/** A loop event in the deal's timeline — a structural subset of PipelineDealEvent. */
export interface VelocityEvent {
  /** 'deal_created' | 'deal_stage' (or any other recorded type). */
  type: string;
  createdAt: string;
}

/** Minimal deal shape — a structural subset of PipelineDeal. */
export interface VelocityInput {
  id: string;
  name: string;
  stage: string;
  status: string;
  /** Loop-event history, NEWEST FIRST (as PipelineDeal provides it). */
  events: VelocityEvent[];
  /** Fallback timestamp when no events exist. */
  updatedAt: string;
}

export type VelocityBand = 'Moving' | 'Slowing' | 'Stuck';

export interface VelocityResult {
  dealId: string;
  dealName: string;
  stage: string;
  /** Days the deal has sat in its current stage. */
  daysInStage: number;
  band: VelocityBand;
  /** ISO timestamp the deal entered its current stage. */
  enteredStageAt: string;
  reason: string;
}

/** Days in stage at/above which a deal is "slowing" … */
const SLOWING_DAYS = 21;
/** … and at/above which it is "stuck". */
const STUCK_DAYS = 45;

function isClosed(input: VelocityInput): boolean {
  return input.status.toLowerCase() === 'closed' || input.stage.toLowerCase() === 'closed';
}

function bandFor(days: number): VelocityBand {
  if (days >= STUCK_DAYS) return 'Stuck';
  if (days >= SLOWING_DAYS) return 'Slowing';
  return 'Moving';
}

/**
 * When did the deal enter its CURRENT stage? The most recent `deal_stage`
 * transition; else the `deal_created` event; else the row's last update.
 * `events` is newest-first, so the first match wins.
 */
function enteredStageAt(input: VelocityInput): string {
  const move = input.events.find((e) => e.type === 'deal_stage' && !!e.createdAt);
  if (move) return move.createdAt;
  const created = input.events.find((e) => e.type === 'deal_created' && !!e.createdAt);
  if (created) return created.createdAt;
  // Oldest event of any kind, else the row's updatedAt.
  const oldest = [...input.events].reverse().find((e) => !!e.createdAt);
  return oldest?.createdAt ?? input.updatedAt;
}

/** Compute time-in-stage + stall band for one deal. `now` is injectable for tests. */
export function computeVelocity(input: VelocityInput, now: number = Date.now()): VelocityResult {
  const enteredAt = enteredStageAt(input);
  const t = Date.parse(enteredAt);
  const daysInStage = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0;
  const band = bandFor(daysInStage);

  const reason =
    band === 'Moving'
      ? `In ${input.stage} for ${daysInStage} day${daysInStage === 1 ? '' : 's'}`
      : `Parked in ${input.stage} for ${daysInStage} days`;

  return {
    dealId: input.id,
    dealName: input.name,
    stage: input.stage,
    daysInStage,
    band,
    enteredStageAt: enteredAt,
    reason
  };
}

/**
 * Rank live deals that have stalled (Slowing + Stuck), longest-in-stage first.
 * Closed deals are excluded — velocity is about deals still in motion.
 */
export function rankVelocity(inputs: VelocityInput[], now: number = Date.now()): VelocityResult[] {
  return inputs
    .filter((d) => !isClosed(d))
    .map((d) => computeVelocity(d, now))
    .filter((r) => r.band !== 'Moving')
    .sort((a, b) => b.daysInStage - a.daysInStage);
}
