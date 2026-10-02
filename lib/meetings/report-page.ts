// lib/meetings/report-page.ts
// What the report page is, as data and rules, with nothing that touches a
// network or a browser.
//
// The page used to be a client component that made seven browser round trips
// before it could render anything: the viewer, the meeting, the report, the
// attendance row, the timed transcript, the recordings and the chat. A report
// is a DOCUMENT — it is finished, it is read far more often than it is written,
// and every one of those reads was waiting on JavaScript to boot first.
//
// Moving the reads to the server left two things that genuinely belong here:
// the shape of what a page needs, and the one rule that changed meaning when it
// crossed over — how long a missing report has been missing.

import { reportActionItems } from "@/lib/meetings/action-item-source";
import { REPORT_WAIT_LIMIT_MS } from "@/lib/meetings/attendance";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { TRUNCATED_KEY } from "@/lib/meetings/report-analysis";

/** The meeting fields the page renders. */
export interface ReportMeeting {
  id: string;
  host_id: string | null;
  title: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  scheduled_at: string | null;
  /** "meeting" or "one_way" — a recorded call has no room and no attendees. */
  kind: string | null;
}

/** The report row, as stored. */
export interface ReportRow {
  summary: string | null;
  key_points: string[] | null;
  action_items: string[] | null;
  analysis: Record<string, unknown> | null;
  full_transcript: string | null;
}

/**
 * How long this report has been missing.
 *
 * THIS IS THE RULE THAT CHANGED. On the client it was "how long has this tab
 * been open", measured from mount — so every reload restarted the six-minute
 * clock, and a report that failed to generate a week ago still promised
 * "Generating your report…" for another six minutes to each person who opened
 * it. The stall was a property of the visit rather than of the report.
 *
 * Measured from the meeting instead, which is the thing that is actually late.
 *
 * The fallback ORDER matters, and the obvious version of it was wrong: reaching
 * straight for `created_at` when there is no `ended_at` dates the clock to when
 * the ROW was made, and for anything booked in advance that is days before the
 * meeting. A meeting booked last week and not yet closed would be declared
 * "probably not coming" the first time anybody opened it — the same gap
 * `meetingHappenedAt` below exists for. So: when it ended, else when it started,
 * else when it was booked for, and only then the row itself, which is all a
 * one-way call has.
 *
 * Never negative, so a meeting still in the future reads as nothing owed rather
 * than as a report late since before it was due.
 *
 * KNOWN LIMIT, shared with the version this replaces: a meeting that is still
 * running has no `ended_at`, so this measures from when it started and will call
 * a long call's absent report stalled while the call is still going. Returning
 * zero for that case was the tempting fix and is worse — a room nobody ever
 * closes would then wait for a report forever, which is the permanent spinner
 * the wait limit exists to prevent. Distinguishing "running" from "abandoned"
 * needs the meeting's status, which is a wider change than this one.
 */
export function reportOwedForMs(meeting: ReportMeeting, now: number): number {
  const owedSince = Date.parse(
    meeting.ended_at ?? meeting.started_at ?? meeting.scheduled_at ?? meeting.created_at,
  );
  if (!Number.isFinite(owedSince)) return 0;
  return Math.max(0, now - owedSince);
}

/**
 * Whether a report this late is still worth waiting for on the page.
 *
 * The same limit the client used, asked of the meeting rather than the tab. Kept
 * as its own function because the waiting island needs it too, and a poll that
 * gives up on a different schedule from the render is how a spinner outlives
 * the thing it is waiting for.
 */
export function reportStillPending(meeting: ReportMeeting, now: number): boolean {
  return reportOwedForMs(meeting, now) < REPORT_WAIT_LIMIT_MS;
}

/** The recording rows the page needs, in the order they were made. */
export interface ReportRecording {
  id: string;
  status: "recording" | "complete" | "failed" | "abandoned";
  duration_seconds: number | null;
  size_bytes: number;
  started_by_name: string | null;
  started_at: string;
  expires_at: string;
  deleted_at: string | null;
  mime_type: string;
}

/**
 * The recording the transcript is timed against.
 *
 * The first one that can actually be PLAYED, which is not the same as the first
 * row: a meeting whose only recording was deleted or captured nothing is
 * ordinary, and keying on index meant the timestamps were offset against a
 * recording that was not on the page.
 *
 * One answer, used for the player, for the ref the transcript seeks through and
 * for the clock the cues are offset by — so those three can never disagree
 * about which recording they mean. On the client this was a callback the panel
 * fired after its own fetch, which is why the transcript could not know its
 * offset until a second round trip had landed.
 */
export function playableRecording(
  recordings: readonly ReportRecording[],
): ReportRecording | null {
  return recordings.find((r) => !r.deleted_at && r.status !== "abandoned") ?? null;
}

/**
 * The parts of a report that are stored as model output and have to be coerced
 * before React sees them.
 *
 * Coerced, not cast. Reports written before the report route started
 * normalizing can hold objects where the page expects strings, and rendering
 * one of those throws — replacing a finished report with an error page. This
 * ran in the component body before; it is out here so it can be tested without
 * rendering anything.
 */
export interface ReportContent {
  summary: string | null;
  keyPoints: string[];
  actionItems: string[];
  decisions: string[];
  /** The draft, or null when the model wrote nothing usable. */
  followUp: string | null;
  sentiment: string | null;
  nextMeeting: string | null;
  /** The analysis ran out of room before it finished. */
  truncated: boolean;
  transcript: string | null;
}

export function reportContent(report: ReportRow): ReportContent {
  const analysis = report.analysis ?? null;
  return {
    summary: report.summary,
    keyPoints: normalizeNoteList(report.key_points),
    // The report's own list, or — for a report the model left without one —
    // the items its follow-up email lists, so they are never only in the email.
    actionItems: reportActionItems(report.action_items, analysis),
    decisions: normalizeNoteList(analysis?.decisions),
    followUp: normalizeNoteText(analysis?.follow_up_draft) || null,
    sentiment: typeof analysis?.sentiment === "string" ? analysis.sentiment : null,
    nextMeeting:
      typeof analysis?.next_meeting_suggestion === "string"
        ? analysis.next_meeting_suggestion
        : null,
    truncated: analysis?.[TRUNCATED_KEY] === true,
    transcript: report.full_transcript,
  };
}

/**
 * The wall clock of the meeting, in whole minutes.
 *
 * Null for a one-way call, which has no started_at because nobody joins a room
 * that does not exist — the recording's own length stands in for those.
 */
export function meetingMinutes(meeting: ReportMeeting): number | null {
  if (!meeting.started_at || !meeting.ended_at) return null;
  const ms = Date.parse(meeting.ended_at) - Date.parse(meeting.started_at);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 60000);
}

/**
 * When the meeting HAPPENED, for the line under the title.
 *
 * `created_at` is when the row was made, which for anything booked in advance
 * is a different day entirely — a report for Tuesday's board call dated the
 * Thursday before it was booked.
 */
export function meetingHappenedAt(meeting: ReportMeeting): string {
  return meeting.started_at ?? meeting.scheduled_at ?? meeting.created_at;
}
