// lib/meetings/meeting-log.server.ts
// Reading the meeting log.
//
// Split from meeting-log.ts so that file stays pure and testable without a
// database. This half is one query: every non-draft meeting the caller can see,
// with its latest report embedded.
//
// The report is embedded rather than fetched per meeting, which is the
// difference between one round trip and fifty-one. And full_transcript is
// deliberately not selected: it is tens of kilobytes per meeting, the log never
// shows it, and reading it here would mean pulling megabytes to draw a list.

import type { createServerClient } from "@/lib/supabase/server";
import type { MeetingLogReport, MeetingLogSource } from "@/lib/meetings/meeting-log";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

/**
 * How far back the log reaches in one load.
 *
 * Generous, because the whole point is that an old meeting is still there. If
 * an organization ever runs past this, the answer is paging rather than a
 * bigger number.
 */
export const MEETING_LOG_LIMIT = 200;

// Written out rather than assembled: supabase-js parses the select string at
// the type level to check the columns exist, and a string it cannot read as a
// literal takes those checks with it.
const LOG_SELECT = "id, room_code, title, host_id, created_at, started_at, ended_at, scheduled_at, duration_minutes, status, attendees, is_draft, live_meeting_reports(summary, key_points, action_items, analysis, created_at)";

export interface MeetingLogRow {
  meeting: MeetingLogSource & { is_draft: boolean | null };
  report: MeetingLogReport | null;
  /**
   * Whether the caller was in this meeting — hosted it, or has an attendance
   * row for it. This is the same rule the live_meeting_reports RLS policy
   * applies, mirrored here so the log can say "attendees only" rather than
   * present a report it cannot read as one that does not exist.
   */
  attended: boolean;
  /** Whether the caller hosted it — the gate on regenerating its report. */
  isHost: boolean;
}

/**
 * Every meeting in the organization, newest first, with its latest report.
 *
 * Returns meetings whether or not a report exists — a meeting that ended
 * without one is still something that happened, and a log that hid it would be
 * lying about the record by omission.
 */
export async function loadMeetingLog(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  limit: number = MEETING_LOG_LIMIT,
): Promise<MeetingLogRow[]> {
  // Two independent reads, so both go out at once. The attendance read is
  // narrow — one column, already indexed on user_id — and it is what turns an
  // unreadable report into an explained one.
  const [{ data }, { data: attendance }] = await Promise.all([
    supabase
      .from("live_meetings")
      .select(LOG_SELECT)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("created_at", { ascending: false, referencedTable: "live_meeting_reports" })
      .limit(1, { referencedTable: "live_meeting_reports" })
      .limit(limit),
    supabase
      .from("live_meeting_participants")
      .select("meeting_id")
      .eq("user_id", userId),
  ]);

  const attendedIds = new Set(
    (attendance ?? []).map((row: { meeting_id: string }) => row.meeting_id),
  );

  return (data ?? []).map((row) => {
    const embedded = (row as { live_meeting_reports?: unknown }).live_meeting_reports;
    const report = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | { summary?: unknown; key_points?: unknown; action_items?: unknown; analysis?: unknown }
      | undefined;

    return {
      meeting: {
        id: row.id as string,
        room_code: row.room_code as string,
        title: (row.title as string | null) ?? null,
        created_at: row.created_at as string,
        started_at: (row.started_at as string | null) ?? null,
        ended_at: (row.ended_at as string | null) ?? null,
        scheduled_at: (row.scheduled_at as string | null) ?? null,
        duration_minutes: (row.duration_minutes as number | null) ?? null,
        status: (row.status as string | null) ?? null,
        attendees: row.attendees,
        is_draft: (row.is_draft as boolean | null) ?? null,
      },
      attended: attendedIds.has(row.id as string) || (row.host_id as string | null) === userId,
      isHost: (row.host_id as string | null) === userId,
      report: report
        ? {
            summary: (report.summary as string | null) ?? null,
            key_points: report.key_points ?? null,
            action_items: report.action_items ?? null,
            analysis: (report.analysis as Record<string, unknown> | null) ?? null,
          }
        : null,
    };
  });
}
