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
// `has_transcript` is selected in its place — a generated boolean saying
// whether that text exists, which is all the log needs to decide whether to
// offer "Regenerate from transcript".

import type { createServerClient } from "@/lib/supabase/server";
import type { MeetingLogReport, MeetingLogSource } from "@/lib/meetings/meeting-log";
import { MEETING_KIND } from "@/lib/meetings/one-way";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

/**
 * How far back the log reaches in one load.
 *
 * Generous, because the whole point is that an old meeting is still there. If
 * an organization ever runs past this, the answer is paging rather than a
 * bigger number.
 */
export const MEETING_LOG_LIMIT = 200;

/** Meeting ids per attendance lookup; they travel in the request URL. */
const ATTENDANCE_BATCH = 100;

// Written out rather than assembled: supabase-js parses the select string at
// the type level to check the columns exist, and a string it cannot read as a
// literal takes those checks with it.
const LOG_SELECT = "id, room_code, title, host_id, created_at, started_at, ended_at, scheduled_at, duration_minutes, status, attendees, is_draft, live_meeting_reports(summary, key_points, action_items, analysis, has_transcript, created_at)";

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
  const { data } = await supabase
    .from("live_meetings")
    .select(LOG_SELECT)
    .eq("organization_id", orgId)
    // Meetings only. A recorded call is a live_meetings row — it has to be,
    // for its recording to be reachable and cleaned up — but it is not a
    // meeting anybody held, and the log is a record of meetings. The call
    // archive lists them.
    .eq("kind", MEETING_KIND)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("created_at", { ascending: false, referencedTable: "live_meeting_reports" })
    .limit(1, { referencedTable: "live_meeting_reports" })
    .limit(limit);

  // Attendance for just these meetings. It used to read every attendance row
  // the user had ever had, which grows by one per meeting for the life of the
  // account — and past PostgREST's 1000-row cap was silently cut, so a heavy
  // user's older meetings in the log read as ones they did not attend. It is
  // what turns an unreadable report into an explained one, so it has to be
  // right for exactly the rows on the page.
  //
  // In batches, read together: an id list goes in the URL, and two hundred
  // UUIDs in one filter is close to what a proxy will accept in a request line.
  const ids = (data ?? []).map((row) => (row as { id: string }).id);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ATTENDANCE_BATCH) batches.push(ids.slice(i, i + ATTENDANCE_BATCH));
  const attendance = await Promise.all(
    batches.map((batch) =>
      supabase
        .from("live_meeting_participants")
        .select("meeting_id")
        .eq("user_id", userId)
        .in("meeting_id", batch),
    ),
  );

  const attendedIds = new Set(
    attendance.flatMap(({ data: rows }) => (rows ?? []).map((row: { meeting_id: string }) => row.meeting_id)),
  );

  return (data ?? []).map((row) => {
    const embedded = (row as { live_meeting_reports?: unknown }).live_meeting_reports;
    const report = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | {
          summary?: unknown;
          key_points?: unknown;
          action_items?: unknown;
          analysis?: unknown;
          has_transcript?: unknown;
        }
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
            // Strictly `=== true`. A row read before the column existed, or
            // through a select that omitted it, must not be taken as having a
            // transcript: the log would offer a button that answers 409.
            has_transcript: report.has_transcript === true,
          }
        : null,
    };
  });
}
