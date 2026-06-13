import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { InteractionType, ProviderSignals } from '@/lib/integrations/types';
import type { InboxChannel } from '@/lib/inbox/channels';

/* ============================================================================
 * lib/inbox/ingest.ts — turn normalized provider interactions into Relationship
 * Inbox rows (P2). Runs alongside the warmth-signal ingest: the same Gmail /
 * Slack / call signals that update `relationships` also surface as triage
 * items in `inbox_items`.
 *
 * The channel mapping + scoring are pure and unit-tested. The writer uses a
 * narrow typed escape because `inbox_items` is additive and not yet in the
 * generated Supabase types.
 * ========================================================================= */

/** Providers whose meetings we surface as the `call` channel. */
const CALL_PROVIDERS = new Set(['google_meet', 'zoom', 'calendly']);

/**
 * Map a provider + interaction type to an inbox channel, or null when the
 * interaction isn't a conversation worth surfacing (calendar events, notes,
 * raw drive/doc syncs).
 */
export function channelForInteraction(
  provider: string,
  type: InteractionType
): InboxChannel | null {
  if (type === 'email_received' || type === 'email_sent') return 'email';
  if (type === 'message') return 'slack';
  if (type === 'meeting' && CALL_PROVIDERS.has(provider)) return 'call';
  return null;
}

/**
 * Whether an interaction on this channel belongs in the triage worklist.
 * Email/Slack only surface inbound messages (the ones that may need a reply);
 * calls/meetings always surface as a record of the conversation.
 */
export function shouldSurface(channel: InboxChannel, direction: string): boolean {
  if (channel === 'email' || channel === 'slack') return direction === 'inbound';
  return true;
}

export interface InboxScoreInput {
  channel: InboxChannel;
  direction: 'inbound' | 'outbound';
  occurredAt: string;
  /** Whether the message resolved to a known contact in this org. */
  hasContact: boolean;
  /** Injectable clock for deterministic tests. Defaults to Date.now(). */
  now?: number;
}

export interface RationaleFactor {
  factor: string;
  weight: number;
  detail: string;
}

export interface ScoredInboxItem {
  score: number;
  rationale: RationaleFactor[];
}

const CHANNEL_WEIGHT: Record<InboxChannel, number> = {
  email: 25,
  slack: 20,
  call: 15,
  linkedin: 18,
  sms: 18,
  webinar: 10
};

/**
 * Deterministic 0-100 priority + explainable rationale, in the same
 * `[{ factor, weight, detail }]` shape as `matches.rationale` so the Match
 * Inbox calibration read model applies unchanged. No invented signal — every
 * factor is derived from the interaction itself.
 */
export function scoreInboxItem(input: InboxScoreInput): ScoredInboxItem {
  const now = input.now ?? Date.now();
  const ageDays = Math.max(0, now - new Date(input.occurredAt).getTime()) / 86_400_000;

  const recency = ageDays < 1 ? 30 : ageDays < 7 ? 20 : ageDays < 30 ? 10 : 5;
  const channel = CHANNEL_WEIGHT[input.channel] ?? 10;
  const relationship = input.hasContact ? 15 : 5;
  const responsiveness = input.direction === 'inbound' ? 10 : 0;

  const score = Math.min(100, recency + channel + relationship + responsiveness);

  const rationale: RationaleFactor[] = [
    {
      factor: 'recency',
      weight: recency,
      detail:
        ageDays < 1
          ? 'Arrived in the last day — freshest items rise to the top.'
          : ageDays < 7
            ? 'Arrived this week.'
            : ageDays < 30
              ? 'Arrived this month.'
              : 'Older than a month.'
    },
    {
      factor: 'channel',
      weight: channel,
      detail: `Surfaced from the ${input.channel} channel.`
    },
    {
      factor: 'relationship',
      weight: relationship,
      detail: input.hasContact
        ? 'Resolved to a known contact in your network.'
        : 'No existing contact matched yet.'
    },
    {
      factor: 'responsiveness',
      weight: responsiveness,
      detail:
        input.direction === 'inbound'
          ? 'Inbound — may need a reply.'
          : 'Outbound — recorded for context.'
    }
  ];

  return { score, rationale };
}

type Admin = SupabaseClient<Database>;

export interface InboxIngestTarget {
  orgId: string;
  provider: string;
}

interface InboxItemRow {
  org_id: string;
  channel: InboxChannel;
  direction: 'inbound' | 'outbound';
  external_id: string;
  thread_id: string | null;
  reply_to_message_id: string | null;
  contact_id: string | null;
  subject: string | null;
  preview: string | null;
  score: number;
  status: 'pending';
  rationale: RationaleFactor[];
  occurred_at: string;
}

/** Narrow typed escape over the not-yet-generated `inbox_items` table. */
interface InboxWriter {
  from: (table: string) => {
    upsert: (
      rows: InboxItemRow[],
      opts: { onConflict: string; ignoreDuplicates: boolean }
    ) => {
      select: (
        cols: string
      ) => Promise<{ data: { id: string }[] | null; error: { message: string } | null }>;
    };
  };
}

/**
 * Build + upsert inbox_items from a provider's normalized signals. Idempotent
 * on (org_id, channel, external_id), so re-syncing a window never duplicates a
 * conversation. Returns the number of new rows. Must be called with the
 * service-role client (RLS grants authenticated select only).
 */
export async function ingestInboxItems(
  admin: Admin,
  target: InboxIngestTarget,
  signals: ProviderSignals,
  emailToId: Map<string, string>
): Promise<number> {
  const rows: InboxItemRow[] = [];

  for (const i of signals.interactions) {
    const channel = channelForInteraction(target.provider, i.type);
    if (!channel) continue;
    if (!shouldSurface(channel, i.direction)) continue;

    const direction: 'inbound' | 'outbound' = i.direction === 'outbound' ? 'outbound' : 'inbound';
    const contactId = i.contactEmail ? (emailToId.get(i.contactEmail.toLowerCase()) ?? null) : null;
    const { score, rationale } = scoreInboxItem({
      channel,
      direction,
      occurredAt: i.occurredAt,
      hasContact: contactId != null
    });

    rows.push({
      org_id: target.orgId,
      channel,
      direction,
      external_id: i.externalRef,
      thread_id: i.threadId ?? null,
      reply_to_message_id: i.messageId ?? null,
      contact_id: contactId,
      subject: i.subject ?? null,
      preview: i.summary ?? null,
      score,
      status: 'pending',
      rationale,
      occurred_at: i.occurredAt
    });
  }

  if (rows.length === 0) return 0;

  const writer = admin as unknown as InboxWriter;
  const { data, error } = await writer
    .from('inbox_items')
    .upsert(rows, { onConflict: 'org_id,channel,external_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
