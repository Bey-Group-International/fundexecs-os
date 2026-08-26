// lib/calendar/google-write.ts
// Turning a FundExecs meeting into a Google Calendar event, and deciding
// whether it should be written at all.
//
// Pure: no fetch, no Supabase. The shape of the request body and every rule
// about when to create, update, delete or stand well back lives here, so the
// awkward parts — an echo coming back through the read sync, a meeting whose
// guest list is half nonsense, a duration Google would reject — are testable
// without a network.

/** Marks an event as ours, so the read sync can tell an echo from a real event. */
export const FUNDEXECS_MARKER_KEY = "fundexecsMeetingId";

/** Google rejects an event whose end is not after its start. */
export const MIN_EVENT_MINUTES = 1;

/** Google caps a single event's guest list well above anything we send. */
export const MAX_ATTENDEES = 100;

export interface WritableMeeting {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  meeting_url: string | null;
  objective: string | null;
  agenda: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  timezone: string | null;
  calendar_visibility: string | null;
  reminder_minutes: number | null;
  attendees: Array<{ name?: string; email?: string; type?: string }> | null;
  is_draft: boolean | null;
  locked_at: string | null;
  deleted_at?: string | null;
  external_calendar_event_id: string | null;
  external_calendar_sync_enabled: boolean | null;
  external_calendar_provider: string | null;
}

export interface GoogleEventWrite {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string }>;
  visibility?: "default" | "public" | "private";
  reminders?: { useDefault: boolean; overrides?: Array<{ method: "popup"; minutes: number }> };
  extendedProperties: { private: Record<string, string> };
}

export type WriteAction =
  | { kind: "create" }
  | { kind: "update"; eventId: string }
  | { kind: "delete"; eventId: string }
  | { kind: "skip"; reason: string };

/**
 * What should happen to this meeting on Google.
 *
 * Ordered so the cheapest and most certain refusals come first. A draft has
 * never been committed to, and pushing one would put a half-written meeting on
 * a real calendar — including, once guests are attached, in other people's
 * inboxes.
 */
export function decideWrite(meeting: WritableMeeting, opts: { connected: boolean }): WriteAction {
  const existing = meeting.external_calendar_event_id?.trim() || null;

  // A meeting that is gone, or has had sync switched off, should leave nothing
  // behind: if we put an event on the calendar, we take it back off.
  const shouldExist =
    opts.connected &&
    meeting.external_calendar_sync_enabled === true &&
    !meeting.deleted_at &&
    !meeting.is_draft &&
    Boolean(meeting.scheduled_at);

  if (!shouldExist) {
    if (existing && !isLegacyStubId(existing)) return { kind: "delete", eventId: existing };
    if (!opts.connected) return { kind: "skip", reason: "No Google calendar is connected." };
    if (meeting.external_calendar_sync_enabled !== true) return { kind: "skip", reason: "Sync is off for this meeting." };
    if (meeting.deleted_at) return { kind: "skip", reason: "Meeting was deleted." };
    if (meeting.is_draft) return { kind: "skip", reason: "Draft meetings are not pushed." };
    return { kind: "skip", reason: "Meeting has no scheduled time." };
  }

  // A stub id was never a Google event. Earlier builds minted `ext_<uuid>` and
  // marked the meeting "synced" without calling anything, so treating one as an
  // event id would send a PATCH for something that does not exist. Create
  // instead, and let the real id replace it.
  if (existing && !isLegacyStubId(existing)) return { kind: "update", eventId: existing };
  return { kind: "create" };
}

/**
 * Whether an id came from the old placeholder sync rather than Google.
 *
 * Those rows claim to be synced and are not; the only safe reading of one is
 * "no event exists yet".
 */
export function isLegacyStubId(eventId: string | null | undefined): boolean {
  return typeof eventId === "string" && eventId.startsWith("ext_");
}

/** A plausible email, lowercased. Google rejects the whole event over a bad one. */
export function normalizeAttendeeEmail(raw: string | undefined | null): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  // Deliberately conservative: one @, something either side, a dot in the host,
  // and no whitespace. This is a filter to protect the request, not validation.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) return null;
  return value;
}

