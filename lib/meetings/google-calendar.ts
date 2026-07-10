// lib/meetings/google-calendar.ts
// One-way "write to Google Calendar" for the FundExecs scheduler: build a
// Google Calendar event-template URL from a meeting. Opening the URL creates
// (or lets the user confirm) the event on their Google Calendar — a real,
// credential-free push that works for any signed-in Google user.
//
// A future increment can upgrade this to a silent server-side push via the
// Google Calendar API once OAuth client credentials are configured; this pure
// builder stays the shared source of the event shape either way.

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date as a Google Calendar UTC datetime: YYYYMMDDTHHmmssZ. */
export function toGCalDate(d: Date): string {
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    "00Z"
  );
}

export interface GoogleCalendarEventInput {
  title: string;
  startIso: string;
  durationMinutes?: number | null;
  details?: string | null;
  location?: string | null;
  /** Guest emails to pre-add via the `add` parameter. */
  guests?: string[];
}

/**
 * Build a Google Calendar template URL (action=TEMPLATE). Returns null when the
 * start time is invalid so callers can hide the affordance rather than link to
 * a broken template.
 */
export function buildGoogleCalendarTemplateUrl(input: GoogleCalendarEventInput): string | null {
  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + (input.durationMinutes ?? 60) * 60_000);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title || "Meeting",
    dates: `${toGCalDate(start)}/${toGCalDate(end)}`,
  });
  if (input.details) params.set("details", input.details);
  if (input.location) params.set("location", input.location);
  const guests = (input.guests ?? []).filter((g) => g && g.includes("@"));
  if (guests.length > 0) params.set("add", guests.join(","));

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
