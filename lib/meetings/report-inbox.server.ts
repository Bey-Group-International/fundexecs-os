// lib/meetings/report-inbox.server.ts
// Reading the inbox history the report page shows beside a meeting.
//
// Deliberately NOT folded into loadReportPage. That loader is two waves and its
// second wave already needs the meeting's id; the addresses this read is keyed on
// come out of the attendance rows, which are IN that second wave — so folding
// this in would make a third wave and put a whole extra round trip in front of
// the report document itself. A report is a document; it should not wait on a
// sidebar.
//
// So this is its own load, rendered inside a Suspense boundary. The report
// streams first and the history arrives when it arrives.
//
// Read through the CALLER's client, never the service one: RLS on inbox_threads
// is what decides that an organisation's correspondence belongs to its own
// members. A meeting's report is visible to everyone who was in the room, and
// that is a wider set than the organisation — a guest attendee reading this
// report gets an empty history because RLS gives them nothing, which is the
// correct answer and not one this module has to compute.
//
// Never throws. The report is the page; a failed sidebar read shows no sidebar.
import { logId } from "@/lib/log-safe";
import type { createServerClient } from "@/lib/supabase/server";
import { meetingRecipients } from "@/lib/meetings/recipients";
import { loadPresentPeople } from "@/lib/meetings/recipients.server";
import {
  attendeeInboxHistory,
  historyAddresses,
  type InboxThreadRow,
  type ReportInboxHistory,
} from "@/lib/meetings/report-inbox";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

/**
 * How many threads one read will take back, across every attendee.
 *
 * Per-attendee bounding happens in the pure rule, but the READ has to be bounded
 * too or a meeting with twelve long-standing counterparties pulls their whole
 * correspondence over the wire to show sixty rows of it. Ordered newest first, so
 * what the ceiling cuts is the oldest threads of the busiest attendee — which is
 * what the per-attendee bound was going to drop anyway.
 */
export const THREAD_READ_LIMIT = 200;

/** Empty, and the shape a caller can render without checking anything. */
const NOTHING: ReportInboxHistory = { attendees: [], untouched: [], capped: false };

/**
 * What the inbox holds on the people who were in this meeting.
 *
 * `viewerEmail` is left out of the result the same way it is left out of the
 * meeting's email: a panel telling the reader where they are with themselves is
 * noise on every report.
 */
export async function loadAttendeeInboxHistory(
  supabase: SupabaseClient,
  input: {
    meetingId: string;
    organizationId: string | null;
    /** `live_meetings.attendees`, as stored. */
    invited: unknown;
    viewerEmail?: string | null;
  },
): Promise<ReportInboxHistory> {
  // No organisation on the meeting means no inbox to scope to. An unscoped read
  // would lean on RLS alone to pick an organisation, and RLS answers "may you
  // see this row", not "is this the right organisation's inbox" — a reader who
  // belongs to two orgs would get the wrong one's correspondence on the page.
  if (!input.organizationId) return NOTHING;

  try {
    const present = await loadPresentPeople(supabase, input.meetingId);
    const audience = meetingRecipients({
      invited: input.invited,
      present,
      senderEmail: input.viewerEmail ?? null,
    });

    const addresses = historyAddresses(audience.recipients);
    if (addresses.length === 0) return NOTHING;

    const { data, error } = await supabase
      .from("inbox_threads")
      .select(
        "id, channel, subject, counterparty_email, status, unread, ai_summary, preview, last_message_at, meeting_id",
      )
      .eq("organization_id", input.organizationId)
      // The generated lowercase column (migration 20260930180000), not the raw
      // one: providers send addresses capitalised, `historyAddresses` lowercases,
      // and comparing those two directly would silently miss every thread whose
      // address arrived as "Ana@Acme.com" — and miss the index with it.
      .in("counterparty_email_lower", addresses)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(THREAD_READ_LIMIT);

    if (error) {
      console.warn("[report-inbox] thread lookup failed", error.message);
      return NOTHING;
    }

    const threads = (data ?? []) as unknown as InboxThreadRow[];
    const history = attendeeInboxHistory({
      recipients: audience.recipients,
      threads,
      meetingId: input.meetingId,
    });

    // The ceiling is shared across every attendee, so one counterparty with a long
    // history can fill it and push another attendee's threads out of the result —
    // leaving somebody the organisation talks to every week looking like somebody
    // it has never written to.
    //
    // An earlier version logged this and rendered the list anyway, under a comment
    // saying a quietly wrong count is worse than a missing one. The log was not the
    // fix; this is. Per-attendee totals are undercounts past the ceiling too, but an
    // undercount shows its own bound ("3 more in the inbox") whereas "no inbox
    // history" is a confident claim about absence, so only the latter is withheld.
    if (threads.length >= THREAD_READ_LIMIT) {
      console.warn("[report-inbox] thread read hit the ceiling", {
        meetingId: logId(input.meetingId),
        limit: THREAD_READ_LIMIT,
      });
      return { ...history, untouched: [], capped: true };
    }

    return history;
  } catch (err) {
    console.warn("[report-inbox] history load threw", err);
    return NOTHING;
  }
}
