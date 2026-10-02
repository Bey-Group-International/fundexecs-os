// lib/crm/contact-report.server.ts
// Reading everything a contact's communications report is built from.
//
// The link between a person and their conversations is already precomputed:
// the inbox and meeting writers put one network_activities row per thread and
// per meeting on the contact's timeline (lib/inbox/crm-activity*,
// lib/meetings/crm-activity*), keyed by the generated thread_id / meeting_id
// columns, and somebody can add one by hand (app/api/network/contacts/[id]/links).
// That timeline is the index this report reads, so the report never re-derives
// who a conversation was with.
//
// One addition to it: threads whose counterparty address IS the contact's but
// that predate the contact being in the CRM have no timeline row — the writer
// only links at ingest. Those are found directly on the indexed
// counterparty_email_lower column, so a contact created today still gets a
// report with the history the inbox already had.
//
// Two waves of parallel, indexed reads; no model calls. Through the CALLER's
// client, so RLS decides what the reader may see: a private contact 404s, a
// meeting report the reader was not in comes back empty, and the document says
// so rather than leaking it.

import { normalizeEmail } from "@/lib/crm/contact-match";
import { normalizeNoteList } from "@/lib/meetings/live-notes";
import { reportActionItems } from "@/lib/meetings/action-item-source";
import type {
  ContactReportInput,
  ContactReportMeeting,
  ContactReportMessage,
  ContactReportThread,
} from "@/lib/crm/contact-report";

/** Bounds on every read, so a ten-year relationship is still one quick report. */
export const LINK_READ_LIMIT = 500;
export const THREAD_LIMIT = 200;
export const MEETING_LIMIT = 100;
export const MESSAGE_READ_LIMIT = 2_000;

interface Result<T> {
  data: T | null;
  error: { message: string } | null;
}
type Client = { from: (table: string) => any };

const THREAD_SELECT =
  "id, channel, subject, status, unread, ai_summary, preview, last_message_at";

type ThreadRow = {
  id: string;
  channel: string;
  subject: string | null;
  status: string;
  unread: boolean | null;
  ai_summary: string | null;
  preview: string | null;
  last_message_at: string | null;
};

type MeetingRow = {
  id: string;
  room_code: string | null;
  title: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  created_at: string | null;
  live_meeting_reports?: unknown;
};

export interface LoadedContactReport extends ContactReportInput {
  contactId: string;
}

/**
 * The contact and everything linked to them, or null when there is no such
 * contact or the caller cannot see it.
 */