/** Guests to invite, deduplicated and capped. */
export function attendeesFor(meeting: WritableMeeting): Array<{ email: string; displayName?: string }> {
  const seen = new Set<string>();
  const out: Array<{ email: string; displayName?: string }> = [];

  for (const a of meeting.attendees ?? []) {
    const email = normalizeAttendeeEmail(a?.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const displayName = a?.name?.trim();
    out.push(displayName ? { email, displayName } : { email });
    if (out.length >= MAX_ATTENDEES) break;
  }

  return out;
}

/**
 * The event body Google gets.
 *
 * The description is assembled rather than passed through: what someone needs
 * from a calendar entry is why they are there and how to join, and those live
 * in separate columns here.
 */
export function toGoogleEvent(meeting: WritableMeeting, opts: { joinUrl?: string | null } = {}): GoogleEventWrite {
  const startIso = meeting.scheduled_at;
  if (!startIso) throw new Error("Cannot build a Google event for an unscheduled meeting");
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) throw new Error("Cannot build a Google event from an invalid start time");

  const minutes = clampDuration(meeting.duration_minutes);
  const end = new Date(start.getTime() + minutes * 60_000);

  const body: GoogleEventWrite = {
    summary: meeting.title?.trim() || "Meeting",
    start: { dateTime: start.toISOString(), ...(meeting.timezone ? { timeZone: meeting.timezone } : {}) },
    end: { dateTime: end.toISOString(), ...(meeting.timezone ? { timeZone: meeting.timezone } : {}) },
    // The marker is the whole echo-prevention story: the read sync pulls every
    // event on the calendar back down, and without a way to recognise our own
    // writes each pushed meeting would return as a second, external copy of
    // itself — and then count against the member's own availability.
    extendedProperties: { private: { [FUNDEXECS_MARKER_KEY]: meeting.id } },
  };

  const description = buildDescription(meeting, opts.joinUrl ?? meeting.meeting_url ?? null);
  if (description) body.description = description;

  const location = meeting.location?.trim() || opts.joinUrl?.trim() || meeting.meeting_url?.trim();
  if (location) body.location = location;

  const guests = attendeesFor(meeting);
  if (guests.length) body.attendees = guests;

  const visibility = mapVisibility(meeting.calendar_visibility);
  if (visibility) body.visibility = visibility;

  const reminder = meeting.reminder_minutes;
  if (typeof reminder === "number" && Number.isFinite(reminder) && reminder > 0) {
    body.reminders = { useDefault: false, overrides: [{ method: "popup", minutes: Math.min(40_320, Math.trunc(reminder)) }] };
  }

  return body;
}

/** Google accepts 15 minutes to 8 hours here, matching what the API already clamps to. */
export function clampDuration(minutes: number | null | undefined): number {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return 60;
  return Math.min(480, Math.max(MIN_EVENT_MINUTES, Math.trunc(n)));
}

/** Our visibility values, in Google's vocabulary. Anything unknown means default. */
export function mapVisibility(value: string | null | undefined): "default" | "public" | "private" | null {
  switch ((value ?? "").trim().toLowerCase()) {
    case "public":
      return "public";
    case "private":
    case "confidential":
      return "private";
    case "default":
    case "":
      return null;
    default:
      return null;
  }
}

/** The description body: why, then what, then how to join. */
export function buildDescription(meeting: WritableMeeting, joinUrl: string | null): string {
  const parts: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    const v = value?.trim();
    if (v) parts.push(`${label}:\n${v}`);
  };

  const desc = meeting.description?.trim();
  if (desc) parts.push(desc);
  push("Objective", meeting.objective);
  push("Agenda", meeting.agenda);
  if (joinUrl?.trim()) parts.push(`Join: ${joinUrl.trim()}`);

  return parts.join("\n\n");
}

/**
 * Whether an event Google handed back is one of ours.
 *
 * Used on the read path to drop echoes before they become external events.
 */
export function markerMeetingId(event: {
  extendedProperties?: { private?: Record<string, string> };
}): string | null {
  const value = event?.extendedProperties?.private?.[FUNDEXECS_MARKER_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type WriteOutcome = "synced" | "sync_failed" | "sync_off" | "not_connected" | "sync_pending";

/**
 * What a Google response means for the meeting's stored sync status.
 *
 * 404 and 410 are not failures worth alarming anyone about: the event is gone
 * from Google's side, usually because someone deleted it there. The right
 * response is to forget the id and write a fresh event next time.
 */
export function outcomeForStatus(status: number): { outcome: WriteOutcome; forgetEventId: boolean; retryable: boolean } {
  if (status >= 200 && status < 300) return { outcome: "synced", forgetEventId: false, retryable: false };
  if (status === 404 || status === 410) return { outcome: "sync_pending", forgetEventId: true, retryable: true };
  if (status === 401 || status === 403) return { outcome: "sync_failed", forgetEventId: false, retryable: false };
  if (status === 429 || status >= 500) return { outcome: "sync_pending", forgetEventId: false, retryable: true };
  return { outcome: "sync_failed", forgetEventId: false, retryable: false };
}
