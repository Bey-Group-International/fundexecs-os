// lib/meetings/crm-activity.server.ts
// Putting a finished meeting on the CRM records of the people who were in it.
//
// The rules — who matches, what the entry says, when it happened — are all in
// crm-activity.ts and tested there. This file does the three things that need a
// database: find out who was actually in the room, look up which of those
// addresses the CRM knows, and write the rows.
//
// Never throws. A meeting's report, its institutional record and its action-item
// tasks are what the host is waiting on; a CRM timeline entry that cannot be
// written must not take any of that down with it. Every failure is logged and
// returned as a count of zero.

import { SITE_URL } from "@/lib/site";
import { loadPresentPeople } from "@/lib/meetings/recipients.server";
import {
  meetingActivities,
  normalizeEmail,
  type CrmMeetingActivity,
  type CrmMeetingInput,
} from "@/lib/meetings/crm-activity";

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/**
 * The shape of the query builder, spelled out rather than typed `any`.
 *
 * Only the methods this file calls, so a test can hand in a fake without
 * reproducing the whole Supabase surface — and so a typo in a chain is caught
 * here rather than at runtime against a real database.
 */
interface Builder extends PromiseLike<QueryResult<Array<Record<string, unknown>>>> {
  select: (columns: string) => Builder;
  eq: (column: string, value: unknown) => Builder;
  in: (column: string, values: readonly string[]) => Builder;
  limit: (n: number) => Builder;
  maybeSingle: () => PromiseLike<QueryResult<Record<string, unknown>>>;
  upsert: (rows: unknown[], options: { onConflict: string }) => PromiseLike<QueryResult<unknown>>;
}

type Client = { from: (table: string) => Builder };

/**
 * Addresses looked up in one query rather than one per attendee.
 *
 * A meeting can have two hundred people in it (PRESENT_LIMIT), and a lookup per
 * person would be two hundred round trips on the path a host is watching a
 * spinner on.
 */
const CONTACT_LOOKUP_LIMIT = 400;

/**
 * The conflict target, matching network_activities_meeting_contact_uniq.
 *
 * Exported so a test can assert the shape PostgREST actually accepts — plain
 * column names — rather than merely comparing it against whatever this file
 * happens to say.
 */
export const MEETING_CONFLICT_TARGET = "organization_id,contact_id,meeting_id";

export interface MeetingForCrm {
  id: string;
  organizationId: string | null;
  roomCode: string | null;
  title: string | null;
  startedAt: string | null;
  scheduledAt: string | null;
  /** The invite list, as stored on live_meetings.attendees. */
  attendees: unknown;
  hostEmail: string | null;
}

export interface RecordMeetingResult {
  /** Rows written. Zero is an ordinary outcome: nobody in the CRM was there. */
  written: number;
  /** Set when something went wrong; the caller carries on regardless. */
  failed: boolean;
}

/**
 * Log this meeting against every contact who was in it.
 *
 * `report` is null when the meeting closed without an analysis — a real and
 * ordinary outcome, and one the record should still show. The row it writes is
 * replaced, not duplicated, if a report arrives later: both go through the same
 * upsert key.
 */
export async function recordMeetingOnTimelines(
  client: Client,
  input: {
    meeting: MeetingForCrm;
    /** The principal ending the meeting, recorded as the entry's actor. */
    actorId: string | null;
    endedAt: string;
    durationMinutes: number | null;
    report: CrmMeetingInput["report"];
  },
): Promise<RecordMeetingResult> {
  const orgId = input.meeting.organizationId;
  // Activities are scoped to an organisation by a NOT NULL column. A meeting
  // with no organisation has no CRM to be written to, which is not a failure.
  if (!orgId) return { written: 0, failed: false };

  try {
    const invited = inviteList(input.meeting.attendees);

    const [present, fromBookingLink] = await Promise.all([
      // Already the attendance resolver for exports and emails: it handles
      // guests, the row ceiling and the NULL-distinct rejoin case, and never
      // throws. Cast because it asks for the full client and this file's Builder
      // is deliberately narrower.
      loadPresentPeople(client as never, input.meeting.id),
      cameFromBookingLink(client, input.meeting.id),
    ]);

    const attendedEmails = present
      .map((p) => normalizeEmail(p.email))
      .filter((e): e is string => e !== "");

    // Only the addresses this meeting actually knows about are looked up, so the
    // query is bounded by the meeting rather than by the size of the CRM.
    const addresses = [...new Set([...invited.map((p) => normalizeEmail(p.email)), ...attendedEmails])]
      .filter((e) => e !== "")
      .slice(0, CONTACT_LOOKUP_LIMIT);
    if (addresses.length === 0) return { written: 0, failed: false };

    const contactsByEmail = await contactIndex(client, orgId, addresses);
    if (contactsByEmail.size === 0) return { written: 0, failed: false };

    const rows = meetingActivities({
      meeting: {
        id: input.meeting.id,
        roomCode: input.meeting.roomCode,
        title: input.meeting.title,
        startedAt: input.meeting.startedAt,
        scheduledAt: input.meeting.scheduledAt,
        endedAt: input.endedAt,
        durationMinutes: input.durationMinutes,
        hostEmail: input.meeting.hostEmail,
        fromBookingLink,
      },
      invited,
      attendedEmails,
      contactsByEmail,
      report: input.report,
      siteUrl: SITE_URL,
    });
    if (rows.length === 0) return { written: 0, failed: false };

    return await writeRows(client, orgId, input.actorId, rows);
  } catch (err) {
    console.error("[crm-activity] recording meeting on timelines", err);
    return { written: 0, failed: true };
  }
}

