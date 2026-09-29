// lib/meetings/meeting-log.ts
// The meeting log: what a meeting left behind, once it is over.
//
// A meeting produces a report — summary, key points, decisions, action items —
// and until now the only way back to one was the calendar overlay, or a URL
// somebody still had. This shapes those rows into entries that can be listed,
// searched and read months later.
//
// Deliberately absent: the transcript itself. A list of fifty meetings would
// read tens of kilobytes per row to draw a badge nobody needs. The report page
// is where a transcript is looked at, and it fetches it there.
//
// Its PRESENCE is another matter, and is known here: `has_transcript` is a
// generated boolean on the report row (migration 20260910180000), so the log
// can tell whether there is something to regenerate from without paying for
// the text.
//
// Pure: no DOM, no Supabase, no model calls.

import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { isPastMeeting } from "@/lib/meetings/schedule";

/** A meeting row, as the log needs to see one. */
export interface MeetingLogSource {
  id: string;
  room_code: string;
  title: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  status: string | null;
  attendees: unknown;
}

/** The latest report for that meeting, when one exists. */
export interface MeetingLogReport {
  summary: string | null;
  key_points: unknown;
  action_items: unknown;
  analysis: Record<string, unknown> | null;
  /** Generated in Postgres; see the note at the top of this file. */
  has_transcript?: boolean | null;
}

export interface MeetingLogEntry {
  id: string;
  roomCode: string;
  title: string;
  /** When the meeting happened, for sorting and for the date shown. */
  occurredAt: string;
  durationMinutes: number | null;
  attendeeNames: string[];
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: string[];
  sentiment: string;
  /** A report exists and has been generated. */
  hasReport: boolean;
  /**
   * Whether there is a transcript on file to build a fresh report from.
   *
   * Separate from `hasReport` on purpose. `hasReport` answers "is there a
   * summary to READ"; this answers "is there a transcript to RE-READ", and the
   * two come apart exactly where it matters. When the model fails at the end of
   * a meeting, the report row is written holding the transcript and an empty
   * summary — everything regeneration needs, and nothing the summary check can
   * see. Gating the regenerate action on `hasReport` hid it from the one row
   * that most needed it.
   */
  canRegenerate: boolean;
  /**
   * Whether the viewer was in this meeting.
   *
   * Meetings are listed across the organisation; their reports are not — RLS
   * limits those to the host and the people who joined. Without this flag the
   * log could only say "No report", which is indistinguishable from "there is
   * a report and you may not read it", and reads as data having been lost.
   */
  attended: boolean;
  /**
   * Whether the viewer ran this meeting. Regenerating a report rewrites a
   * record every attendee reads, so only the host is offered it.
   */
  isHost: boolean;
}

/** What an untitled meeting is called in the log. */
export const UNTITLED_MEETING = "Untitled meeting";

/**
 * When the meeting actually happened.
 *
 * Ended first, then started, then the time it was scheduled for, and only then
 * when the row was created. A meeting nobody ever joined still belongs in the
 * log at the hour it was meant to happen, not at the moment somebody drafted it
 * three weeks earlier.
 */
export function meetingOccurredAt(meeting: MeetingLogSource): string {
  return meeting.ended_at ?? meeting.started_at ?? meeting.scheduled_at ?? meeting.created_at;
}

/** Wall-clock length, preferring what actually happened over what was booked. */
export function meetingLogDuration(meeting: MeetingLogSource): number | null {
  if (meeting.started_at && meeting.ended_at) {
    const mins = Math.round(
      (Date.parse(meeting.ended_at) - Date.parse(meeting.started_at)) / 60000,
    );
    if (Number.isFinite(mins) && mins > 0) return mins;
  }
  return meeting.duration_minutes && meeting.duration_minutes > 0
    ? meeting.duration_minutes
    : null;
}

/** Attendee display names, in the order they were recorded, without blanks. */
export function attendeeNames(attendees: unknown): string[] {
  if (!Array.isArray(attendees)) return [];
  return attendees
    .map((a) => {
      if (typeof a === "string") return a.trim();
      if (a && typeof a === "object") {
        const rec = a as Record<string, unknown>;
        const name = typeof rec.name === "string" ? rec.name.trim() : "";
        const email = typeof rec.email === "string" ? rec.email.trim() : "";
        return name || email;
      }
      return "";
    })
    .filter(Boolean);
}

/**
 * One log entry from a meeting and its report.
 *
 * Every model-written field goes through the same normalizers the report page
 * and the export use, because reports written before those existed can hold
 * objects where this expects strings.
 */
export function toLogEntry(
  meeting: MeetingLogSource,
  report: MeetingLogReport | null,
  attended = true,
  isHost = false,
): MeetingLogEntry {
  const analysis = report?.analysis ?? null;
  const summary = normalizeNoteText(report?.summary);

  return {
    id: meeting.id,
    roomCode: meeting.room_code,
    title: (meeting.title ?? "").trim() || UNTITLED_MEETING,
    occurredAt: meetingOccurredAt(meeting),
    durationMinutes: meetingLogDuration(meeting),
    attendeeNames: attendeeNames(meeting.attendees),
    summary,
    keyPoints: normalizeNoteList(report?.key_points),
    decisions: normalizeNoteList(analysis?.decisions),
    actionItems: normalizeNoteList(report?.action_items),
    sentiment: normalizeNoteText(analysis?.sentiment),
    hasReport: summary.length > 0,
    canRegenerate: report?.has_transcript === true,
    attended,
    isHost,
  };
}

