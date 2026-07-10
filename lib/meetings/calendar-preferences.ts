// lib/meetings/calendar-preferences.ts
// Calendar display preferences for the FundExecs scheduler, mirroring the
// institutional Google Calendar defaults (America/Chicago, 60-minute meetings,
// week starts Sunday, MDY dates, 12-hour clock, weekends + declined shown).
//
// Pure and side-effect free so the schedule form, the Agenda view, and the API
// layer can share one source of truth and it stays unit-testable.

export type DateOrder = "MDY" | "DMY" | "YMD";

export interface CalendarPreferences {
  /** IANA time zone used to group and format events. */
  timezone: string;
  /** Default meeting length applied by the scheduler. */
  defaultDurationMinutes: number;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1;
  dateOrder: DateOrder;
  /** true → 12-hour clock with AM/PM. */
  hour12: boolean;
  showWeekends: boolean;
  showDeclined: boolean;
}

export const CALENDAR_DEFAULTS: CalendarPreferences = {
  timezone: "America/Chicago",
  defaultDurationMinutes: 60,
  weekStartsOn: 0,
  dateOrder: "MDY",
  hour12: true,
  showWeekends: true,
  showDeclined: true,
};

/** YYYY-MM-DD for `iso` as observed in `timezone` (stable grouping key). */
export function zonedDateKey(iso: string, timezone: string): string {
  // en-CA yields ISO-ordered YYYY-MM-DD, which we can use directly as a key.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Wall-clock time, e.g. "9:52 PM" (hour12) or "21:52" (24h), in the zone. */
export function formatClock(iso: string, prefs: CalendarPreferences = CALENDAR_DEFAULTS): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: prefs.timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: prefs.hour12,
  }).format(new Date(iso));
}

/** 0 (Sun) – 6 (Sat) weekday of `iso` in the zone. */
export function zonedWeekday(iso: string, timezone: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(
    new Date(iso),
  );
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

export function isWeekend(iso: string, prefs: CalendarPreferences = CALENDAR_DEFAULTS): boolean {
  const d = zonedWeekday(iso, prefs.timezone);
  return d === 0 || d === 6;
}

/**
 * Google-Calendar-style day heading: "Today" / "Tomorrow" for the near days,
 * otherwise a weekday + month/day label like "Thu, Jul 9".
 */
export function formatDayHeading(
  iso: string,
  prefs: CalendarPreferences = CALENDAR_DEFAULTS,
  now: number = Date.now(),
): string {
  const key = zonedDateKey(iso, prefs.timezone);
  const todayKey = zonedDateKey(new Date(now).toISOString(), prefs.timezone);
  const tomorrowKey = zonedDateKey(new Date(now + 86_400_000).toISOString(), prefs.timezone);
  if (key === todayKey) return "Today";
  if (key === tomorrowKey) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: prefs.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export interface AgendaGroup<T> {
  /** YYYY-MM-DD zone key — stable and sortable. */
  key: string;
  heading: string;
  items: T[];
}

/**
 * Group scheduled items into ordered day buckets for the Agenda view. Items
 * without a time are dropped; weekend days are omitted when showWeekends is
 * false. Days and the items within them are returned in chronological order.
 */
export function groupByDay<T extends { scheduled_at: string | null }>(
  items: T[],
  prefs: CalendarPreferences = CALENDAR_DEFAULTS,
  now: number = Date.now(),
): Array<AgendaGroup<T>> {
  const buckets = new Map<string, { iso: string; items: T[] }>();
  for (const item of items) {
    if (!item.scheduled_at) continue;
    if (!prefs.showWeekends && isWeekend(item.scheduled_at, prefs)) continue;
    const key = zonedDateKey(item.scheduled_at, prefs.timezone);
    const bucket = buckets.get(key) ?? { iso: item.scheduled_at, items: [] };
    bucket.items.push(item);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, { iso, items: dayItems }]) => ({
      key,
      heading: formatDayHeading(iso, prefs, now),
      items: dayItems.sort(
        (a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime(),
      ),
    }));
}