/**
 * The invite list, defensively.
 *
 * `live_meetings.attendees` is a jsonb column written by several paths over the
 * life of this product, so it is read as unknown and narrowed here rather than
 * cast. A malformed row costs that one attendee, not the whole write.
 */
export function inviteList(value: unknown): Array<{ name?: string | null; email?: string | null }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ name?: string | null; email?: string | null }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { name?: unknown; email?: unknown };
    out.push({
      name: typeof row.name === "string" ? row.name : null,
      email: typeof row.email === "string" ? row.email : null,
    });
  }
  return out;
}

/**
 * Whether a public scheduling link produced this meeting, which is the
 * difference between `inbound` and `outbound` on the entry.
 *
 * The link is held on the booking, not the meeting — `live_meetings.source` is
 * "fundexecs" either way — so it takes a lookup. One indexed read, run alongside
 * the attendance one, and a failure reads as "not from a link" rather than
 * failing the write.
 */
async function cameFromBookingLink(client: Client, meetingId: string): Promise<boolean> {
  try {
    const { data } = await client
      .from("scheduling_bookings")
      .select("id")
      .eq("meeting_id", meetingId)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

/** Lowercased address → contact id, for the addresses this meeting knows. */
async function contactIndex(
  client: Client,
  orgId: string,
  addresses: string[],
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  // `email_lower`, not `email`. Addresses are lowercased on the way in, and
  // network_contacts.email holds whatever case it was given — there is an index
  // on lower(email) precisely because of that. Comparing against the raw column
  // would miss every contact stored capitalised, which is a miss that reads
  // exactly like "they are not in the CRM".
  const { data, error } = await client
    .from("network_contacts")
    .select("id, email_lower")
    .eq("organization_id", orgId)
    .in("email_lower", addresses);

  if (error) {
    console.warn("[crm-activity] contact lookup failed", error.message);
    return index;
  }

  for (const row of (data ?? []) as Array<{ id: string; email_lower: string | null }>) {
    const email = normalizeEmail(row.email_lower);
    // First writer wins, so two contacts sharing an address resolve stably
    // rather than by row order.
    if (email && !index.has(email)) index.set(email, row.id);
  }
  return index;
}

/**
 * The rows, upserted on the index that makes this idempotent.
 *
 * Three REAL columns, which is all PostgREST's on_conflict can carry: it takes a
 * comma-separated list of column names, not expressions, and cannot send the
 * WHERE predicate a partial index would need to be inferred. An earlier version
 * of this named `(metadata->>'meeting_id')` and would have failed on every call
 * with "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification" — silently, because this function logs and carries on, so no
 * meeting would ever have reached a timeline. `meeting_id` is a generated column
 * over that same metadata, so there is still one source of truth.
 *
 * A regenerate therefore corrects the entry it wrote last time — the better
 * summary reaches the timeline — instead of adding a second copy of one meeting
 * to somebody's record.
 */
async function writeRows(
  client: Client,
  orgId: string,
  actorId: string | null,
  rows: CrmMeetingActivity[],
): Promise<RecordMeetingResult> {
  const payload = rows.map((row) => ({
    organization_id: orgId,
    contact_id: row.contactId,
    actor_id: actorId,
    activity_type: row.activityType,
    direction: row.direction,
    subject: row.subject,
    body: row.body,
    occurred_at: row.occurredAt,
    is_system: row.isSystem,
    metadata: row.metadata,
  }));

  const { error } = await client
    .from("network_activities")
    .upsert(payload, { onConflict: MEETING_CONFLICT_TARGET });

  if (error) {
    console.error("[crm-activity] timeline write failed", error.message);
    return { written: 0, failed: true };
  }
  return { written: payload.length, failed: false };
}
