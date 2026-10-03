// lib/meetings/follow-up-threads.server.ts
// A meeting's follow-up email, as the inbox conversation it starts.
//
// The follow-up route sends one personalised email per attendee and, until
// this, kept no record of it anywhere but the sender's Sent folder: the inbox
// never saw the email, and the replies — the part that actually moves a deal —
// arrived somewhere the product could not read. Now each successful send is:
//
//   1. an outbound message on an inbox thread with that attendee, keyed exactly
//      the way inbound mail is keyed (counterparty + normalised subject), and
//      linked to the meeting (inbox_threads.meeting_id). A reply — "Re:
//      Follow-up: <title>" from the attendee — therefore lands on the same
//      thread whichever route it comes in by;
//   2. when it went out from the host's OWN mailbox, a tracked_mail_threads row
//      for Gmail's thread id, so the tracked-thread sweep reads that one thread
//      back for replies. Mail sent from the org mailbox needs no tracking: the
//      org mailbox sweep already reads it.
//
// Never throws. The emails have gone; failing to record them must not turn a
// sent follow-up into an error for the host.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { SendEmailResult } from "@/lib/email";
import { ingestInboundEvent } from "@/lib/integrations/inbound/ingest";
import { normalizeSubject } from "@/lib/integrations/inbound/resend";
import { normalizeEmail } from "@/lib/crm/contact-match";

type Client = SupabaseClient<Database>;

/** The ingest_log channel follow-up sends are claimed under. */
export const FOLLOW_UP_CHANNEL = "meeting_followup";

export interface FollowUpSend {
  recipient: { name: string; email: string };
  /** The text this recipient was sent, after personalisation. */
  body: string;
  result: PromiseSettledResult<SendEmailResult>;
}

export interface RecordFollowUpInput {
  orgId: string;
  meetingId: string;
  hostId: string;
  hostName: string | null;
  subject: string;
  /** Which mailbox the sends went out from, as mailboxFor reported it. */
  mailbox: { source: "member" | "organization"; email: string | null };
  sends: FollowUpSend[];
  now?: Date;
}

export interface RecordFollowUpResult {
  recorded: number;
  tracked: number;
}

/** The inbox thread key a conversation with this address about this subject lives under. */
export function followUpThreadKey(email: string, subject: string): string {
  return `email:${normalizeEmail(email)}:${normalizeSubject(subject)}`;
}

export async function recordFollowUpThreads(
  client: Client,
  input: RecordFollowUpInput,
): Promise<RecordFollowUpResult> {
  const out: RecordFollowUpResult = { recorded: 0, tracked: 0 };
  const occurredAt = (input.now ?? new Date()).toISOString();

  for (const send of input.sends) {
    if (send.result.status !== "fulfilled" || !send.result.value.ok) continue;
    const email = normalizeEmail(send.recipient.email);
    if (!email) continue;
    const sent = send.result.value;

    try {
      const ingested = await ingestInboundEvent(client, input.orgId, FOLLOW_UP_CHANNEL, {
        eventType: "meeting.follow_up_sent",
        // Gmail's id when it gave one: unique, and the same id the sweep would see.
        eventId: `followup:${input.meetingId}:${email}:${sent.gmailMessageId ?? occurredAt}`,
        thread: {
          channel: "gmail",
          category: "messaging",
          subject: input.subject,
          counterpartyName: send.recipient.name || null,
          counterpartyEmail: email,
          threadKey: followUpThreadKey(email, input.subject),
          meetingId: input.meetingId,
        },
        message: {
          author: input.hostName ?? input.mailbox.email ?? "You",
          body: send.body,
          occurredAt,
          direction: "outbound",
          metadata: {
            via: "meeting_followup",
            meeting_id: input.meetingId,
            gmail_message_id: sent.gmailMessageId ?? null,
            gmail_thread_id: sent.gmailThreadId ?? null,
          },
        },
      });
      if (!ingested.ok) {
        console.warn("[follow-up-threads] record failed", ingested.error);
        continue;
      }
      if (!ingested.duplicate) out.recorded++;

      // Only a member mailbox needs tracking; see the header.
      if (input.mailbox.source === "member" && sent.gmailThreadId && !ingested.duplicate) {
        const { error } = await client.from("tracked_mail_threads").upsert(
          {
            organization_id: input.orgId,
            user_id: input.hostId,
            gmail_thread_id: sent.gmailThreadId,
            inbox_thread_id: ingested.threadId,
            meeting_id: input.meetingId,
            mailbox_email: input.mailbox.email,
          },
          { onConflict: "user_id,gmail_thread_id" },
        );
        if (error) console.warn("[follow-up-threads] tracking failed", error.message);
        else out.tracked++;
      }
    } catch (err) {
      console.warn("[follow-up-threads] record threw", err);
    }
  }
  return out;
}
