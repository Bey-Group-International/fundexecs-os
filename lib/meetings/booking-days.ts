// lib/meetings/booking-days.ts
// The host's list of bookings, read the way a diary is: under "Today",
// "Tomorrow" and then the date, in the host's own zone.
//
// Pure: no React, no Supabase.

import { dateInTimezone, formatSlotDate, formatSlotTime } from "@/lib/meetings/scheduling";

/** "2026-11-06" plus a number of days, as a calendar date. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Today", "Tomorrow", or the date, for an instant in a zone. */
export function bookingDayLabel(iso: string, timezone: string, now: Date): string {
  const day = dateInTimezone(new Date(iso), timezone);
  const today = dateInTimezone(now, timezone);
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return formatSlotDate(iso, timezone);
}

/**
 * Bookings in days, in time order, each day labelled.
 *
 * Takes anything with a `startsAt`, so the host card can pass its own rows.
 */
export function bookingsByDay<T extends { startsAt: string }>(
  bookings: readonly T[],
  timezone: string,
  now: Date,
): Array<{ label: string; bookings: T[] }> {
  const sorted = [...bookings].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const out: Array<{ key: string; label: string; bookings: T[] }> = [];
  for (const booking of sorted) {
    const key = dateInTimezone(new Date(booking.startsAt), timezone);
    const last = out[out.length - 1];
    if (last && last.key === key) last.bookings.push(booking);
    else out.push({ key, label: bookingDayLabel(booking.startsAt, timezone, now), bookings: [booking] });
  }
  return out.map(({ label, bookings: list }) => ({ label, bookings: list }));
}

/** "Today 2:00 PM", "Tomorrow 9:30 AM", "Thursday, November 12, 2026 4:00 PM": when the next one is. */
export function nextBookingLabel(bookings: readonly { startsAt: string }[], timezone: string, now: Date): string | null {
  const upcoming = bookings
    .map((b) => b.startsAt)
    .filter((iso) => new Date(iso).getTime() >= now.getTime())
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
  if (!upcoming) return null;
  return `${bookingDayLabel(upcoming, timezone, now)} ${formatSlotTime(upcoming, timezone)}`;
}
