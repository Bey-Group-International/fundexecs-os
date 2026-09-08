// lib/meetings/meeting-log.ts
// The meeting log: what a meeting left behind, once it is over.
//
// A meeting produces a report — summary, key points, decisions, action items —
// and until now the only way back to one was the calendar overlay, or a URL
// somebody still had. This shapes those rows into entries that can be listed,
// searched and read months later.
//
// Deliberately absent: the transcript. Its presence is not knowable without
// reading tens of kilobytes per meeting, and a list of fifty meetings would
// read every one of them to draw a badge nobody needs. The report page is
// where a transcript is looked at, and it fetches it there.
//
// Pure: no DOM, no Supabase, no model calls.

import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";

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
  };
}

/** Newest first — a log is read from the top. */
export function sortLogEntries(entries: MeetingLogEntry[]): MeetingLogEntry[] {
  return [...entries].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );
}

/**
 * Whether an entry matches a search.
 *
 * Searches what the meeting was about, not just what it was called: somebody
 * looking for "the one where we agreed to hold the close" has the decision in
 * their head, not the title. Attendee names count too, because "the meeting
 * with Alina" is how people actually remember them.
 */
export function matchesLogSearch(entry: MeetingLogEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    entry.title,
    entry.summary,
    ...entry.keyPoints,
    ...entry.decisions,
    ...entry.actionItems,
    ...entry.attendeeNames,
  ].join(" ").toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export interface MeetingLogGroup {
  /** e.g. "September 2026". */
  label: string;
  entries: MeetingLogEntry[];
}

/**
 * Grouped by the month they happened in.
 *
 * A log without dividers is a wall. Months are the unit people navigate
 * meetings by, and the grouping preserves the newest-first order within each.
 */
export function groupLogsByMonth(entries: MeetingLogEntry[]): MeetingLogGroup[] {
  const groups: MeetingLogGroup[] = [];
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

/** A one-line count of what the meeting produced, for a collapsed row. */
export function logEntrySubtitle(entry: MeetingLogEntry): string {
  if (!entry.hasReport) return "No report";
  const parts: string[] = [];
  if (entry.keyPoints.length) parts.push(`${entry.keyPoints.length} key point${entry.keyPoints.length === 1 ? "" : "s"}`);
  if (entry.decisions.length) parts.push(`${entry.decisions.length} decision${entry.decisions.length === 1 ? "" : "s"}`);
  if (entry.actionItems.length) parts.push(`${entry.actionItems.length} action${entry.actionItems.length === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "Summary only";
}
