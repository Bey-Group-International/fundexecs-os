// lib/meetings/calendar-insights.ts
// What the calendar should point out about the meetings it draws, and the
// small decisions behind its quick interactions.
//
//   - Conflicts. Two meetings at once, or a meeting on time a connected
//     calendar has as busy, were drawn as two narrow columns or as a block
//     under a block — a double booking the grid showed without saying so.
//   - Joining. "Join" belongs on the event itself from shortly before it starts
//     until it ends, so a meeting about to begin is one press from its room.
//   - Quick create. A click on an empty slot makes a meeting from a title and a
//     length; the payload here is what the schedule route expects.
//   - Swipe. Which way, if any, a touch gesture across the grid means.
//
// Pure: no DOM, no React. "Now" and the clock are always passed in.

/** The fields of a meeting these rules read. */
export interface InsightMeeting {
  id: string;
  title: string;
  scheduled_at: string | null;
  duration_minutes: number | null;
  status?: string | null;
}

/** The fields of a connected calendar's busy event these rules read. */
export interface InsightBusy {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isAllDay?: boolean;
}

export interface Conflict {
  /** Titles of the other meetings this one overlaps. */
  meetings: string[];
  /** Titles of the busy events from connected calendars it sits on. */
  busy: string[];
}

const DEFAULT_MINUTES = 60;

function span(m: InsightMeeting): [number, number] | null {
  if (!m.scheduled_at) return null;
  const start = Date.parse(m.scheduled_at);
  if (Number.isNaN(start)) return null;
  const minutes = m.duration_minutes && m.duration_minutes > 0 ? m.duration_minutes : DEFAULT_MINUTES;
  return [start, start + minutes * 60_000];
}

/**
 * Every meeting that clashes with something, and with what.
 *
 * Touching is not overlapping: a 10:00–10:30 and a 10:30–11:00 are back to
 * back, which is a full morning, not a double booking. An ended meeting is not
 * a conflict either — it has happened, and painting last week red helps nobody.
 * Sorted sweep, so a busy week of a few hundred meetings is a few hundred
 * comparisons rather than the square of it.
 */
export function calendarConflicts(
  meetings: readonly InsightMeeting[],
  busy: readonly InsightBusy[],
): Map<string, Conflict> {
  const out = new Map<string, Conflict>();
  const entry = (id: string) => {
    let c = out.get(id);
    if (!c) {
      c = { meetings: [], busy: [] };
      out.set(id, c);
    }
    return c;
  };

  const timed = meetings
    .filter((m) => m.status !== "ended")
    .map((m) => ({ m, s: span(m) }))
    .filter((x): x is { m: InsightMeeting; s: [number, number] } => x.s !== null)
    .sort((a, b) => a.s[0] - b.s[0]);

  for (let i = 0; i < timed.length; i++) {
    const a = timed[i];
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j];
      if (b.s[0] >= a.s[1]) break; // sorted by start: nothing later can overlap a
      entry(a.m.id).meetings.push(b.m.title);
      entry(b.m.id).meetings.push(a.m.title);
    }
  }

  const busySpans = busy
    .filter((e) => !e.isAllDay)
    .map((e) => ({ e, s: [Date.parse(e.startsAt), Date.parse(e.endsAt)] as [number, number] }))
    .filter((x) => !Number.isNaN(x.s[0]) && !Number.isNaN(x.s[1]));
  for (const { m, s } of timed) {
    for (const b of busySpans) {
      if (b.s[0] < s[1] && s[0] < b.s[1]) entry(m.id).busy.push(b.e.title || "Busy");
    }
  }
  return out;
}

/** What a conflict says, in a line: for a tooltip or a screen reader. */
export function conflictLabel(c: Conflict | undefined): string | null {
  if (!c || (c.meetings.length === 0 && c.busy.length === 0)) return null;
  const parts: string[] = [];
  if (c.meetings.length) parts.push(`Overlaps ${listOf(c.meetings)}`);
  if (c.busy.length) parts.push(`${c.meetings.length ? "and is" : "Is"} during busy time (${listOf(c.busy)})`);
  return parts.join(" ");
}

function listOf(titles: string[]): string {
  const unique = [...new Set(titles)];
  if (unique.length <= 2) return unique.join(" and ");
  return `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more`;
}

/** How long before the start "Join" appears on the event. */
export const JOIN_LEAD_MS = 10 * 60_000;

/**
 * Whether the event should carry a Join button now: someone is in the room,
 * or the clock is between ten minutes before the start and the end.
 */
export function joinableNow(m: InsightMeeting, now: number, inRoom = 0): boolean {
  if (m.status === "ended") return false;
  if (inRoom > 0) return true;
  const s = span(m);
  if (!s) return false;
  return now >= s[0] - JOIN_LEAD_MS && now < s[1];
}

/** The lengths a quick-created meeting can have, in minutes. */
export const QUICK_DURATIONS = [15, 30, 45, 60] as const;

/** The meeting type a quick-created meeting gets; the full form can change it. */
export const QUICK_MEETING_TYPE = "internal_strategy";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The body for `/api/meetings/schedule` from a quick-create: a title, a start
 * on the grid, a length, and optionally invitees by address.
 *
 * Wall-clock fields in the browser's own zone, which is the zone the grid drew
 * the slot in. The route wants a start and an end on the same day, so a slot
 * late enough that the length would run past midnight is cut to end at 23:59.
 */
export function quickCreatePayload(input: {
  title: string;
  start: Date;
  minutes: number;
  attendees?: Array<{ name: string; email?: string; type?: "internal" | "external" }>;
  timezone: string;
}): {
  title: string;
  meetingType: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  attendees: Array<{ name: string; email?: string; type?: "internal" | "external" }>;
} {
  const { start, minutes } = input;
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = Math.min(startMin + Math.max(15, minutes), 23 * 60 + 59);
  return {
    title: input.title.trim(),
    meetingType: QUICK_MEETING_TYPE,
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    startTime: `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`,
    endTime: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`,
    timezone: input.timezone,
    attendees: input.attendees ?? [],
  };
}

/**
 * Which way a touch gesture moves the calendar: -1 back, 1 forward, 0 neither.
 *
 * Mostly sideways and far enough to be meant. A vertical scroll that drifts a
 * little sideways — which is most of them on a phone — must not change the
 * week under somebody's thumb.
 */
export function swipeStep(dx: number, dy: number, minDistance = 60): -1 | 0 | 1 {
  if (Math.abs(dx) < minDistance) return 0;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
