'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/actions/inbox.ts — Relationship Inbox triage server actions (P2).
 *
 * `act_on_inbox_item` — accept or dismiss an inbox item, optionally routing it
 * onto a deal. Thin wrapper over the guarded `act_on_inbox_item` SECURITY
 * DEFINER RPC, which enforces org membership, only advances pending ->
 * accepted/dismissed, validates any routed deal belongs to the same org, and
 * stamps acted_at atomically. The UI calls this optimistically and reverts on
 * `{ ok: false }`.
 * ========================================================================= */

export type InboxAction = 'accepted' | 'dismissed';

export interface ActOnInboxItemResult {
  ok: boolean;
  error?: string;
}

/** RPC shape for a function not yet in the generated types. */
type InboxRpc = (
  fn: 'act_on_inbox_item',
  args: { _item_id: string; _action: InboxAction; _deal_id: string | null }
) => Promise<{ error: { message: string } | null }>;

/**
 * act_on_inbox_item — transition an item to `accepted` or `dismissed` via the
 * guarded RPC, optionally binding it to a deal. Returns `{ ok: false, error }`
 * when the RPC rejects (not a member, item not found, already actioned, or a
 * foreign deal) so the UI can revert.
 */
export async function act_on_inbox_item(
  itemId: string,
  action: InboxAction,
  dealId?: string | null
): Promise<ActOnInboxItemResult> {
  try {
    const supabase = await createClient();
    const db = supabase as unknown as { rpc: InboxRpc };
    const { error } = await db.rpc('act_on_inbox_item', {
      _item_id: itemId,
      _action: action,
      _deal_id: dealId ?? null
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath('/inbox');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
