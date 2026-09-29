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
import { hitScanBound, narrowArchive } from "@/lib/meetings/session-archive.server";
import {
  SEARCH_SCAN,
  searchSession,
  type SessionHit,
  type SessionMetadata,
} from "@/lib/meetings/session-archive";
import { belongsInLog, toLogEntry } from "@/lib/meetings/meeting-log";

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

// The same columns plus the transcript, for a search. Written out separately
// rather than assembled for the reason above: supabase-js checks these columns
// at the type level only while it can read the string as a literal.
//
// Up to 120,000 characters a row, so this is never used for a plain list — that
// is the difference between drawing a page and moving megabytes to draw it.
const LOG_SEARCH_SELECT = "id, room_code, title, host_id, created_at, started_at, ended_at, scheduled_at, duration_minutes, status, attendees, is_draft, live_meeting_reports(summary, key_points, action_items, analysis, has_transcript, full_transcript, created_at)";

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
  /**
   * Why this row matched a search, when it came from one.
   *
   * Absent on a plain list. Present on a search so a row can show the sentence
   * the hit was in — which is the half of "why is this here" that a title and a
   * date cannot answer.
   */
  hit?: Pick<SessionHit, "reason" | "matches" | "snippet">;
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
  // Narrowed through the shared clauses: kind, deleted_at, newest first, and the
  // report embed's own order — which is the one that matters, because a
  // regenerated report INSERTS a row and an unordered embed hands back an
  // arbitrary one. See session-archive.server.ts.
  //
  // Meetings only. A recorded call is a live_meetings row — it has to be, for
  // its recording to be reachable and cleaned up — but it is not a meeting
  // anybody held, and the log is a record of meetings. The call archive lists
  // those.
  const { data } = await narrowArchive(supabase.from("live_meetings").select(LOG_SELECT), {
    kind: MEETING_KIND,
    visibility: { scope: "org", organizationId: orgId },
    searching: false,
    page: limit,
  });

  // Attendance for just these meetings. It used to read every attendance row
  // the user had ever had, which grows by one per meeting for the life of the
  // account — and past PostgREST's 1000-row cap was silently cut, so a heavy
  // user's older meetings in the log read as ones they did not attend. It is
  // what turns an unreadable report into an explained one, so it has to be
  // right for exactly the rows on the page.
  //
  // In batches, read together: an id list goes in the URL, and two hundred
  // UUIDs in one filter is close to what a proxy will accept in a request line.
  const attendedIds = await attendanceFor(
    supabase,
    userId,
    (data ?? []).map((row) => (row as { id: string }).id),
  );

  return (data ?? []).map((row) => shapeLogRow(row as Record<string, unknown>, userId, attendedIds));
}

/**
 * One raw row, as the log understands it.
 *
 * Extracted so the list and the search shape rows identically. They did not have
 * to before, because only one of them existed; two copies of "which report is the
 * current one" is exactly how a search starts disagreeing with the list it is
 * searching.
 */
function shapeLogRow(
  row: Record<string, unknown>,
  userId: string,
  attendedIds: Set<string>,
): MeetingLogRow {

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
}

/**
 * Which of these meetings the caller was in.
 *
 * Extracted so the list and the search share it rather than each growing its own
 * copy of the batching rule below.
 *
 * It used to read every attendance row the user had ever had, which grows by one
 * per meeting for the life of the account — and past PostgREST's 1000-row cap it
 * was silently cut, so a heavy user's older meetings read as ones they did not
 * attend. It is what turns an unreadable report into an explained one, so it has
 * to be right for exactly the rows on the page.
 *
 * In batches, read together: an id list travels in the request URL, and two
 * hundred UUIDs in one filter is close to what a proxy will accept in a request
 * line.
 */
async function attendanceFor(
  supabase: SupabaseClient,
  userId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ATTENDANCE_BATCH) {
    batches.push(ids.slice(i, i + ATTENDANCE_BATCH));
  }
  const results = await Promise.all(
    batches.map((batch) =>
      supabase
        .from("live_meeting_participants")
        .select("meeting_id")
        .eq("user_id", userId)
        .in("meeting_id", batch),
    ),
  );
  return new Set(
    results.flatMap(({ data }) => (data ?? []).map((row: { meeting_id: string }) => row.meeting_id)),
  );
}

/** What one log search found, and how far it looked. */
export interface MeetingLogSearch {
  rows: MeetingLogRow[];
  /**
   * Meetings the search actually considered — the ones that are IN the log.
   *
   * Not the number of rows read. The scan takes the most recent rows of the
   * table, and some of them are meetings that have not happened yet or drafts:
   * they are never in the log, so a search that read two hundred rows of which
   * sixty were future bookings looked at a hundred and forty logged meetings.
   * Saying two hundred would overstate how far back it reached, in the one
   * sentence whose job is to admit how far back it reached.
   */
  scanned: number;
  /** The scan bound was reached, so there may be older matches unseen. */
  bounded: boolean;
}

