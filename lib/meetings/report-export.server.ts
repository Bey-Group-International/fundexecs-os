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
const SELECT_SUMMARY = "id, room_code, title, created_at, started_at, ended_at, organization_id, host_id, attendees, live_meeting_reports(summary, key_points, action_items, analysis, created_at)";

const SELECT_WITH_TRANSCRIPT = "id, room_code, title, created_at, started_at, ended_at, organization_id, host_id, attendees, live_meeting_reports(summary, key_points, action_items, analysis, created_at, full_transcript)";

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
  options: ReportExportOptions & { userId?: string | null } = {},
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
  };
}
