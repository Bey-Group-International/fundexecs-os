// lib/calendar/google.ts
// Rules for Google Calendar sync. Pure — the HTTP and storage live in
// google.server.ts, so everything decided here is directly testable.
//
// The shapes below are the subset of Google's Calendar v3 responses this app
// depends on. Deliberately narrow: a field we do not read is a field that
// cannot surprise us when Google changes it.

/** How far back and forward a calendar is synced. */
export const SYNC_PAST_DAYS = 60;
export const SYNC_FUTURE_DAYS = 365;
/** Page size for event listing. Google caps at 2500. */
export const SYNC_PAGE_SIZE = 250;
/** Failures in a row before the UI calls a connection broken. */
export const CONNECTION_FAILURE_ALERT_THRESHOLD = 3;

export interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  timeZone?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
  deleted?: boolean;
}

export interface GoogleEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  transparency?: string;
  recurringEventId?: string;
  etag?: string;
  updated?: string;
  /** Carries our marker on events this app wrote. See google-write.ts. */
  extendedProperties?: { private?: Record<string, string> };
}

export interface NormalizedCalendar {
  googleCalendarId: string;
  summary: string;
  description: string | null;
  timeZone: string | null;
  backgroundColor: string | null;
  foregroundColor: string | null;
  accessRole: string | null;
  isPrimary: boolean;
}

export interface NormalizedEvent {
  googleEventId: string;
  icalUid: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  htmlLink: string | null;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  status: string | null;
  transparency: string | null;
  recurringEventId: string | null;
  etag: string | null;
  googleUpdatedAt: string | null;
}

/**
 * A calendar-list entry reduced to what we store.
 *
 * `summaryOverride` wins over `summary`: it is the name the member gave the
 * calendar in their own list, and showing Google's original name for a calendar
 * they renamed would read as the wrong calendar.
 */
export function normalizeCalendar(entry: GoogleCalendarListEntry): NormalizedCalendar | null {
  if (!entry?.id) return null;
  return {
    googleCalendarId: entry.id,
    summary: (entry.summaryOverride || entry.summary || "Calendar").slice(0, 200),
    description: entry.description ?? null,
    timeZone: entry.timeZone ?? null,
    backgroundColor: normalizeHexColor(entry.backgroundColor),
    foregroundColor: normalizeHexColor(entry.foregroundColor),
    accessRole: entry.accessRole ?? null,
    isPrimary: Boolean(entry.primary),
  };
}

/**
 * Colors go straight into a style attribute, so anything that is not plainly a
 * hex color is dropped rather than trusted. Google sends `#0b8043`; a value
 * that does not look like that has no business reaching the DOM.
 */
