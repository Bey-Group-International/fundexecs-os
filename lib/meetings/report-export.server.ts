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
import type { ReportExportInput } from "@/lib/meetings/report-export";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

export interface LoadedReport extends ReportExportInput {
  /** The meeting row id, for callers that need to reach its attendees. */
  meetingId: string;
  organizationId: string | null;
  hostId: string | null;
  roomCode: string;
  attendees: unknown;
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
): Promise<LoadedReport | null> {
  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, room_code, title, created_at, started_at, ended_at, organization_id, host_id, attendees")
    .eq("room_code", roomCode)
    .maybeSingle();

  if (!meeting) return null;

  const { data: report } = await supabase
    .from("live_meeting_reports")
    .select("summary, key_points, action_items, analysis, full_transcript")
    .eq("meeting_id", meeting.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    meetingId: meeting.id as string,
    roomCode: meeting.room_code as string,
    organizationId: (meeting.organization_id as string | null) ?? null,
    hostId: (meeting.host_id as string | null) ?? null,
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
