'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getConnectedIntegrationConnection,
  getIntegrationSecret,
  isSecretExpired,
  storeIntegrationSecret
} from '@/lib/integrations/connections';
import { refreshProviderToken } from '@/lib/integrations/oauth';
import { draftInboxReply, type DraftResult } from '@/lib/inbox/draft';
import { sendGmailReply, sendSlackReply } from '@/lib/inbox/send';

/* ============================================================================
 * lib/actions/inbox.ts — Relationship Inbox triage + reply server actions.
 *
 * P2: `act_on_inbox_item` — accept/dismiss via the guarded RPC.
 * P3: `draft_inbox_reply`  — Earn drafts a reply onto the item.
 *     `send_inbox_reply`   — send the approved reply via Gmail/Slack and mark
 *                            the item sent.
 *
 * Authorization: every action authorizes the caller against the item's org by
 * first reading the row under RLS (returns null for non-members), then uses the
 * admin client only for the privileged token/send/status work.
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

/** Narrow typed escape for reading the not-yet-generated `inbox_items` table. */
interface InboxRowReader {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
      };
    };
  };
}

function rowReader(client: Awaited<ReturnType<typeof createClient>>): InboxRowReader {
  return client as unknown as InboxRowReader;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

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

/**
 * draft_inbox_reply — authorize the caller against the item's org, then have
 * Earn draft a reply onto `inbox_items.draft_reply`. Never-block: returns
 * `{ ok: false, reason }` on every degrade path.
 */
export async function draft_inbox_reply(itemId: string): Promise<DraftResult> {
  try {
    const supabase = await createClient();
    const { data } = await rowReader(supabase)
      .from('inbox_items')
      .select('id')
      .eq('id', itemId)
      .maybeSingle();
    if (!data) return { ok: false, reason: 'not_authorized' };

    const result = await draftInboxReply(itemId);
    if (result.ok) revalidatePath('/inbox');
    return result;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'unknown' };
  }
}

export interface SendInboxReplyResult {
  ok: boolean;
  /** Stable reason code (e.g. 'missing_scope', 'not_connected'). */
  reason?: string;
  error?: string;
}

/**
 * send_inbox_reply — send the approved reply through the item's channel and
 * mark it sent. Authorizes via an RLS read, resolves the channel's connection
 * + token (refreshing when expired), sends via Gmail/Slack, then updates the
 * row with the admin client. Returns a typed reason on every failure so the UI
 * can prompt a reconnect when a send scope is missing.
 */
export async function send_inbox_reply(
  itemId: string,
  body: string
): Promise<SendInboxReplyResult> {
  try {
    const text = body.trim();
    if (!text) return { ok: false, reason: 'empty_body', error: 'Write a reply before sending.' };

    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: 'not_authorized' };

    // Authorize + load the item under RLS (null = not a member / not found).
    const { data: item } = await rowReader(supabase)
      .from('inbox_items')
      .select(
        'id, org_id, channel, external_id, thread_id, reply_to_message_id, contact_id, subject, status'
      )
      .eq('id', itemId)
      .maybeSingle();
    if (!item) return { ok: false, reason: 'not_authorized' };
    // Pending-only, server-enforced: mirrors the UI's reply contract so a
    // crafted call can't resend an already-actioned or sent item.
    const status = asString(item.status);
    if (status !== 'pending') {
      return {
        ok: false,
        reason: 'invalid_state',
        error:
          status === 'dismissed'
            ? 'This conversation was dismissed.'
            : 'This conversation is no longer sendable.'
      };
    }

    const channel = asString(item.channel);
    const provider = channel === 'email' ? 'gmail' : channel === 'slack' ? 'slack' : null;
    if (!provider) {
      return {
        ok: false,
        reason: 'unsupported_channel',
        error: `Can't send on the ${channel} channel yet.`
      };
    }

    const orgId = asString(item.org_id);
    const admin = createAdminClient();

    const connection = await getConnectedIntegrationConnection({
      admin,
      orgId,
      userId: user.id,
      provider
    });
    if (!connection) {
      return { ok: false, reason: 'not_connected', error: `Connect ${provider} to send replies.` };
    }

    let secret = await getIntegrationSecret(admin, connection.id);
    if (!secret?.access_token) {
      return {
        ok: false,
        reason: 'not_connected',
        error: `Reconnect ${provider}; no token is stored.`
      };
    }
    if (isSecretExpired(secret)) {
      const refreshed = await refreshProviderToken({ provider, secret });
      if (!refreshed) {
        return { ok: false, reason: 'expired', error: `Reconnect ${provider}; the token expired.` };
      }
      secret = await storeIntegrationSecret({
        admin,
        connectionId: connection.id,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenType: refreshed.tokenType,
        expiresAt: refreshed.expiresAt
      });
    }
    const token = secret.access_token;
    if (!token) return { ok: false, reason: 'not_connected' };

    // Channel send.
    let sent;
    if (provider === 'gmail') {
      const contactId = asString(item.contact_id);
      if (!contactId) {
        return {
          ok: false,
          reason: 'no_recipient',
          error: 'No recipient email on this conversation.'
        };
      }
      const { data: contact } = await admin
        .from('contacts')
        .select('primary_email')
        .eq('id', contactId)
        .maybeSingle();
      const to = contact?.primary_email;
      if (!to) {
        return {
          ok: false,
          reason: 'no_recipient',
          error: 'No recipient email on this conversation.'
        };
      }
      sent = await sendGmailReply({
        token,
        to,
        subject: asString(item.subject) || '(no subject)',
        body: text,
        threadId: asString(item.thread_id) || null,
        inReplyTo: asString(item.reply_to_message_id) || null
      });
    } else {
      const channelId = asString(item.external_id).split(':')[0];
      if (!channelId) {
        return {
          ok: false,
          reason: 'no_recipient',
          error: 'No Slack channel on this conversation.'
        };
      }
      sent = await sendSlackReply({ token, channel: channelId, text });
    }

    if (!sent.ok) return { ok: false, reason: sent.reason, error: sent.error };

    // Mark sent (service-role write; the user already passed the RLS gate).
    const writer = admin as unknown as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => {
          eq: (c: string, val: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { error: updateError } = await writer
      .from('inbox_items')
      .update({ status: 'sent', draft_reply: text, acted_at: new Date().toISOString() })
      .eq('id', itemId);
    if (updateError) {
      // The reply was sent but the row didn't flip to 'sent'. Surface it so the
      // operator refreshes rather than re-sending a duplicate.
      return {
        ok: false,
        reason: 'post_send_update_failed',
        error: 'Reply sent, but the inbox didn’t update — refresh before resending.'
      };
    }

    revalidatePath('/inbox');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'unknown',
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}
