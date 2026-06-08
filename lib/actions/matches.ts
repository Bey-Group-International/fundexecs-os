'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { judgeMatch as runJudge, type MatchJudgement } from '@/lib/ai/match-judge';
import { refreshOrgProfileEmbedding, type EmbedResult } from '@/lib/ai/profile-embedding';
import { getActiveOrg } from '@/lib/queries/org';

/* ============================================================================
 * lib/actions/matches.ts — Match Inbox server actions.
 *
 * `act_on_match` — accept or dismiss a match row. Thin wrapper over the live
 * `act_on_match(_match_id, _action)` SECURITY DEFINER RPC (Wave 4), which:
 *   - enforces the caller is an active member of the match's org (authz),
 *   - guards the transition (only new → accepted/dismissed; double-action errors),
 *   - stamps `acted_at` / `acted_by` atomically under a row lock, and
 *   - seeds the downstream side-effect (a `capital_commitments` target row for
 *     accepted LP matches; a deal↔provider `synergy_opportunities` row for
 *     accepted deal matches).
 * The UI calls this optimistically and reverts on `{ ok: false }`.
 *
 * After a successful decision we fire the adaptive learning step
 * (`recompute_match_scoring_weights`) so the scorer re-weights its factors
 * from the org's revealed preferences. That step is never-block: any failure
 * is swallowed and never affects the accept/dismiss the user just made.
 * ========================================================================= */

export type MatchAction = 'accepted' | 'dismissed';

export interface ActOnMatchResult {
  ok: boolean;
  error?: string;
}

/** Service-role RPC shape for functions not yet in the generated types. */
type ServiceRpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ error: { message: string } | null }>;

/**
 * Re-learn this org's per-factor weights from its actioned matches. Best-
 * effort: a missing service role, an RLS surprise, or any RPC error is
 * swallowed — the learning loop is an enhancement, never a gate.
 */
async function relearnWeights(orgId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    // Call `.rpc` as a method (don't detach it, or it loses its `this` binding).
    const db = admin as unknown as { rpc: ServiceRpc };
    await db.rpc('recompute_match_scoring_weights', { _org_id: orgId });
  } catch {
    // never-block
  }
}

/**
 * act_on_match — transition a match to `accepted` or `dismissed` via the
 * guarded RPC. Returns `{ ok: false, error }` when the RPC rejects (not a
 * member, match not found, or already actioned) so the UI can revert.
 */
export async function act_on_match(
  matchId: string,
  action: MatchAction
): Promise<ActOnMatchResult> {
  try {
    const supabase = await createClient();

    // Resolve the org under RLS before acting so we can re-learn for it after.
    const { data: matchRow } = await supabase
      .from('matches')
      .select('org_id')
      .eq('id', matchId)
      .maybeSingle();

    const { error } = await supabase.rpc('act_on_match', {
      _match_id: matchId,
      _action: action
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    if (matchRow?.org_id) {
      await relearnWeights(matchRow.org_id);
    }

    revalidatePath('/match-inbox');
    revalidatePath('/inbox-intelligence');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * judge_match — ask the routed specialist (via Claude) for a calibrated second
 * opinion on a match, persisted onto the match's rationale. Authorizes the
 * caller against the match's org under RLS first, then runs the never-block
 * judge with the admin client. Returns `{ ok: false }` on every degrade path.
 */
export async function judge_match(matchId: string): Promise<MatchJudgement> {
  try {
    const supabase = await createClient();
    const { data: matchRow } = await supabase
      .from('matches')
      .select('id')
      .eq('id', matchId)
      .maybeSingle();

    if (!matchRow) return { ok: false, reason: 'not_authorized' };

    const result = await runJudge(matchId);
    if (result.ok) {
      revalidatePath('/match-inbox');
      revalidatePath('/inbox-intelligence');
    }
    return result;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'unknown' };
  }
}

/**
 * refresh_mandate_embedding — (re)embed the active org's mandate so the scorer
 * can add the meaning-level `semantic_fit` factor. Never-block: returns
 * `{ ok: false }` without throwing when VOYAGE_API_KEY or profile text is
 * absent. Safe to call opportunistically (e.g. after a profile edit).
 */
export async function refresh_mandate_embedding(): Promise<EmbedResult> {
  try {
    const org = await getActiveOrg();
    if (!org) return { ok: false, reason: 'no_org' };
    const result = await refreshOrgProfileEmbedding(org.orgId);
    if (result.ok) revalidatePath('/inbox-intelligence');
    return result;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'unknown' };
  }
}
