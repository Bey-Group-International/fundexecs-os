import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  computeCalibration,
  type CalibrationFactor,
  type IntelligenceCalibration
} from '@/lib/queries/intelligence-calibration';

/* ============================================================================
 * lib/queries/match-inbox.ts — Match Inbox surface loader.
 *
 * Reads the `matches` table for the org, returning pending matches for triage
 * (accept / dismiss). Claude's backend exposes the `act_on_match` server
 * action; the UI calls it optimistically and falls back to a placeholder state
 * until it is wired. No migrations required — reads existing rows only.
 * ========================================================================= */

export type MatchStatus = 'pending' | 'accepted' | 'dismissed' | string;

export interface MatchItem {
  id: string;
  kind: string;
  subjectId: string;
  score: number;
  status: MatchStatus;
  /** JSON rationale blob — may contain { summary, reasons[] } */
  rationale: Record<string, unknown>;
  createdAt: string;
  actedAt: string | null;
}

export interface MatchInboxData {
  pending: MatchItem[];
  actioned: MatchItem[];
  /** Self-aware read model: what triage has taught the scorer so far. */
  calibration: IntelligenceCalibration;
  empty: boolean;
}

/** Best-effort extraction of factor weights from a rationale blob. */
function rationaleFactors(rationale: unknown): CalibrationFactor[] {
  if (!Array.isArray(rationale)) return [];
  const out: CalibrationFactor[] = [];
  for (const entry of rationale) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.factor !== 'string') continue;
    out.push({ factor: r.factor, weight: typeof r.weight === 'number' ? r.weight : 0 });
  }
  return out;
}

export async function getMatchInboxData(orgId: string): Promise<MatchInboxData> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('matches')
    .select('id, kind, subject_id, score, status, rationale, created_at, acted_at')
    .eq('org_id', orgId)
    .order('score', { ascending: false })
    .limit(100);

  const rows = data ?? [];

  const items: MatchItem[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    subjectId: r.subject_id,
    score: r.score,
    status: r.status,
    rationale: (r.rationale as Record<string, unknown>) ?? {},
    createdAt: r.created_at,
    actedAt: r.acted_at
  }));

  const pending = items.filter((m) => m.status === 'pending');
  const actioned = items.filter((m) => m.status !== 'pending');

  const calibration = computeCalibration(
    rows.map((r) => ({
      score: r.score,
      status: r.status,
      factors: rationaleFactors(r.rationale)
    }))
  );

  return { pending, actioned, calibration, empty: items.length === 0 };
}

/**
 * Cheap count of pending matches waiting for the org — feeds the Profile's
 * "Matchable — N waiting" payoff. Head-only count, fail-open to 0 so the payoff
 * never breaks the page.
 */
export async function getPendingMatchCount(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'pending');
  return count ?? 0;
}
