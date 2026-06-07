import 'server-only';
import { createClient } from '@/lib/supabase/server';

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
  empty: boolean;
}

export async function getMatchInboxData(orgId: string): Promise<MatchInboxData> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('matches')
    .select('id, kind, subject_id, score, status, rationale, created_at, acted_at')
    .eq('org_id', orgId)
    .order('score', { ascending: false })
    .limit(100);

  const items: MatchItem[] = (data ?? []).map((r) => ({
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

  return { pending, actioned, empty: items.length === 0 };
}
