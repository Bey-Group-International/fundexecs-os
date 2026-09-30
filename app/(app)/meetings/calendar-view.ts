/**
 * URL state for the Meetings calendar overlay.
 *
 * The overlay used to be pure component state, which meant the calendar had no
 * address: it couldn't be linked to, it evaporated on refresh, and Back walked
 * off the Meetings page entirely instead of closing the full-screen panel. It
 * now lives at `/meetings?view=calendar` (and `?view=settings` for connected
 * calendars and blocked time), so a member can bookmark it, reload into it, and
 * back out of it.
 *
 * Kept separate from the component so the parsing and URL-building rules are
 * testable without mounting the overlay.
 */

export type CalendarView = "calendar" | "settings";

export const CALENDAR_VIEW_PARAM = "view";

/**
 * Narrow a raw query-string value to a pane. Anything unrecognised (a typo, a
 * stale link, a param meant for something else) reads as "closed" rather than
 * throwing a member into a panel they didn't ask for.
 */
export function parseCalendarView(value: string | null | undefined): CalendarView | null {
  return value === "calendar" || value === "settings" ? value : null;
}

/**
 * Build the URL for a given overlay state. Other params are preserved — the
 * overlay is a layer over the Meetings page, not a replacement for its state.
 * Passing `null` closes it.
 */
export function calendarViewUrl(
  pathname: string,
  params: URLSearchParams | string,
  view: CalendarView | null,
): string {
  const next = new URLSearchParams(typeof params === "string" ? params : params.toString());
  if (view) next.set(CALENDAR_VIEW_PARAM, view);
  else next.delete(CALENDAR_VIEW_PARAM);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Where a meeting booked from "Schedule for later" starts unless somebody
 * changes it: the next :00 or :30 that is at least half an hour away. "An hour
 * from now" to the minute gave 2:37 PM, a time nobody books.
 */
export function nextSchedulableStart(now: Date): Date {
  const earliest = new Date(now.getTime() + 30 * 60_000);
  earliest.setSeconds(0, 0);
  const minutes = earliest.getMinutes();
  if (minutes === 0 || minutes === 30) return earliest;
  earliest.setMinutes(minutes < 30 ? 30 : 60);
  return earliest;
}

/** Remembered per browser: whether the calendar's side panel is showing. */
export const CALENDAR_RAIL_KEY = "fx.meetings.calendar.rail";

/** Older than this, a Google copy is refreshed when the calendar opens. */
export const GOOGLE_FRESH_MS = 10 * 60_000;

/** Whether a connected Google calendar's stored copy is too old to trust. */
export function isGoogleCopyStale(connected: boolean, syncedAt: string | null, now: number): boolean {
  if (!connected) return false;
  if (!syncedAt) return true;
  const at = new Date(syncedAt).getTime();
  return !Number.isFinite(at) || now - at > GOOGLE_FRESH_MS;
}
