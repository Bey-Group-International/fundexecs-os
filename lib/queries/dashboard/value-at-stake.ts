import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/dashboard/value-at-stake.ts — "$ at risk" per loop surface.
 *
 * Phase 3 of the operating-loop fortification: the rail's per-verb badges stop
 * being raw counts and start carrying the capital that's *exposed and unclosed*
 * on each surface — the number an institutional operator actually steers by.
 * Staleness (days since a deal last moved) drives the badge tone; the item
 * count rides in the tooltip.
 *
 * Cheap + RLS-scoped: one `deals` read + one `diligence_runs` read, bucketed in
 * memory by lifecycle position. Degrades to a calm zero-state on any error so
 * the rail never breaks. No schema change.
 * ========================================================================= */

/** A single surface's exposure: dollars at risk + how many items, how stale. */
export interface StakeSignal {
  /** Dollars exposed/unclosed on this surface. */
  amount: number;
  /** Number of items contributing. */
  count: number;
  /** How many of those have gone quiet past the stale threshold. */
  staleCount: number;
  /** Tone: azure (active) · warning (stale) · danger (very stale / low conviction). */
  tone: 'azure' | 'warning' | 'danger';
}

export interface ValueAtStake {
  /** Source · Deals — open deals being sourced/screened (pre-diligence). */
  deals: StakeSignal;
  /** Source · LPs/Capital — gap to target (what's still to raise). */
  raiseGap: StakeSignal;
  /** Run · Diligence — capital in deals awaiting a decision. */
  diligence: StakeSignal;
  /** Drive · Deal Desk — committed-but-not-closed (at risk of slipping). */
  nearClose: StakeSignal;
  /** Drive · Cap Table — committed capital. */
  committed: StakeSignal;
  /** Build rollup — capital locked behind readiness = target × (1 − readiness/100). */
  lockedByReadiness: number;
}

const STALE_DAYS = 14;
const VERY_STALE_DAYS = 30;
const DAY_MS = 86_400_000;

const EMPTY_SIGNAL: StakeSignal = { amount: 0, count: 0, staleCount: 0, tone: 'azure' };

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / DAY_MS);
}

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/** Bucket → which lifecycle stages count toward it. */
const DILIGENCE_STAGES = new Set(['diligence', 'ic']);
const DRIVE_STAGES = new Set(['execution', 'closing', 'committed']);
const CLOSED_STAGES = new Set(['closed']);

interface Accumulator {
  amount: number;
  count: number;
  staleCount: number;
  veryStaleCount: number;
}

function fresh(): Accumulator {
  return { amount: 0, count: 0, staleCount: 0, veryStaleCount: 0 };
}

function add(acc: Accumulator, amount: number, ageDays: number): void {
  if (amount <= 0) return;
  acc.amount += amount;
  acc.count += 1;
  if (ageDays >= VERY_STALE_DAYS) acc.veryStaleCount += 1;
  else if (ageDays >= STALE_DAYS) acc.staleCount += 1;
}

function settle(acc: Accumulator, forceDanger = false): StakeSignal {
  const tone: StakeSignal['tone'] =
    forceDanger || acc.veryStaleCount > 0 ? 'danger' : acc.staleCount > 0 ? 'warning' : 'azure';
  return {
    amount: acc.amount,
    count: acc.count,
    staleCount: acc.staleCount + acc.veryStaleCount,
    tone
  };
}

/**
 * Roll the org's deal/diligence rows into per-surface exposure. `target` and
 * `committed` come from the already-loaded raise progress; `readinessScore`
 * drives the Build "locked capital" figure.
 */
export async function loadValueAtStake(
  orgId: string,
  raise: { target: number; committed: number; softCircled: number },
  readinessScore: number
): Promise<ValueAtStake> {
  const lockedByReadiness = Math.max(
    0,
    Math.round(raise.target * (1 - Math.max(0, Math.min(100, readinessScore)) / 100))
  );
  const raiseGapAcc = fresh();
  // The raise gap is a single headline figure, not a row set; model it as one
  // "item" so the surface reads as one exposure.
  const gap = Math.max(0, raise.target - raise.committed);
  if (gap > 0) {
    raiseGapAcc.amount = gap;
    raiseGapAcc.count = 1;
  }

  const committedAcc = fresh();
  if (raise.committed > 0) {
    committedAcc.amount = raise.committed;
    committedAcc.count = 1;
  }

  const empty: ValueAtStake = {
    deals: EMPTY_SIGNAL,
    raiseGap: settle(raiseGapAcc),
    diligence: EMPTY_SIGNAL,
    nearClose: EMPTY_SIGNAL,
    committed: settle(committedAcc),
    lockedByReadiness
  };

  try {
    const supabase = await createClient();
    const [{ data: deals }, { data: runs }] = await Promise.all([
      // `stage` is normalized on write (see validateStage), so we can trim the
      // obvious closed rows DB-side; the in-loop guards still catch won/archived
      // status (status isn't canonicalized yet) and any stage variants.
      supabase
        .from('deals')
        .select('amount, stage, status, updated_at')
        .eq('org_id', orgId)
        .neq('stage', 'closed'),
      supabase
        .from('diligence_runs')
        .select('conviction, status')
        .eq('org_id', orgId)
        .in('status', ['queued', 'running'])
    ]);

    const dealsAcc = fresh();
    const diligenceAcc = fresh();
    const nearCloseAcc = fresh();

    for (const d of (deals ?? []) as Array<{
      amount: number | null;
      stage: string;
      status: string;
      updated_at: string | null;
    }>) {
      const stage = norm(d.stage);
      const status = norm(d.status);
      // Skip won/closed/archived — that capital is no longer "at risk".
      if (status === 'won' || status === 'closed' || status === 'archived') continue;
      if (CLOSED_STAGES.has(stage)) continue;
      const amount = d.amount ?? 0;
      const age = daysSince(d.updated_at);
      if (DILIGENCE_STAGES.has(stage)) add(diligenceAcc, amount, age);
      else if (DRIVE_STAGES.has(stage)) add(nearCloseAcc, amount, age);
      else add(dealsAcc, amount, age);
    }

    // Low conviction on in-flight diligence escalates the Run badge to danger —
    // capital sitting on an unconvinced thesis is the riskiest kind.
    const inFlight = (runs ?? []) as Array<{ conviction: number | null; status: string }>;
    const convictions = inFlight
      .map((r) => r.conviction)
      .filter((c): c is number => typeof c === 'number');
    const lowConviction =
      convictions.length > 0 && convictions.reduce((a, b) => a + b, 0) / convictions.length < 50;

    return {
      deals: settle(dealsAcc),
      raiseGap: settle(raiseGapAcc),
      diligence: settle(diligenceAcc, lowConviction),
      nearClose: settle(nearCloseAcc),
      committed: settle(committedAcc),
      lockedByReadiness
    };
  } catch {
    return empty;
  }
}
