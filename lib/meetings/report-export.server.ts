// lib/meetings/report-export.server.ts
// Reading the report an export is about.
//
// Split from report-export.ts so that file can stay pure and tested without a
// database. This half is the query, and it is deliberately the same query the
// report page makes: the latest report row for the meeting with this room
// code, read through whichever client the caller hands in.
//
// Callers pass the user's session client, not the service client. A report is
// then exportable exactly when it is readable, under the RLS the report page
// already obeys — rather than a second access rule that could drift away from
// the first and quietly widen who can download somebody's meeting.

import type { createServerClient } from "@/lib/supabase/server";
import type { ReportExportInput, ReportExportOptions } from "@/lib/meetings/report-export";
import type { PresentPerson } from "@/lib/meetings/recipients";
import { loadPresentPeople } from "@/lib/meetings/recipients.server";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

// The two shapes this reads, spelled out rather than assembled: supabase-js
// parses the select string at the type level to check the columns exist, and a
// string it cannot read as a literal takes those checks with it.
//
// full_transcript is the whole meeting as text — tens of kilobytes for an hour,
// dwarfing every other column put together. Summary-only exports are the common
// case and the email path never wants it either, so reading it unconditionally
// meant fetching all of that and discarding it on almost every call.
//
// The only difference between these two is that column, which a test pins.
const SELECT_SUMMARY = "id, room_code, title, created_at, started_at, ended_at, organization_id, host_id, attendees, kind, recording_consent, live_meeting_reports(summary, key_points, action_items, analysis, created_at)";

const SELECT_WITH_TRANSCRIPT = "id, room_code, title, created_at, started_at, ended_at, organization_id, host_id, attendees, kind, recording_consent, live_meeting_reports(summary, key_points, action_items, analysis, created_at, full_transcript)";

/** Exposed so a test can hold the two in the same place they are written. */
export const REPORT_SELECTS = {
  summary: SELECT_SUMMARY,
  withTranscript: SELECT_WITH_TRANSCRIPT,
} as const;

export interface LoadedReport extends ReportExportInput {
  /** The meeting row id, for callers that need to reach its attendees. */
  meetingId: string;
  organizationId: string | null;
  hostId: string | null;
  roomCode: string;
  attendees: unknown;
  /**
   * Whether the caller was in this meeting — hosted it, or has an attendance
   * row for it.
   *
   * Meetings are readable across the organisation and reports are not, so a
   * co-member who never joined gets the meeting with every report field empty:
   * byte for byte what a report still being generated looks like. Without this
   * the export route answered them 409 "Report not ready" and invited them to
   * keep retrying something they will never be allowed to download.
   */
  attended: boolean;
  /**
   * Everybody who was in the room, with an address where there is one.
   *
   * The reason both email paths spent their lives addressing the invite list:
   * this is the only place the product knows who was actually in an instant
   * meeting, and neither of them was reading it. Empty for a caller who was not
   * there, for the same reason the recording and the chat are null.
   */
  present: PresentPerson[];
  /**
   * Whether a report row exists at all.
   *
   * Distinct from having a summary. The report route writes a row with an empty
   * summary when the model fails and when a one-way call had nothing to
   * transcribe, and that row is FINISHED. The report page was taught to render
   * it rather than spin forever; this is what lets the export agree.
   */
  hasReport: boolean;
  /** 'meeting' or 'one_way'. What kind of session the document describes. */
  kind: string | null;
}

/**
 * The meeting and its most recent report, or null when there is no such
 * meeting or the caller cannot see it.
 *
 * A missing report row is not a missing meeting: it comes back with the report
 * fields empty, so the caller can tell "still generating" from "no such room"
 * and answer each differently.
 */
