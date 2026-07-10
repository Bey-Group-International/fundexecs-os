// lib/meetings/calendar.ts
// Pure, side-effect-free helpers backing the institutional Meetings calendar:
// month/week grids, timed-event lane layout, day grouping, meeting-type colour
// tokens, and the calendar filter predicate. Everything here is deterministic
// (dates in, dates out) so it can be unit tested and shared by the views.

import { MEETING_TYPES } from "./schedule";

export type CalendarView = "month" | "week" | "day" | "agenda";

/** The shape of a meeting the calendar needs to plot and open. A superset of
 *  the live_meetings columns the grid, detail popover, and edit prefill use. */
export interface CalendarMeeting {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "active" | "ended";
  host_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  timezone: string | null;
  meeting_type: string | null;
  attendees: Array<{ name: string; email?: string; type?: "internal" | "external" }> | null;
  preparation_status: string | null;
  followup_status: string | null;
  assigned_copilot_agent: string | null;
  is_draft: boolean | null;
  locked_at: string | null;
  updated_at: string | null;
  // Fields used to prefill the edit screen / detail popover.
  description: string | null;
  location: string | null;
  meeting_url: string | null;
  objective: string | null;
  agenda: string | null;
  preparation_requirements: string | null;
  related_record_type: string | null;
  related_record_id: string | null;
  calendar_visibility: string | null;
  reminder_minutes: number | null;
  priority: "low" | "normal" | "high" | "critical" | null;
  tags: string[] | null;
  external_calendar_provider: string | null;
  external_calendar_sync_enabled: boolean | null;
  external_calendar_sync_status: string | null;
}

// ── Date primitives (local wall-clock) ─────────────────────────────────────
// The calendar renders in the viewer's local zone, matching the rest of the
// meetings UI which formats via toLocaleString. `timezone` on a meeting is a
// display label only.

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Stable YYYY-MM-DD key in local time — used to bucket events by day. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * A 6-row × 7-col month grid covering `anchor`'s month, padded with the
 * trailing/leading days of the neighbouring months so every row is full.
 */
export function monthMatrix(anchor: Date, weekStartsOn = 0): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const gridStart = addDays(first, -offset);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) row.push(addDays(gridStart, w * 7 + d));
    weeks.push(row);
  }
  return weeks;
}

