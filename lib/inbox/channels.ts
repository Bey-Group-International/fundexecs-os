/* ============================================================================
 * lib/inbox/channels.ts — client-safe inbox channel types + constants.
 *
 * Shared by the server read surface (lib/queries/inbox.ts, which is
 * `server-only`) and the client InboxList. Keeping these here — with no server
 * imports — lets the client bundle reference the channel constants and the
 * InboxItem shape without dragging in `server-only` Supabase code.
 * ========================================================================= */

/** Communications channels the inbox can surface. */
export type InboxChannel = 'email' | 'slack' | 'call' | 'linkedin' | 'sms' | 'webinar';

export type InboxStatus = 'pending' | 'accepted' | 'dismissed' | 'sent' | 'snoozed';

/** Channels with a live ingest path today vs. catalogued for soon. */
export const WIRED_CHANNELS: InboxChannel[] = ['email', 'slack', 'call'];
export const COMING_SOON_CHANNELS: InboxChannel[] = ['linkedin', 'sms'];

/** A deal candidate offered when routing an accepted conversation onto a deal. */
export interface InboxDealOption {
  id: string;
  name: string;
  stage: string;
  status: string;
}

export interface InboxItem {
  id: string;
  channel: InboxChannel;
  direction: 'inbound' | 'outbound';
  /** Provider id / room name — for 'call' items this is the LiveKit room. */
  externalId: string | null;
  threadId: string | null;
  contactId: string | null;
  dealId: string | null;
  subject: string;
  preview: string;
  /** Earn's drafted reply, when one has been generated (P3). */
  draftReply: string | null;
  score: number;
  status: InboxStatus;
  /** [{ factor, weight, detail }] — same shape as `matches.rationale`. */
  rationale: Record<string, unknown>[];
  occurredAt: string | null;
  createdAt: string;
  actedAt: string | null;
}
