import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/sourcing-brief.ts — the org's standing sourcing brief.
 *
 * A brief is the thesis the sourcing desk works on a schedule: the intelligence
 * cron raises a "scout targets" proposal into the Action Queue for each active
 * brief, and approval runs target discovery against this thesis. One brief per
 * org (enforced by a unique constraint); RLS-scoped; fails soft to null.
 * ========================================================================= */

export interface SourcingBrief {
  thesis: string;
  active: boolean;
  updatedAt: string | null;
}

/** The org's brief, or null when none has been set yet. */
export async function getSourcingBrief(orgId: string): Promise<SourcingBrief | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sourcing_briefs')
    .select('thesis, active, updated_at')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error || !data) return null;
  return { thesis: data.thesis, active: data.active, updatedAt: data.updated_at };
}