export async function loadReportForExport(
  supabase: SupabaseClient,
  roomCode: string,
  options: ReportExportOptions & {
    userId?: string | null;
    /** Canonical app URL, so the document's recording link works off-site. */
    origin?: string | null;
  } = {},
): Promise<LoadedReport | null> {
  const includeTranscript = options.includeTranscript === true;

  // One round trip, not two. live_meeting_reports.meeting_id is a foreign key
  // to live_meetings.id, so the latest report embeds in the meeting's own
  // query — and the second request only ever existed because the first had to
  // return the meeting id before it could be made.
  const { data: meeting } = await supabase
    .from("live_meetings")
    .select(includeTranscript ? SELECT_WITH_TRANSCRIPT : SELECT_SUMMARY)
    .eq("room_code", roomCode)
    .order("created_at", { ascending: false, referencedTable: "live_meeting_reports" })
    .limit(1, { referencedTable: "live_meeting_reports" })
    .maybeSingle();

  if (!meeting) return null;

  const userId = options.userId ?? null;
  const hostId = (meeting.host_id as string | null) ?? null;
  let attended = Boolean(userId) && hostId === userId;
  if (userId && !attended) {
    // Only asked when the host check has not already settled it, and only for
    // the one meeting — this is a primary-key-shaped lookup on the unique
    // (meeting_id, user_id) index, not a scan.
    const { data: row } = await supabase
      .from("live_meeting_participants")
      .select("meeting_id")
      .eq("meeting_id", meeting.id as string)
      .eq("user_id", userId)
      .maybeSingle();
    attended = Boolean(row);
  }

  const embedded = (meeting as { live_meeting_reports?: unknown }).live_meeting_reports;
  const report = (Array.isArray(embedded) ? embedded[0] : embedded) as
    | { summary?: unknown; key_points?: unknown; action_items?: unknown; analysis?: unknown; full_transcript?: unknown }
    | undefined;

  // All three gated on attendance. RLS would refuse them anyway, but a caller
  // who is about to be told this report is not theirs has no business costing
  // the queries, and reading what somebody may not have is a habit worth not
  // forming.
  //
  // Together rather than one after another. These were independent reads written
  // as awaited properties of an object literal, which evaluates them in order:
  // every export paid for serial round trips to assemble blocks that have
  // nothing to do with each other.
  const blocks = attended
    ? await Promise.all([
        loadRecordingForExport(supabase, meeting.id as string, options.origin),
        loadChatForExport(supabase, meeting.id as string),
        loadPresentPeople(supabase, meeting.id as string),
      ]).then(([recording, chat, present]) => ({ recording, chat, present }))
    : { recording: null, chat: null, present: [] as PresentPerson[] };

  return {
    meetingId: meeting.id as string,
    roomCode: meeting.room_code as string,
    organizationId: (meeting.organization_id as string | null) ?? null,
    hostId,
    attended,
    attendees: meeting.attendees,
    title: (meeting.title as string | null) ?? null,
    createdAt: (meeting.created_at as string | null) ?? null,
    startedAt: (meeting.started_at as string | null) ?? null,
    endedAt: (meeting.ended_at as string | null) ?? null,
    summary: (report?.summary as string | null) ?? null,
    keyPoints: report?.key_points ?? null,
    actionItems: report?.action_items ?? null,
    analysis: (report?.analysis as Record<string, unknown> | null) ?? null,
    fullTranscript: (report?.full_transcript as string | null) ?? null,
    consent: (meeting as { recording_consent?: unknown }).recording_consent ?? null,
    kind: (meeting as { kind?: string | null }).kind ?? null,
    hasReport: Boolean(report),
    ...blocks,
  };
}

/**
 * The meeting's chat, for the document to carry.
 *
 * Read through the caller's own client, so somebody who may not see the chat
 * does not get it in their export. Never throws: a document is complete
 * without the block, and an export must not fail because a chat lookup did.
 */
async function loadChatForExport(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<ReportExportInput["chat"]> {
  try {
    const { data } = await supabase
      .from("live_meeting_chat")
      .select("author_name, body, ts")
      .eq("meeting_id", meetingId)
      .order("ts", { ascending: true })
      .limit(500);

    const rows = (data ?? []) as Array<{ author_name: string; body: string; ts: string }>;
    return rows.map((row) => ({ author: row.author_name, text: row.body, at: row.ts }));
  } catch (err) {
    console.warn("[report-export] chat lookup failed", err);
    return null;
  }
}

/**
 * The meeting's recording, for the document to name.
 *
 * The newest one that can still be played, read through the caller's own
 * client so a viewer who may not see the recording does not get a link to it
 * in their export. Never throws: an export must not fail because a recording
 * lookup did, and the document is complete without the block.
 */
async function loadRecordingForExport(
  supabase: SupabaseClient,
  meetingId: string,
  origin: string | null | undefined,
): Promise<ReportExportInput["recording"]> {
  if (!origin) return null;
  try {
    const { data } = await supabase
      .from("live_meeting_recordings")
      .select("id, duration_seconds, expires_at, deleted_at, status")
      .eq("meeting_id", meetingId)
      .is("deleted_at", null)
      .neq("status", "abandoned")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const rec = data as
      | { id: string; duration_seconds: number | null; expires_at: string | null }
      | null;
    if (!rec) return null;

    return {
      url: `${origin.replace(/\/$/, "")}/api/meetings/${meetingId}/recording/${rec.id}/stream`,
      expiresAt: rec.expires_at,
      durationSeconds: rec.duration_seconds,
    };
  } catch (err) {
    console.warn("[report-export] recording lookup failed", err);
    return null;
  }
}
