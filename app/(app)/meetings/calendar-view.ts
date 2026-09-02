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