/**
 * Search the log by what was SAID, not only by what was written about it.
 *
 * This is the capability the log did not have. It matched titles, summaries,
 * decisions, action items and attendee names with `String.includes` in the
 * browser — so "what did we agree with Dunbar in March" could only be answered if
 * somebody had happened to write "Dunbar" in a title. The words are in the
 * transcript, and the transcript was never read.
 *
 * Done here rather than in the browser for the reason the call archive already
 * does it here: the alternative is shipping every transcript the organisation has
 * to a laptop so it can grep them, which is slow at ten meetings and untenable at
 * two hundred.
 *
 * Bounded, and says so. `scanned` and `bounded` travel back because "no results"
 * and "I stopped looking" are the same screen otherwise.
 */
export async function searchMeetingLog(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  query: string,
  scan: number = SEARCH_SCAN,
  now: number = Date.now(),
): Promise<MeetingLogSearch> {
  // Drafts are excluded in the QUERY rather than only in the loop below. They
  // can never appear in the log, so a draft that reaches this far has spent a
  // row of the scan bound and a read of a transcript up to 120,000 characters
  // long, to be dropped.
  const { data } = await narrowArchive(
    supabase.from("live_meetings").select(LOG_SEARCH_SELECT).not("is_draft", "is", true),
    {
      kind: MEETING_KIND,
      visibility: { scope: "org", organizationId: orgId },
      searching: true,
      scan,
    },
  );

  const raw = data ?? [];
  const attendedIds = await attendanceFor(
    supabase,
    userId,
    raw.map((row) => (row as { id: string }).id),
  );

  const rows: MeetingLogRow[] = [];
  // Meetings that are actually in the log, which is what `scanned` reports.
  let considered = 0;
  for (const row of raw) {
    const shaped = shapeLogRow(row as Record<string, unknown>, userId, attendedIds);
    // The same rule the page applies to the list — drafts, and meetings that
    // have not happened yet. A search that surfaced one would be the only place
    // in the product it appears, and it would be a record of something that has
    // not occurred.
    if (!belongsInLog(shaped.meeting, now)) continue;
    considered += 1;

    const entry = toLogEntry(shaped.meeting, shaped.report, shaped.attended, shaped.isHost);
    const meta: SessionMetadata = {
      title: entry.title,
      summary: entry.summary,
      keyPoints: entry.keyPoints,
      decisions: entry.decisions,
      actionItems: entry.actionItems,
      attendeeNames: entry.attendeeNames,
    };

    // A report the caller may not read contributes nothing to match on: under RLS
    // its fields come back empty anyway, and searching a transcript they are not
    // entitled to would make the search a way of reading it.
    const transcript = shaped.attended ? transcriptOf(row) : null;

    const hit = searchSession(
      {
        id: entry.id,
        roomCode: entry.roomCode,
        title: entry.title,
        at: entry.occurredAt,
        attendeeNames: entry.attendeeNames,
        durationMinutes: entry.durationMinutes,
        durationSeconds: null,
        hasReport: entry.hasReport,
      },
      meta,
      transcript,
      query,
    );
    if (!hit) continue;

    rows.push({
      ...shaped,
      hit: { reason: hit.reason, matches: hit.matches, snippet: hit.snippet },
    });
  }

  return {
    rows,
    scanned: considered,
    // From the RAW count, not from `considered`: the bound is about how deep the
    // query went, and it bit whether or not the rows it returned were loggable.
    bounded: hitScanBound(raw.length, { searching: true, scan }),
  };
}

/** The stored transcript on the embedded report, when the select asked for one. */
function transcriptOf(row: unknown): string | null {
  const embedded = (row as { live_meeting_reports?: unknown }).live_meeting_reports;
  const report = (Array.isArray(embedded) ? embedded[0] : embedded) as
    | { full_transcript?: unknown }
    | undefined;
  return typeof report?.full_transcript === "string" ? report.full_transcript : null;
}

/**
 * One meeting's row, for the detail an opened log row shows.
 *
 * The list ships a line per meeting and fetches the prose when a row is opened
 * (see LoggedMeeting), so this is that fetch: one row, the same shape the list
 * is built from, through the same narrowing — which is what keeps "the newest
 * report" meaning the same thing in the row and in its detail.
 *
 * Returns null for a meeting that is not this organisation's, not a meeting, or
 * deleted. Null rather than a thrown error: to a caller the three are one answer,
 * which is that there is nothing here to show.
 */
export async function loadLogDetail(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  meetingId: string,
): Promise<MeetingLogRow | null> {
  const { data } = await narrowArchive(
    supabase.from("live_meetings").select(LOG_SELECT).eq("id", meetingId),
    {
      kind: MEETING_KIND,
      visibility: { scope: "org", organizationId: orgId },
      searching: false,
      page: 1,
    },
  );

  const row = (data ?? [])[0];
  if (!row) return null;

  const attendedIds = await attendanceFor(supabase, userId, [(row as { id: string }).id]);
  return shapeLogRow(row as Record<string, unknown>, userId, attendedIds);
}
