'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/* ============================================================================
 * lib/actions/matches.ts — Match Inbox server actions.
 *
 * `act_on_match` — accept or dismiss a match row. Claude's backend may
 * extend this with additional side-effects (notifications, synergy scoring,
 * etc.). The UI calls this optimistically; the placeholder below performs the
 * minimal DB write so the status column is updated immediately.
 * ========================================================================= */

export type MatchAction = 'accepted' | 'dismissed';

export interface ActOnMatchResult {
  ok: boolean;
  error?: string;
}

/**
 * act_on_match — update a match row's status to `accepted` or `dismissed`.
 *
 * Placeholder implementation: writes directly to `matches.status` and
 * `matches.acted_at`. Claude's backend replaces or wraps this with richer
 * logic (e.g. triggering a synergy pipeline, sending a notification).
 */
export async function act_on_match(
  matchId: string,
  action: MatchAction
): Promise<ActOnMatchResult> {
  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from('matches')
      .update({ status: action, acted_at: new Date().toISOString() })
      .eq('id', matchId);

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
