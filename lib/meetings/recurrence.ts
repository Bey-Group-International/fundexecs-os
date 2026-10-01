// lib/meetings/recurrence.ts
// Repeating meetings: which dates a series falls on, and how to say so.
//
// A series is materialised: every occurrence is its own meeting row, so rooms,
// reminders, notes and reports keep working one meeting at a time. What is
// shared is the rule, which guests receive once, as one repeating invitation.
//
// Pure.
import { addCalendarDays } from "@/lib/meetings/scheduling";

export type RepeatFreq = "weekly" | "monthly";

export interface RepeatRule {
  freq: RepeatFreq;
  /** How many meetings in all, the first included. */
  count: number;
}

/** Fewest and most meetings a series may hold. */
export const REPEAT_MIN = 2;
export const REPEAT_MAX = 52;

/** What the scheduler offers first for each pattern. */
export const REPEAT_DEFAULT_COUNT: Record<RepeatFreq, number> = { weekly: 12, monthly: 6 };

/**
 * A repeat request as the server accepts it, or null for "does not repeat".
 * Anything malformed is an error rather than a guess: a series creates a year
 * of meetings and emails everyone on them.
 */
export function parseRepeat(raw: unknown): RepeatRule | null | { error: string } {
  if (raw === undefined || raw === null || raw === "" || raw === false) return null;
  if (typeof raw !== "object") return { error: "Choose how the meeting repeats." };
  const { freq, count } = raw as { freq?: unknown; count?: unknown };
  if (freq !== "weekly" && freq !== "monthly") return { error: "Choose weekly or monthly." };
  const n = typeof count === "number" ? count : Number(count);
  if (!Number.isInteger(n) || n < REPEAT_MIN || n > REPEAT_MAX) {
    return { error: `A repeating meeting happens between ${REPEAT_MIN} and ${REPEAT_MAX} times.` };
  }
  return { freq, count: n };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The calendar dates ("YYYY-MM-DD") of every meeting in a series, the first
 * included.
 *
 * Monthly keeps the day of the month, and a month without that day (the 31st
 * in April) is skipped rather than moved to the 30th. That is what RRULE
 * FREQ=MONTHLY means, and the invitation guests receive says RRULE, so the
 * meetings here must fall on the dates their calendars will show.
 */
export function occurrenceDates(firstDate: string, rule: RepeatRule): string[] {
  if (rule.freq === "weekly") {
    return Array.from({ length: rule.count }, (_, i) => addCalendarDays(firstDate, 7 * i));
  }
  const [y, m, d] = firstDate.split("-").map(Number);
  const out: string[] = [];
  for (let step = 0; out.length < rule.count && step < rule.count * 4; step += 1) {
    const monthIndex = m - 1 + step;
    const year = y + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    if (d > daysInMonth(year, month)) continue;
    out.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

/** The RRULE guests' calendars expand, matching `occurrenceDates`. */
export function seriesRrule(rule: RepeatRule): string {
  return `FREQ=${rule.freq === "weekly" ? "WEEKLY" : "MONTHLY"};COUNT=${rule.count}`;
}

/** Read a stored RRULE back, for the series' own rows. */
export function ruleFromRrule(rrule: string | null | undefined): RepeatRule | null {
  const freq = /FREQ=(WEEKLY|MONTHLY)/.exec(rrule ?? "")?.[1];
  const count = Number(/COUNT=(\d+)/.exec(rrule ?? "")?.[1]);
  if (!freq || !Number.isInteger(count)) return null;
  return { freq: freq === "WEEKLY" ? "weekly" : "monthly", count };
}

/**
 * "Weekly on Tuesday at 10:00 AM CDT, 12 times" — the series as its
 * invitation and the scheduler describe it.
 */
export function describeRepeat(rule: RepeatRule, startIso: string, timezone: string): string {
  const start = new Date(startIso);
  const parts = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone }).format(start);
    } catch {
      return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(start);
    }
  };
  const time = parts({ hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const when =
    rule.freq === "weekly"
      ? `Weekly on ${parts({ weekday: "long" })}`
      : `Monthly on the ${ordinal(Number(parts({ day: "numeric" })))}`;
  return `${when} at ${time}, ${rule.count} times`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * Which meeting of a series its shared link should open: the first one not yet
 * over (the one on now, or the next), or the last one once the series is done.
 */
export function pickSeriesOccurrence(
  rows: Array<{ room_code: string; scheduled_at: string | null; duration_minutes: number | null }>,
  now: number,
): string | null {
  const timed = rows
    .filter((r) => r.room_code && r.scheduled_at && Number.isFinite(new Date(r.scheduled_at).getTime()))
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  if (timed.length === 0) return null;
  const current = timed.find(
    (r) => new Date(r.scheduled_at!).getTime() + (r.duration_minutes ?? 60) * 60_000 > now,
  );
  return (current ?? timed[timed.length - 1]).room_code;
}

/**
 * The rule that is left once a series stops before the meeting in slot
 * `keep` (0-based): the first `keep` meetings stay. Null when nothing does,
 * which is the whole series being cancelled.
 */
export function truncateRule(rule: RepeatRule, keep: number): RepeatRule | null {
  const count = Math.min(rule.count, Math.floor(keep));
  return count >= 1 ? { freq: rule.freq, count } : null;
}

/**
 * "Repeats weekly · 3 of 12" — where one meeting sits in its series, for the
 * calendar and the meeting's details. Null for a meeting that does not repeat.
 */
export function seriesPositionLabel(
  rrule: string | null | undefined,
  index: number | null | undefined,
): string | null {
  const rule = ruleFromRrule(rrule);
  if (!rule) return null;
  const head = `Repeats ${rule.freq}`;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return head;
  // The slot is the meeting's place in the rule as first written, so a series
  // cut short keeps reading "3 of 3" for its last meeting, not "3 of 12".
  return `${head} · ${index + 1} of ${Math.max(rule.count, index + 1)}`;
}
