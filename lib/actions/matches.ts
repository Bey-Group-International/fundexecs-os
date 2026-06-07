'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

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
 * ========================================================================= */

export type MatchAction = 'accepted' | 'dismissed';

export interface ActOnMatchResult {
  ok: boolean;
  error?: string;
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

    const { error } = await supabase.rpc('act_on_match', {
      _match_id: matchId,
      _action: action
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath('/match-inbox');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}
