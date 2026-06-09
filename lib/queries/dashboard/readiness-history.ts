import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ReadinessDimensionScore } from '@/lib/lifecycle';

/* ============================================================================
 * lib/queries/dashboard/readiness-history.ts — the readiness trend + momentum.
 *
 * Reads recent `readiness_snapshots` rows for the org and shapes them into a
 * trend series plus a momentum read (delta + velocity over the window). Pairs
 * with `captureReadinessSnapshot`, which the Readiness page calls on render to
 * persist today's score (idempotent per day).
 *
 * Defensive by construction: the snapshots table is new, so every read/write is
 * wrapped — a missing table or RLS denial degrades to a calm empty trend rather
 * than breaking the page. No throw escapes this module.
 * ========================================================================= */

/** One point on the readiness trend line. */
export interface ReadinessTrendPoint {
  /** UTC date (YYYY-MM-DD). */
  date: string;
  /** Compound readiness score that day, 0–100. */
  score: number;
  /** Flat weighted-average score that day, 0–100. */
  baseScore: number;
}

export interface ReadinessMomentum {
  /** Points changed across the window (latest − earliest). */
  delta: number;
  /** Average points/day across the window. */
  velocity: number;
  /** Direction of travel. */
  direction: 'up' | 'down' | 'flat';
  /** Number of snapshots the read is based on. */
  samples: number;
}

export interface ReadinessHistory {
  /** Oldest → newest trend points (at most `WINDOW_DAYS`). */
  series: ReadinessTrendPoint[];
  momentum: ReadinessMomentum;
}

/** How far back the trend + momentum window reaches. */
const WINDOW_DAYS = 30;

const EMPTY_MOMENTUM: ReadinessMomentum = {
  delta: 0,
  velocity: 0,
  direction: 'flat',
  samples: 0
};

const EMPTY_HISTORY: ReadinessHistory = { series: [], momentum: EMPTY_MOMENTUM };

interface SnapshotRow {
  captured_on: string;
  score: number;
  base_score: number | null;
}

function momentumFrom(series: ReadinessTrendPoint[]): ReadinessMomentum {
  if (series.length < 2) {
    return { ...EMPTY_MOMENTUM, samples: series.length };
  }
  const first = series[0];
  const last = series[series.length - 1];
  const delta = last.score - first.score;
  // Span in days between the two ends; guard against same-day clusters.
  const spanDays = Math.max(
    1,
    Math.round((new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000)
  );
  const velocity = Math.round((delta / spanDays) * 10) / 10;
  return {
    delta,
    velocity,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    samples: series.length
  };
}

/**
 * Load the org's readiness trend + momentum over the last {@link WINDOW_DAYS}.
 * Returns an empty trend (not an error) when there's no history yet.
 */
export async function loadReadinessHistory(orgId: string): Promise<ReadinessHistory> {
  try {
    const supabase = await createClient();
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      // The table is newer than the generated types; cast keeps this typed-safe
      // without a regenerated Database type in the diff.
      .from('readiness_snapshots' as never)
      .select('captured_on, score, base_score')
      .eq('org_id', orgId)
      .gte('captured_on', since)
      .order('captured_on', { ascending: true })
      .limit(WINDOW_DAYS);

    if (error || !data) return EMPTY_HISTORY;

    const series: ReadinessTrendPoint[] = (data as unknown as SnapshotRow[]).map((r) => ({
      date: r.captured_on,
      score: r.score,
      baseScore: r.base_score ?? 0
    }));

    return { series, momentum: momentumFrom(series) };
  } catch {
    return EMPTY_HISTORY;
  }
}

/**
 * Persist today's readiness snapshot (idempotent per org per day). Called from
 * the Readiness page render so the trend builds passively over time — no cron.
 * Swallows all errors: a failed snapshot must never break the page.
 */
export async function captureReadinessSnapshot(
  orgId: string,
  score: number,
  baseScore: number,
  breakdown: ReadinessDimensionScore[]
): Promise<void> {
  try {
    const supabase = await createClient();
    const capturedOn = new Date().toISOString().slice(0, 10);
    await supabase.from('readiness_snapshots' as never).upsert(
      {
        org_id: orgId,
        captured_on: capturedOn,
        score: Math.round(score),
        base_score: Math.round(baseScore),
        breakdown
      } as never,
      { onConflict: 'org_id,captured_on' }
    );
  } catch {
    // Snapshot is best-effort telemetry; never surface a failure to the page.
  }
}