/** The seven days of the week containing `anchor`. */
export function weekDays(anchor: Date, weekStartsOn = 0): Date[] {
  const offset = (anchor.getDay() - weekStartsOn + 7) % 7;
  const start = addDays(startOfDay(anchor), -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Weekday headers ("Sun".."Sat") rotated to the configured week start. */
export function weekdayLabels(weekStartsOn = 0): string[] {
  const base = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return Array.from({ length: 7 }, (_, i) => base[(i + weekStartsOn) % 7]);
}

// ── Minutes-of-day for timed layout ────────────────────────────────────────

export function minutesSinceMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** [startMin, endMin] of a meeting within its day, end clamped for a min height. */
export function eventSpanMinutes(m: CalendarMeeting): [number, number] {
  const start = m.scheduled_at ? minutesSinceMidnight(m.scheduled_at) : 0;
  const dur = m.duration_minutes && m.duration_minutes > 0 ? m.duration_minutes : 60;
  return [start, start + dur];
}

// ── Grouping / selection ───────────────────────────────────────────────────

/** Meetings that have a scheduled time on the given day, sorted by start. */
export function eventsForDay(meetings: CalendarMeeting[], day: Date): CalendarMeeting[] {
  const key = dayKey(day);
  return meetings
    .filter((m) => m.scheduled_at && dayKey(new Date(m.scheduled_at)) === key)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
}

/** Bucket every scheduled meeting by its local day key. */
export function groupByDay(meetings: CalendarMeeting[]): Map<string, CalendarMeeting[]> {
  const map = new Map<string, CalendarMeeting[]>();
  for (const m of meetings) {
    if (!m.scheduled_at) continue;
    const key = dayKey(new Date(m.scheduled_at));
    const arr = map.get(key) ?? [];
    arr.push(m);
    map.set(key, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  }
  return map;
}

/**
 * Assign overlapping timed events to side-by-side lanes (Google-Calendar style)
 * so a day/week column can render them without covering each other. Returns a
 * map of meeting id → { lane, lanes } where width = 1/lanes and left = lane/lanes.
 */
export function layoutDayEvents(events: CalendarMeeting[]): Map<string, { lane: number; lanes: number }> {
  const items = events
    .map((m) => {
      const [s, e] = eventSpanMinutes(m);
      return { id: m.id, start: s, end: Math.max(e, s + 20) };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: string[] = [];
  let columns: number[] = []; // per-column end minute
  let clusterEnd = -1;

  const flush = () => {
    const lanes = Math.max(columns.length, 1);
    for (const id of cluster) {
      const prev = result.get(id)!;
      result.set(id, { lane: prev.lane, lanes });
    }
    cluster = [];
    columns = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) flush();
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      if (columns[c] <= it.start) {
        columns[c] = it.end;
        result.set(it.id, { lane: c, lanes: 1 });
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push(it.end);
      result.set(it.id, { lane: columns.length - 1, lanes: 1 });
    }
    cluster.push(it.id);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return result;
}

// ── Filtering ──────────────────────────────────────────────────────────────

export interface CalendarFilter {
  types: Set<string>; // empty = all
  statuses: Set<string>; // display statuses; empty = all
  mineOnly: boolean;
}

export function emptyFilter(): CalendarFilter {
  return { types: new Set(), statuses: new Set(), mineOnly: false };
}

export function filterCountActive(f: CalendarFilter): number {
  return f.types.size + f.statuses.size + (f.mineOnly ? 1 : 0);
}

/**
 * Apply the calendar filters. `statusOf` maps a meeting to its display status
 * (injected so we can reuse deriveMeetingStatus without importing time here).
 */
export function applyCalendarFilter(
  meetings: CalendarMeeting[],
  f: CalendarFilter,
  userId: string,
  statusOf: (m: CalendarMeeting) => string,
): CalendarMeeting[] {
  return meetings.filter((m) => {
    if (f.mineOnly && m.host_id !== userId) return false;
    if (f.types.size > 0 && !f.types.has(m.meeting_type ?? "other")) return false;
    if (f.statuses.size > 0 && !f.statuses.has(statusOf(m))) return false;
    return true;
  });
}

// ── Meeting-type colour tokens ─────────────────────────────────────────────
// Literal class strings (not composed at runtime) so Tailwind keeps them.
// `accent` is a hex used for the left rail on week/day time blocks.

export interface TypeMeta {
  label: string;
  dot: string;
  chip: string; // bg + text + border for month chips
  accent: string; // hex for time-block accent
}

export const MEETING_TYPE_META: Record<string, TypeMeta> = {
  internal_strategy: { label: "Internal strategy", dot: "bg-amber-400", chip: "bg-amber-400/12 text-amber-300 border-amber-400/30", accent: "#f59e0b" },
  investor_update: { label: "Investor update", dot: "bg-sky-400", chip: "bg-sky-400/12 text-sky-300 border-sky-400/30", accent: "#38bdf8" },
  lp_review: { label: "LP review", dot: "bg-violet-400", chip: "bg-violet-400/12 text-violet-300 border-violet-400/30", accent: "#a78bfa" },
  deal_review: { label: "Deal review", dot: "bg-emerald-400", chip: "bg-emerald-400/12 text-emerald-300 border-emerald-400/30", accent: "#34d399" },
  diligence: { label: "Diligence", dot: "bg-orange-400", chip: "bg-orange-400/12 text-orange-300 border-orange-400/30", accent: "#fb923c" },
  portfolio_review: { label: "Portfolio review", dot: "bg-teal-400", chip: "bg-teal-400/12 text-teal-300 border-teal-400/30", accent: "#2dd4bf" },
  board_meeting: { label: "Board meeting", dot: "bg-rose-400", chip: "bg-rose-400/12 text-rose-300 border-rose-400/30", accent: "#fb7185" },
  external_pitch: { label: "External pitch", dot: "bg-indigo-400", chip: "bg-indigo-400/12 text-indigo-300 border-indigo-400/30", accent: "#818cf8" },
  advisory: { label: "Advisory", dot: "bg-cyan-400", chip: "bg-cyan-400/12 text-cyan-300 border-cyan-400/30", accent: "#22d3ee" },
  other: { label: "Other", dot: "bg-zinc-400", chip: "bg-zinc-400/12 text-zinc-300 border-zinc-400/30", accent: "#a1a1aa" },
};

export function typeMeta(type: string | null | undefined): TypeMeta {
  return MEETING_TYPE_META[type ?? "other"] ?? MEETING_TYPE_META.other;
}

/** Ordered list of types for legends / filter menus. */
export const CALENDAR_TYPE_ORDER: string[] = [...MEETING_TYPES];

// ── Title formatting ───────────────────────────────────────────────────────

export function formatMonthTitle(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function formatWeekTitle(days: Date[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  const sameMonth = first.getMonth() === last.getMonth();
  const sameYear = first.getFullYear() === last.getFullYear();
  const f = (dd: Date, withYear: boolean) =>
    dd.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  if (sameMonth && sameYear) {
    return `${first.toLocaleDateString("en-US", { month: "long" })} ${first.getDate()}–${last.getDate()}, ${first.getFullYear()}`;
  }
  return `${f(first, !sameYear)} – ${f(last, true)}`;
}

export function formatDayTitle(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** "9:30 AM" style short time from an ISO instant (local). */
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
