'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { livekitConfigured, livekitUrl, mintAccessToken, newRoomName } from '@/lib/inbox/livekit';
import { runMeetingCopilot } from '@/lib/meeting-copilot/orchestrator';

/* ============================================================================
 * lib/actions/calls.ts — in-app call server actions (P4 foundation).
 *
 * start_inbox_call    — create a LiveKit room + a 'call' inbox item, return a
 *                       host token so the creator can join.
 * join_inbox_call     — mint a join token for an existing room the caller can
 *                       access (authorized via an RLS read of live_rooms).
 * finalize_inbox_call — end the room and run the transcript through the
 *                       4-agent Meeting Copilot, landing findings on the deal.
 *
 * Every action authorizes the caller first (active org / RLS read), then uses
 * the admin client for the privileged room + token work. Tokens are minted
 * server-side and never persisted.
 * ========================================================================= */

export interface CallTokenResult {
  ok: boolean;
  /** Stable reason code (e.g. 'not_configured', 'not_authorized'). */
  reason?: string;
  error?: string;
  room?: string;
  token?: string;
  url?: string;
}

/** Narrow typed escape over the not-yet-generated inbox_items / live_rooms tables. */
function tableEscape(client: ReturnType<typeof createAdminClient>) {
  return client as unknown as {
    from: (table: string) => {
      insert: (values: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
        };
      };
      update: (values: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

/**
 * Start a call: provision a LiveKit room, surface it as a pending 'call' inbox
 * item, and return a host token. Returns `{ ok: false, reason: 'not_configured' }`
 * when LiveKit env is absent so the UI can prompt setup.
 */
export async function start_inbox_call(opts?: {
  contactId?: string | null;
  dealId?: string | null;
  title?: string | null;
}): Promise<CallTokenResult> {
  try {
    if (!livekitConfigured()) return { ok: false, reason: 'not_configured' };

    const org = await getActiveOrg();
    if (!org) return { ok: false, reason: 'not_authorized' };

    const room = newRoomName();
    const title = opts?.title?.trim() || 'Live call';
    const admin = createAdminClient();
    const esc = tableEscape(admin);

    // Surface the call in the inbox (external_id = room name, so the row links
    // straight to the join page and dedupes).
    const { data: item, error: itemErr } = await esc
      .from('inbox_items')
      .insert({
        org_id: org.orgId,
        channel: 'call',
        direction: 'inbound',
        external_id: room,
        contact_id: opts?.contactId ?? null,
        deal_id: opts?.dealId ?? null,
        subject: title,
        preview: 'Live call room',
        score: 60,
        status: 'pending',
        rationale: [],
        occurred_at: new Date().toISOString()
      })
      .select('id')
      .single();
    if (itemErr) return { ok: false, reason: 'insert_failed', error: itemErr.message };

    const { error: roomErr } = await esc
      .from('live_rooms')
      .insert({
        org_id: org.orgId,
        room_name: room,
        inbox_item_id: item?.id ?? null,
        deal_id: opts?.dealId ?? null,
        contact_id: opts?.contactId ?? null,
        created_by: org.userId,
        title,
        status: 'open'
      })
      .select('id')
      .single();
    if (roomErr) return { ok: false, reason: 'insert_failed', error: roomErr.message };

    const token = mintAccessToken({ identity: org.userId, room, name: title });
    if (!token) return { ok: false, reason: 'not_configured' };

    revalidatePath('/inbox');
    return { ok: true, room, token, url: livekitUrl() ?? undefined };
  } catch (err) {
    return {
      ok: false,
      reason: 'unknown',
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/** Narrow typed reader for live_rooms under the caller's RLS. */
function roomReader(client: Awaited<ReturnType<typeof createClient>>) {
  return client as unknown as {
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
  };
}

/**
 * Mint a join token for an existing room. The RLS read authorizes the caller:
 * a non-member sees no row and gets `not_authorized`.
 */
export async function join_inbox_call(roomName: string): Promise<CallTokenResult> {
  try {
    if (!livekitConfigured()) return { ok: false, reason: 'not_configured' };

    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: 'not_authorized' };

    const { data: room } = await roomReader(supabase)
      .from('live_rooms')
      .select('room_name, status')
      .eq('room_name', roomName)
      .maybeSingle();
    if (!room) return { ok: false, reason: 'not_authorized' };
    if (room.status === 'ended')
      return { ok: false, reason: 'ended', error: 'This call has ended.' };

    const token = mintAccessToken({
      identity: user.id,
      room: roomName,
      name: user.email ?? 'Guest'
    });
    if (!token) return { ok: false, reason: 'not_configured' };

    return { ok: true, room: roomName, token, url: livekitUrl() ?? undefined };
  } catch (err) {
    return {
      ok: false,
      reason: 'unknown',
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

export interface FinalizeCallResult {
  ok: boolean;
  reason?: string;
  error?: string;
  runId?: string;
}

/**
 * End a call and run its transcript through the Meeting Copilot. Authorizes via
 * an RLS read of the room, then ends the room + records the synthesis with the
 * admin client. Never-block on the AI step: the room is always marked ended.
 */
export async function finalize_inbox_call(
  roomName: string,
  transcript: string
): Promise<FinalizeCallResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: 'not_authorized' };

    const { data: room } = await roomReader(supabase)
      .from('live_rooms')
      .select('room_name, org_id, deal_id, inbox_item_id')
      .eq('room_name', roomName)
      .maybeSingle();
    if (!room) return { ok: false, reason: 'not_authorized' };

    const admin = createAdminClient();
    const esc = tableEscape(admin);

    // Always close the room; the AI synthesis is best-effort on top.
    await esc
      .from('live_rooms')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('room_name', roomName);

    const orgId = typeof room.org_id === 'string' ? room.org_id : '';
    const dealId = typeof room.deal_id === 'string' ? room.deal_id : null;

    let runId: string | undefined;
    const text = transcript.trim();
    if (orgId && text) {
      const result = await runMeetingCopilot({
        orgId,
        createdBy: user.id,
        transcript: text,
        dealId
      });
      if (result.status === 'complete') runId = result.runId;
    }

    // Mark the inbox 'call' item handled.
    const itemId = typeof room.inbox_item_id === 'string' ? room.inbox_item_id : null;
    if (itemId) {
      await esc
        .from('inbox_items')
        .update({ status: 'accepted', acted_at: new Date().toISOString() })
        .eq('id', itemId);
    }

    revalidatePath('/inbox');
    return { ok: true, runId };
  } catch (err) {
    return {
      ok: false,
      reason: 'unknown',
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}
