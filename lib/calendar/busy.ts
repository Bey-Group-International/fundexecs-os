// lib/calendar/busy.ts
// Turning stored third-party calendar rows into busy time for availability.
//
// Pure on purpose: the two rules that decide whether a host can be
// double-booked — which events occupy their owner, and where an all-day event
// actually sits on that owner's clock — are worth testing without a database in
// the way. The zone arithmetic is borrowed from the scheduling layer rather
// than reimplemented here; a second implementation of DST handling is exactly
// how the two sides of a booking come to disagree about what time it is.
import { blocksTime } from "@/lib/calendar/google";
import type { BusyInterval } from "@/lib/calendar/feeds";
import { localToIso } from "@/lib/meetings/schedule";
import { addCalendarDays } from "@/lib/meetings/scheduling";

/** The columns availability needs off an `external_events` row. */
export interface StoredExternalEvent {
  starts_at: string;
  ends_at: string;
  is_all_day?: boolean | null;
  status?: string | null;
  transparency?: string | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Busy intervals for a set of stored external events, read in the host's zone.
 *
 * Cancelled and "free" events are dropped — see `blocksTime`. Everything else
 * occupies its owner and must keep a slot off the booking page.
 */
export function externalEventsToBusy(
  rows: StoredExternalEvent[] | null | undefined,
  timezone: string,
): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const row of rows ?? []) {
    if (!row || typeof row.starts_at !== "string" || typeof row.ends_at !== "string") continue;
    if (!blocksTime({ status: row.status ?? null, transparency: row.transparency ?? null })) continue;
    const span = row.is_all_day ? allDaySpan(row, timezone) : timedSpan(row);
    if (span) out.push(span);
  }
  return out;
}

/**
 * Where an all-day event really falls.
 *
 * All-day events are stored anchored at UTC midnight, because the calendar grid
 * draws them as banners and only needs them to sort. Availability is not so
 * forgiving: taken literally, a host in New York would have "all day Thursday"
 * block from 8pm Wednesday to 8pm Thursday — releasing four booked hours of
 * Thursday evening and eating four unbooked hours of Wednesday. So the stored
 * instants are read back as the calendar dates they encode, and re-anchored to
 * midnight in the host's own zone.
 *
 * The end date is exclusive, as it is in Google and in iCalendar.
 */
function allDaySpan(row: StoredExternalEvent, timezone: string): BusyInterval | null {
  const first = row.starts_at.slice(0, 10);
  let end = row.ends_at.slice(0, 10);
  if (!DATE_ONLY.test(first) || !DATE_ONLY.test(end)) return null;
  // A same-day or inverted span would occupy nothing at all, which for an
  // all-day event means one day — not none.
  if (end <= first) end = addCalendarDays(first, 1);
  return finite({
    start: localToIso(first, "00:00", timezone),
    end: localToIso(end, "00:00", timezone),
  });
}

function timedSpan(row: StoredExternalEvent): BusyInterval | null {
  return finite({ start: row.starts_at, end: row.ends_at });
}

function finite(span: BusyInterval): BusyInterval | null {
  const start = new Date(span.start).getTime();
  const end = new Date(span.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/**
 * Trim busy time to the window being asked about.
 *
 * A cached busy set can span a year; a slot lookup asks about a week. Every
 * interval that survives is compared against every candidate slot, so the ones
 * that cannot touch the window are cost with no effect on the answer.
 */
export function clipToWindow(
  intervals: BusyInterval[],
  fromIso: string,
  toIso: string,
): BusyInterval[] {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return intervals;

  const out: BusyInterval[] = [];
  for (const interval of intervals) {
    const start = new Date(interval.start).getTime();
    const end = new Date(interval.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    // Clipped rather than merely filtered: a month-long "out of office" that
    // covers the whole window should block it, but there is no reason to carry
    // the other twenty-nine days.
    const clippedStart = Math.max(start, from);
    const clippedEnd = Math.min(end, to);
    if (clippedEnd <= clippedStart) continue;
    out.push({ start: new Date(clippedStart).toISOString(), end: new Date(clippedEnd).toISOString() });
  }
  return out;
}
