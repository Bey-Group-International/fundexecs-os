import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  type InboxChannel,
  type InboxItem,
  type InboxStatus,
  WIRED_CHANNELS,
  COMING_SOON_CHANNELS
} from '@/lib/inbox/channels';

/* ============================================================================
 * lib/queries/inbox.ts — Relationship Inbox read surface (P1).
 *
 * Read-only over the `inbox_items` table (RLS-scoped): channel-agnostic
 * messages surfaced for triage. Mirrors the Match Inbox shape so the same
 * accept / dismiss + rationale UI applies. `inbox_items` is additive and not
 * yet in the generated Supabase types, so we read through a narrow typed
 * escape (same pattern as inbox-intelligence.ts's briefing reader).
 *
 * Channel types + constants + the InboxItem shape live in the client-safe
 * `@/lib/inbox/channels` module (this file is `server-only`); re-exported here
 * so existing import sites keep working.
 *
 * The table is empty until ingestion lands (P2). Every read fails OPEN to an
 * empty inbox so the surface never breaks the shell.
 * ========================================================================= */

export type { InboxChannel, InboxItem, InboxStatus };
export { WIRED_CHANNELS, COMING_SOON_CHANNELS };

export interface InboxData {
  pending: InboxItem[];
  actioned: InboxItem[];
  /** Pending count per wired channel — drives the filter-chip badges. */
  countsByChannel: Record<InboxChannel, number>;
  empty: boolean;
}

interface InboxRow {
  id: string;
  channel: string;
  direction: string;
  external_id: string | null;
  thread_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  subject: string | null;
  preview: string | null;
  draft_reply: string | null;
  score: number | null;
  status: string;
  rationale: unknown;
  occurred_at: string | null;
  created_at: string;
  acted_at: string | null;
}

/** Narrow typed escape over the not-yet-generated `inbox_items` table. */
function inboxReader(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase as unknown as {
    from: (table: string) => {
      select: (
        cols: string,
        opts?: { count: 'exact'; head: true }
      ) => {
        eq: (
          col: string,
          val: string
        ) => {
          eq: (col: string, val: string) => Promise<{ count: number | null }>;
          order: (
            col: string,
            opts: { ascending: boolean }
          ) => {
            limit: (
              n: number
            ) => Promise<{ data: InboxRow[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
}

function toItem(r: InboxRow): InboxItem {
  return {
    id: r.id,
    channel: r.channel as InboxChannel,
    direction: r.direction === 'outbound' ? 'outbound' : 'inbound',
    externalId: r.external_id,
    threadId: r.thread_id,
    contactId: r.contact_id,
    dealId: r.deal_id,
    subject: r.subject ?? '',
    preview: r.preview ?? '',
    draftReply: r.draft_reply,
    score: typeof r.score === 'number' ? r.score : 0,
    status: r.status as InboxStatus,
    rationale: Array.isArray(r.rationale) ? (r.rationale as Record<string, unknown>[]) : [],
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
    actedAt: r.acted_at
  };
}

const ZERO_COUNTS: Record<InboxChannel, number> = {
  email: 0,
  slack: 0,
  call: 0,
  linkedin: 0,
  sms: 0,
  webinar: 0
};

/** Load the org's inbox — newest first, split into pending vs actioned. */
export async function getInboxData(orgId: string): Promise<InboxData> {
  const supabase = await createClient();

  try {
    const { data, error } = await inboxReader(supabase)
      .from('inbox_items')
      .select(
        'id, channel, direction, external_id, thread_id, contact_id, deal_id, subject, preview, draft_reply, score, status, rationale, occurred_at, created_at, acted_at'
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !data) {
      if (error) console.warn('[getInboxData] read failed:', error.message);
      return { pending: [], actioned: [], countsByChannel: { ...ZERO_COUNTS }, empty: true };
    }

    const items = data.map(toItem);
    const pending = items.filter((i) => i.status === 'pending');
    const actioned = items.filter((i) => i.status !== 'pending');

    const countsByChannel = { ...ZERO_COUNTS };
    for (const i of pending) countsByChannel[i.channel] = (countsByChannel[i.channel] ?? 0) + 1;

    return { pending, actioned, countsByChannel, empty: items.length === 0 };
  } catch (err) {
    console.warn('[getInboxData] unexpected error:', err);
    return { pending: [], actioned: [], countsByChannel: { ...ZERO_COUNTS }, empty: true };
  }
}

/**
 * Cheap count of pending inbox items — feeds the nav bell badge. Head-only
 * count, fail-open to 0 so the badge never breaks the shell.
 */
export async function getPendingInboxCount(orgId: string): Promise<number> {
  const supabase = await createClient();
  try {
    const { count } = await inboxReader(supabase)
      .from('inbox_items')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'pending');
    return count ?? 0;
  } catch {
    return 0;
  }
}