export async function loadContactReport(
  client: Client,
  input: { orgId: string; contactId: string; includeMessages?: boolean; now?: Date },
): Promise<LoadedContactReport | null> {
  const { orgId, contactId } = input;

  const contactRes: Result<{
    id: string;
    full_name: string | null;
    email: string | null;
    title: string | null;
    company: string | null;
    stage: string | null;
    last_activity_at: string | null;
  }> = await client
    .from("network_contacts")
    .select("id, full_name, email, title, company, stage, last_activity_at")
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();
  if (contactRes.error) throw new Error(contactRes.error.message);
  const contact = contactRes.data;
  if (!contact) return null;

  const email = normalizeEmail(contact.email);

  // Wave 1: the timeline's links, the corrections against it, and the threads
  // on the contact's own address.
  const [linksRes, correctedRes, byAddressRes] = (await Promise.all([
    client
      .from("network_activities")
      .select("thread_id, meeting_id, is_system")
      .eq("organization_id", orgId)
      .eq("contact_id", contactId)
      // A corrected entry is about somebody else; its conversation is not theirs.
      .is("misattributed_at", null)
      .or("thread_id.not.is.null,meeting_id.not.is.null")
      .order("occurred_at", { ascending: false })
      .limit(LINK_READ_LIMIT),
    client
      .from("network_activities")
      .select("thread_id")
      .eq("organization_id", orgId)
      .eq("contact_id", contactId)
      .not("misattributed_at", "is", null)
      .not("thread_id", "is", null)
      .limit(LINK_READ_LIMIT),
    email
      ? client
          .from("inbox_threads")
          .select(THREAD_SELECT)
          .eq("organization_id", orgId)
          .eq("counterparty_email_lower", email)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(THREAD_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ])) as [
    Result<Array<{ thread_id: string | null; meeting_id: string | null; is_system: boolean }>>,
    Result<Array<{ thread_id: string | null }>>,
    Result<ThreadRow[]>,
  ];
  if (linksRes.error) throw new Error(linksRes.error.message);
  if (byAddressRes.error) throw new Error(byAddressRes.error.message);

  const links = linksRes.data ?? [];
  // A hand-made link (is_system false) is recorded as such on the document.
  const manualThreads = new Set(links.filter((l) => l.thread_id && !l.is_system).map((l) => l.thread_id!));
  const manualMeetings = new Set(links.filter((l) => l.meeting_id && !l.is_system).map((l) => l.meeting_id!));

  // Corrected links win over the address match: somebody established that
  // thread is not this person's, and the address read must not put it back.
  const corrected = new Set((correctedRes.data ?? []).map((r) => r.thread_id).filter(Boolean) as string[]);

  const threadById = new Map<string, ThreadRow>();
  for (const t of byAddressRes.data ?? []) if (!corrected.has(t.id)) threadById.set(t.id, t);

  const missingThreadIds = [
    ...new Set(links.map((l) => l.thread_id).filter((id): id is string => Boolean(id))),
  ].filter((id) => !threadById.has(id));
  const meetingIds = [
    ...new Set(links.map((l) => l.meeting_id).filter((id): id is string => Boolean(id))),
  ].slice(0, MEETING_LIMIT);

  // Wave 2: the linked threads the address read did not cover, and the meetings
  // with their latest report embedded (one request, not one per meeting).
  const [moreThreadsRes, meetingsRes] = (await Promise.all([
    missingThreadIds.length
      ? client
          .from("inbox_threads")
          .select(THREAD_SELECT)
          .eq("organization_id", orgId)
          .in("id", missingThreadIds.slice(0, THREAD_LIMIT))
      : Promise.resolve({ data: [], error: null }),
    meetingIds.length
      ? client
          .from("live_meetings")
          .select(
            "id, room_code, title, scheduled_at, started_at, created_at, live_meeting_reports(summary, action_items, analysis, created_at)",
          )
          .eq("organization_id", orgId)
          .in("id", meetingIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false, referencedTable: "live_meeting_reports" })
          .limit(1, { referencedTable: "live_meeting_reports" })
      : Promise.resolve({ data: [], error: null }),
  ])) as [Result<ThreadRow[]>, Result<MeetingRow[]>];
  if (moreThreadsRes.error) throw new Error(moreThreadsRes.error.message);
  if (meetingsRes.error) throw new Error(meetingsRes.error.message);
  for (const t of moreThreadsRes.data ?? []) threadById.set(t.id, t);

  const threadRows = [...threadById.values()]
    .sort((a, b) => ((a.last_message_at ?? "") < (b.last_message_at ?? "") ? 1 : -1))
    .slice(0, THREAD_LIMIT);

  // Only when asked: the messages are the heaviest read here by far.
  const messagesByThread = new Map<string, ContactReportMessage[]>();
  if (input.includeMessages && threadRows.length) {
    const msgRes: Result<
      Array<{ thread_id: string; direction: string; author: string | null; body: string | null; occurred_at: string }>
    > = await client
      .from("inbox_messages")
      .select("thread_id, direction, author, body, occurred_at")
      .in(
        "thread_id",
        threadRows.map((t) => t.id),
      )
      .order("occurred_at", { ascending: false })
      .limit(MESSAGE_READ_LIMIT);
    if (msgRes.error) throw new Error(msgRes.error.message);
    // Read newest first so the limit drops the oldest; stored oldest first.
    for (const m of [...(msgRes.data ?? [])].reverse()) {
      const list = messagesByThread.get(m.thread_id) ?? [];
      list.push({ direction: m.direction, author: m.author, body: m.body ?? "", occurredAt: m.occurred_at });
      messagesByThread.set(m.thread_id, list);
    }
  }

  const threads: ContactReportThread[] = threadRows.map((t) => ({
    id: t.id,
    channel: t.channel,
    subject: t.subject,
    summary: (t.ai_summary ?? "").trim() || (t.preview ?? "").trim() || null,
    status: t.status,
    unread: t.unread === true,
    lastMessageAt: t.last_message_at,
    linkedBy: manualThreads.has(t.id) ? "manual" : "address",
    ...(input.includeMessages ? { messages: messagesByThread.get(t.id) ?? [] } : {}),
  }));

  const meetings: ContactReportMeeting[] = (meetingsRes.data ?? []).map((m) => {
    const embedded = m.live_meeting_reports;
    const report = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | { summary?: unknown; action_items?: unknown; analysis?: unknown }
      | undefined;
    const analysis = (report?.analysis as Record<string, unknown> | null) ?? null;
    return {
      id: m.id,
      roomCode: m.room_code,
      title: m.title,
      at: m.started_at ?? m.scheduled_at ?? m.created_at,
      summary: typeof report?.summary === "string" ? report.summary : null,
      decisions: report ? normalizeNoteList(analysis?.decisions) : [],
      actionItems: report ? reportActionItems(report.action_items, analysis) : [],
      hasReport: Boolean(report),
      linkedBy: manualMeetings.has(m.id) ? "manual" : "address",
    };
  });

  return {
    contactId,
    contact: {
      fullName: contact.full_name ?? "",
      email: contact.email,
      title: contact.title,
      company: contact.company,
      stage: contact.stage,
      lastActivityAt: contact.last_activity_at,
    },
    threads,
    meetings,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