export function normalizeHexColor(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * A Google event reduced to what the grid draws.
 *
 * Returns null for anything unusable — no id, no resolvable times — rather than
 * inventing a time. An event drawn at the wrong hour is worse than one missing.
 */
export function normalizeEvent(event: GoogleEvent): NormalizedEvent | null {
  if (!event?.id) return null;

  const start = resolveDateTime(event.start);
  const end = resolveDateTime(event.end);
  if (!start || !end) return null;
  // Zero-length and inverted events occupy nothing and would render as a
  // sliver or a negative box.
  if (end.iso <= start.iso) return null;

  return {
    googleEventId: event.id,
    icalUid: event.iCalUID ?? null,
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    htmlLink: event.htmlLink ?? null,
    startsAt: start.iso,
    endsAt: end.iso,
    isAllDay: start.isAllDay,
    status: event.status ?? null,
    transparency: event.transparency ?? null,
    recurringEventId: event.recurringEventId ?? null,
    etag: event.etag ?? null,
    googleUpdatedAt: event.updated ?? null,
  };
}

/**
 * Google gives a timed event `dateTime` (an instant) and an all-day event
 * `date` (a calendar day, no zone). A bare date is anchored at UTC midnight —
 * the grid treats all-day events as banners rather than placing them on the
 * hour rail, so the instant only has to sort correctly, not display.
 */
function resolveDateTime(value: GoogleEventDateTime | undefined): { iso: string; isAllDay: boolean } | null {
  if (!value) return null;

  if (typeof value.dateTime === "string") {
    const t = new Date(value.dateTime);
    if (isNaN(t.getTime())) return null;
    return { iso: t.toISOString(), isAllDay: false };
  }

  if (typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
    const t = new Date(`${value.date}T00:00:00.000Z`);
    if (isNaN(t.getTime())) return null;
    return { iso: t.toISOString(), isAllDay: true };
  }

  return null;
}

/**
 * Whether an event should be removed rather than stored.
 *
 * Incremental sync delivers deletions as tombstones — the event still arrives,
 * carrying `status: "cancelled"`. Treating that as an ordinary event is how a
 * cancelled meeting stays on someone's calendar forever.
 */
export function isTombstone(event: GoogleEvent): boolean {
  return event?.status === "cancelled";
}

/**
 * Whether an event occupies its owner, for availability purposes.
 *
 * `transparent` is Google's "show me as free" — a visible event that is not a
 * conflict. Declined invitations are the same idea from the other direction,
 * but Google reports those per-attendee, so they are handled at the query.
 */
export function blocksTime(event: Pick<NormalizedEvent, "transparency" | "status">): boolean {
  if (event.status === "cancelled") return false;
  return event.transparency !== "transparent";
}

export interface SyncWindow {
  timeMin: string;
  timeMax: string;
}

/** The window a full sync covers. Incremental syncs ignore it, by Google's rule. */
export function syncWindow(now: Date = new Date()): SyncWindow {
  return {
    timeMin: new Date(now.getTime() - SYNC_PAST_DAYS * 86_400_000).toISOString(),
    timeMax: new Date(now.getTime() + SYNC_FUTURE_DAYS * 86_400_000).toISOString(),
  };
}

export type SyncMode =
  | { kind: "incremental"; syncToken: string }
  | { kind: "full"; reason: "no_token" | "token_expired" };

/**
 * Which kind of sync to run.
 *
 * Google expires sync tokens (410 GONE) whenever it cannot express the delta —
 * after long gaps, or when a calendar's settings change. That is routine, not
 * an error: the answer is to drop the token and resync in full.
 */
export function decideSyncMode(syncToken: string | null, tokenExpired = false): SyncMode {
  if (tokenExpired) return { kind: "full", reason: "token_expired" };
  if (syncToken) return { kind: "incremental", syncToken };
  return { kind: "full", reason: "no_token" };
}

export interface ConnectionHealth {
  state: "ok" | "never_synced" | "stale" | "failing" | "reauth_required";
  message: string | null;
}

/**
 * How a connection should be described to its owner.
 *
 * A revoked grant is called out separately from a run of failures: they need
 * different actions from the member (reconnect vs wait), and telling someone to
 * wait when Google has revoked their token wastes their day.
 */
export function connectionHealth(conn: {
  lastSyncAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}): ConnectionHealth {
  if (conn.lastError && /invalid_grant|unauthorized|revoked/i.test(conn.lastError)) {
    return {
      state: "reauth_required",
      message: "Google revoked this connection. Reconnect to resume syncing.",
    };
  }
  if (conn.consecutiveFailures >= CONNECTION_FAILURE_ALERT_THRESHOLD) {
    return {
      state: "failing",
      message: conn.lastError ? `Not syncing: ${conn.lastError}` : "Not syncing.",
    };
  }
  if (!conn.lastSyncAt) return { state: "never_synced", message: "Waiting for its first sync." };

  const age = Date.now() - new Date(conn.lastSyncAt).getTime();
  if (Number.isFinite(age) && age > 6 * 3_600_000) {
    return { state: "stale", message: "Last synced more than six hours ago." };
  }
  return { state: "ok", message: null };
}

/**
 * Readable text for a Google API failure.
 *
 * The raw body is JSON a member cannot act on. This keeps the machine-readable
 * reason where code can match it (connectionHealth reads `invalid_grant`) while
 * giving a person something to do.
 */
export function describeGoogleError(status: number, body: string): string {
  if (status === 401) return "invalid_grant: Google rejected the credentials.";
  if (status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(body)) {
    return "Google is rate-limiting this connection.";
  }
  if (status === 403) return "Google refused the request — the grant may be missing a scope.";
  if (status === 404) return "That calendar no longer exists.";
  if (status === 410) return "token_expired: the sync cursor aged out.";
  if (status >= 500) return "Google Calendar is having trouble.";
  return `Google returned ${status}.`;
}
