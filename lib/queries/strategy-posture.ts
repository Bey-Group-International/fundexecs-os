import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  computePostureMomentum,
  computePeerPercentile,
  type PostureSnapshot,
  type PostureMomentum,
  type PosturePercentile
} from '@/lib/strategy/posture-trend';

/* ============================================================================
 * lib/queries/strategy-posture.ts — the snapshot-backed posture trend.
 *
 * Reads the org's org_posture_snapshots history + the same-stage / same-member-
 * type cohort under RLS, then runs the pure trend functions to derive the
 * weekly momentum Δ + streak and (only above the privacy floor) the peer
 * percentile. Pairs with `capturePostureSnapshot`, which the /strategy page
 * calls on render to persist today's composite via the upsert RPC.
 *
 * Defensive by construction: the table is newer than the generated types, so
 * every read/write is wrapped — a missing table, missing RPC, or RLS denial
 * degrades to a calm empty trend (no Δ, no rank) rather than breaking the page.
 * No throw escapes this module, and nothing is fabricated.
 * ========================================================================= */

export interface PostureTrend {
  /** Weekly momentum Δ + streak, or null when there's no history yet. */
  momentum: PostureMomentum | null;
  /** Peer percentile, or null below the privacy floor / with no cohort. */
  percentile: PosturePercentile | null;
}

export const EMPTY_POSTURE_TREND: PostureTrend = { momentum: null, percentile: null };

/** How far back the momentum + streak window reaches. */
const WINDOW_DAYS = 60;

/** Cohort lookback: peers whose most recent snapshot lands inside this window. */
const COHORT_WINDOW_DAYS = 14;

interface SnapshotRow {
  snapshot_date: string;
  composite: number;
}

interface CohortRow {
  org_id: string;
  composite: number;
  snapshot_date: string;
}

/**
 * Load the org's posture trend: momentum + streak from its own snapshot trail,
 * and a peer percentile against the same stage / member-type cohort. Returns an
 * empty trend (not an error) when there's no history or no qualifying cohort.
 *
 * `stage` / `memberType` define the cohort bucket; passing null for either
 * skips the percentile (we never rank against an undefined cohort).
 */
export async function getPostureTrend(
  orgId: string,
  stage: string | null,
  memberType: string | null
): Promise<PostureTrend> {
  try {
    const supabase = await createClient();
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

    const { data, error } = await supabase
      // The table is newer than the generated types; cast keeps this type-safe
      // without forcing the whole Database type regen into this diff.
      .from('org_posture_snapshots' as never)
      .select('snapshot_date, composite')
      .eq('org_id', orgId)
      .gte('snapshot_date', since)
      .order('snapshot_date', { ascending: true })
      .limit(WINDOW_DAYS);

    if (error || !data) return EMPTY_POSTURE_TREND;

    const snapshots: PostureSnapshot[] = (data as unknown as SnapshotRow[]).map((r) => ({
      date: r.snapshot_date,
      composite: r.composite
    }));

    const momentum = computePostureMomentum(snapshots);
    const percentile =
      momentum !== null
        ? await loadPeerPercentile(orgId, momentum.current, stage, memberType)
        : null;

    return { momentum, percentile };
  } catch {
    return EMPTY_POSTURE_TREND;
  }
}

/**
 * Resolve the peer percentile for `orgComposite` within the same stage /
 * member-type cohort. Reads recent cohort snapshots, keeps one (the latest) per
 * peer org, and hands the peers to the pure percentile fn — which withholds a
 * rank below the privacy floor. Degrades to null on any error or missing key.
 */
async function loadPeerPercentile(
  orgId: string,
  orgComposite: number,
  stage: string | null,
  memberType: string | null
): Promise<PosturePercentile | null> {
  if (!stage || !memberType) return null;

  try {
    const supabase = await createClient();
    const since = new Date(Date.now() - COHORT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('org_posture_snapshots' as never)
      .select('org_id, composite, snapshot_date')
      .eq('stage', stage)
      .eq('member_type', memberType)
      .gte('snapshot_date', since)
      .order('snapshot_date', { ascending: false });

    if (error || !data) return null;

    // Keep the most recent composite per peer org, excluding this org.
    const latestByOrg = new Map<string, number>();
    for (const row of data as unknown as CohortRow[]) {
      if (row.org_id === orgId) continue;
      if (!latestByOrg.has(row.org_id)) latestByOrg.set(row.org_id, row.composite);
    }

    return computePeerPercentile(orgComposite, Array.from(latestByOrg.values()));
  } catch {
    return null;
  }
}

/**
 * Persist today's posture snapshot (idempotent per org per day) via the
 * SECURITY DEFINER upsert RPC. Called from the /strategy page render so the
 * trend builds passively over time — no cron. Swallows all errors: a failed
 * snapshot must never break the page. Pillar sub-scores pass null through when a
 * pillar is unmeasured — never a fabricated zero.
 */
export async function capturePostureSnapshot(input: {
  orgId: string;
  composite: number | null;
  compliance: number | null;
  governance: number | null;
  execution: number | null;
  capital: number | null;
  stage: string | null;
  memberType: string | null;
}): Promise<void> {
  // No composite means nothing measurable to record — skip without a write.
  if (input.composite === null) return;
  try {
    const supabase = await createClient();
    await supabase.rpc(
      'upsert_org_posture_snapshot' as never,
      {
        _org_id: input.orgId,
        _composite: input.composite,
        _compliance: input.compliance,
        _governance: input.governance,
        _execution: input.execution,
        _capital: input.capital,
        _stage: input.stage,
        _member_type: input.memberType
      } as never
    );
  } catch {
    // Snapshot is best-effort telemetry; never surface a failure to the page.
  }
}