/**
 * One line of the log: enough to identify a meeting, and nothing more.
 *
 * THE REASON THIS TYPE EXISTS. The log used to ship a full `MeetingLogEntry` for
 * every meeting in the organisation — summary, key points, decisions, action
 * items, attendee names — two hundred rows of prose, so that the browser could
 * filter them with `String.includes` and so that ONE open row could show its
 * detail. Everything in that payload beyond this shape was read by nobody in the
 * common case.
 *
 * Counts rather than lists: a collapsed row says "2 key points · 1 decision",
 * which is three numbers, not three paragraphs. `attendeeCount` for the same
 * reason — the row shows how many, the opened row shows who.
 */
export interface LoggedMeeting {
  id: string;
  roomCode: string;
  title: string;
  /** When the meeting happened, for sorting and for the date shown. */
  occurredAt: string;
  durationMinutes: number | null;
  attendeeCount: number;
  /** What the report produced, as numbers. See logEntrySubtitle. */
  counts: { keyPoints: number; decisions: number; actionItems: number };
  hasReport: boolean;
  canRegenerate: boolean;
  attended: boolean;
  isHost: boolean;
}

/**
 * The prose a row shows once it is opened, fetched then rather than shipped.
 *
 * Carries its own `id` so a response cannot be filed against the wrong row —
 * a detail fetch is asynchronous and the reader can open another meeting while
 * it is in flight.
 */
export interface MeetingLogDetail {
  id: string;
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: string[];
  attendeeNames: string[];
  sentiment: string;
}

/** The light row for a full entry. */
export function loggedMeeting(entry: MeetingLogEntry): LoggedMeeting {
  return {
    id: entry.id,
    roomCode: entry.roomCode,
    title: entry.title,
    occurredAt: entry.occurredAt,
    durationMinutes: entry.durationMinutes,
    attendeeCount: entry.attendeeNames.length,
    counts: {
      keyPoints: entry.keyPoints.length,
      decisions: entry.decisions.length,
      actionItems: entry.actionItems.length,
    },
    hasReport: entry.hasReport,
    canRegenerate: entry.canRegenerate,
    attended: entry.attended,
    isHost: entry.isHost,
  };
}

/** The prose half of a full entry. */
export function meetingLogDetail(entry: MeetingLogEntry): MeetingLogDetail {
  return {
    id: entry.id,
    summary: entry.summary,
    keyPoints: entry.keyPoints,
    decisions: entry.decisions,
    actionItems: entry.actionItems,
    attendeeNames: entry.attendeeNames,
    sentiment: entry.sentiment,
  };
}

/**
 * Whether a meeting belongs in the log yet.
 *
 * A meeting scheduled for next week has no record to hold, and listing it under
 * "Logs" would promise one. Drafts are not part of the record at all.
 *
 * Shared rather than applied at each call site: the page lists the log and the
 * search route searches it, and a search that returned a meeting the list does
 * not show would be the only place that meeting appears.
 */
export function belongsInLog(
  meeting: MeetingLogSource & { is_draft?: boolean | null },
  now: number = Date.now(),
): boolean {
  return isPastMeeting(
    {
      status: meeting.status as "waiting" | "active" | "ended" | null,
      scheduled_at: meeting.scheduled_at,
      duration_minutes: meeting.duration_minutes,
      is_draft: meeting.is_draft ?? null,
      started_at: meeting.started_at,
      created_at: meeting.created_at,
    },
    now,
  );
}

/**
 * Newest first — a log is read from the top.
 *
 * Generic over anything dated, because the list sorts the light rows it renders
 * while tests and callers holding full entries sort those.
 */
export function sortLogEntries<T extends { occurredAt: string }>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );
}

// WHERE THE SEARCH WENT. This file used to hold `matchesLogSearch`, a
// `String.includes` over an entry's own prose, run in the browser against every
// entry the page had shipped it. It could not search a transcript — the one place
// the words people actually remember are written down — and it needed every
// summary in the initial payload to search the fields it could.
//
// That rule now lives once, as `matchesMetadata` in session-archive.ts, and runs
// in Postgres alongside a transcript scan. See meeting-log.server.ts.

export interface MeetingLogGroup<T = MeetingLogEntry> {
  /** e.g. "September 2026". */
  label: string;
  entries: T[];
}

/**
 * Grouped by the month they happened in.
 *
 * A log without dividers is a wall. Months are the unit people navigate
 * meetings by, and the grouping preserves the newest-first order within each.
 */
export function groupLogsByMonth<T extends { occurredAt: string }>(
  entries: readonly T[],
): MeetingLogGroup<T>[] {
  const groups: MeetingLogGroup<T>[] = [];
  for (const entry of sortLogEntries(entries)) {
    const ms = Date.parse(entry.occurredAt);
    const label = Number.isFinite(ms)
      ? new Date(ms).toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : "Undated";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

/**
 * A one-line count of what the meeting produced, for a collapsed row.
 *
 * Takes the COUNTS rather than the prose, because a collapsed row is the reason
 * the prose is not on the page: the list ships three numbers per meeting and
 * fetches the sentences when a row is opened.
 */
export function logEntrySubtitle(
  row: Pick<LoggedMeeting, "attended" | "hasReport" | "counts">,
): string {
  // Order matters: a non-attendee reads every report as absent, so checking
  // hasReport first would label a report they simply cannot see "No report".
  if (!row.attended) return "Attendees only";
  if (!row.hasReport) return "No report";
  const parts: string[] = [];
  const { keyPoints, decisions, actionItems } = row.counts;
  if (keyPoints) parts.push(`${keyPoints} key point${keyPoints === 1 ? "" : "s"}`);
  if (decisions) parts.push(`${decisions} decision${decisions === 1 ? "" : "s"}`);
  if (actionItems) parts.push(`${actionItems} action${actionItems === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "Summary only";
}
