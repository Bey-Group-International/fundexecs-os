// lib/calendar/google.server.ts
// Talking to Google Calendar, and storing what comes back.
//
// The shape mirrors feeds.server.ts deliberately: reads serve the grid from
// cached rows, and refreshing happens outside the request that needs the
// answer. A member opening the week view must never wait on Google.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { decryptSecret, encryptSecret } from "@/lib/vault";
import { markerMeetingId } from "@/lib/calendar/google-write";
import { refreshAccessToken } from "@/lib/google-oauth";
import {
  SYNC_PAGE_SIZE,
  type GoogleCalendarListEntry,
  type GoogleEvent,
  type NormalizedEvent,
  decideSyncMode,
  describeGoogleError,
  isTombstone,
  normalizeCalendar,
  normalizeEvent,
  syncWindow,
} from "@/lib/calendar/google";

type Client = SupabaseClient<Database>;

const API = "https://www.googleapis.com/calendar/v3";
/** Google answers well under a second; a hung call must not stall a sweep. */
const FETCH_TIMEOUT_MS = 15_000;
/** Pages per calendar per sync. A runaway calendar cannot monopolize a sweep. */
const MAX_PAGES = 40;

export interface ConnectionRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  google_email: string | null;
  refresh_ciphertext: string;
  refresh_iv: string;
  refresh_auth_tag: string;
  last_sync_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
}

/** Encrypt a refresh token for storage. Mirrors org_secrets' column split. */
export function sealRefreshToken(token: string): {
  refresh_ciphertext: string;
  refresh_iv: string;
  refresh_auth_tag: string;
} {
  const { ciphertext, iv, authTag } = encryptSecret(token);
  return { refresh_ciphertext: ciphertext, refresh_iv: iv, refresh_auth_tag: authTag };
}

/** Recover a stored refresh token. Throws if the vault key no longer matches. */
export function openRefreshToken(row: Pick<ConnectionRow, "refresh_ciphertext" | "refresh_iv" | "refresh_auth_tag">): string {
  return decryptSecret({
    ciphertext: row.refresh_ciphertext,
    iv: row.refresh_iv,
    authTag: row.refresh_auth_tag,
  });
}

export interface GoogleCallResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** Google's 410: the sync cursor aged out and a full resync is due. */
  tokenExpired?: boolean;
}

/**
 * One authenticated GET against the Calendar API.
 *
 * Never throws. Every failure a third party can present resolves to a reason a
 * person can act on, because these run inside a cron sweep where an exception
 * would abandon every remaining calendar.
 */
async function apiGet<T>(accessToken: string, path: string, params: Record<string, string>): Promise<GoogleCallResult<T>> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (res.status === 410) {
      return { ok: false, error: describeGoogleError(410, ""), tokenExpired: true };
    }
    if (!res.ok) {
      // Bounded: an error body is not a place to spend memory.
      const body = (await res.text().catch(() => "")).slice(0, 500);
      return { ok: false, error: describeGoogleError(res.status, body) };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "TimeoutError";
    return { ok: false, error: aborted ? "Google Calendar did not respond in time." : "Could not reach Google Calendar." };
  }
}

/** Mint a short-lived access token for a connection. */
export async function accessTokenFor(conn: ConnectionRow): Promise<GoogleCallResult<string>> {
  try {
    const refresh = openRefreshToken(conn);
    const { accessToken } = await refreshAccessToken(refresh);
    return { ok: true, data: accessToken };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Google says invalid_grant when a user revokes access or changes their
    // password. connectionHealth matches on that word to tell the member to
    // reconnect rather than to wait.
    return { ok: false, error: /invalid_grant/i.test(message) ? `invalid_grant: ${message}` : message };
  }
}

interface CalendarListResponse {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
}

/** Every calendar this grant can see, followed across pages. */
export async function listCalendars(accessToken: string): Promise<GoogleCallResult<GoogleCalendarListEntry[]>> {
  const out: GoogleCalendarListEntry[] = [];
  let pageToken = "";

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await apiGet<CalendarListResponse>(accessToken, "/users/me/calendarList", {
      maxResults: "250",
      pageToken,
    });
    if (!res.ok) return { ok: false, error: res.error };
    out.push(...(res.data?.items ?? []));
    if (!res.data?.nextPageToken) break;
    pageToken = res.data.nextPageToken;
  }

  return { ok: true, data: out };
}

interface EventsResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface EventPage {
  events: GoogleEvent[];
  nextSyncToken: string | null;
}

/**
 * Events for one calendar, either everything in the window or only what changed.
 *
 * Google forbids sending a time window alongside a sync token — the token
 * already encodes what the caller has seen — so the two modes pass different
 * parameters rather than sharing one.
 */
export async function listEvents(
  accessToken: string,
  googleCalendarId: string,
  syncToken: string | null,
  now: Date = new Date(),
): Promise<GoogleCallResult<EventPage>> {
  const mode = decideSyncMode(syncToken);
  const events: GoogleEvent[] = [];
  let pageToken = "";
  let nextSyncToken: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> =
      mode.kind === "incremental"
        ? { syncToken: mode.syncToken, maxResults: String(SYNC_PAGE_SIZE), pageToken }
        : {
            ...syncWindow(now),
            maxResults: String(SYNC_PAGE_SIZE),
            pageToken,
            // Expand recurring series into instances, so the grid draws each
            // occurrence without this app re-implementing Google's RRULE rules.
            singleEvents: "true",
          };

    const res = await apiGet<EventsResponse>(
      accessToken,
      `/calendars/${encodeURIComponent(googleCalendarId)}/events`,
      params,
    );
    if (!res.ok) return { ok: false, error: res.error, tokenExpired: res.tokenExpired };

    events.push(...(res.data?.items ?? []));
    if (res.data?.nextSyncToken) nextSyncToken = res.data.nextSyncToken;
    if (!res.data?.nextPageToken) break;
    pageToken = res.data.nextPageToken;
  }

  return { ok: true, data: { events, nextSyncToken } };
}

export interface CalendarSyncSummary {
  upserted: number;
  deleted: number;
  skipped: number;
}

/**
 * Apply one calendar's event page to storage.
 *
 * Tombstones are deleted rather than stored: incremental sync reports a
 * deletion by re-sending the event with `status: "cancelled"`, and keeping
 * those is how a cancelled meeting stays on a calendar forever.
 */
/**
 * Of the events claiming to be ours, the ones we actually wrote.
 *
 * Ownership is the meeting row pointing back at the same Google event id. A
 * marker that names a meeting we never synced to that event is somebody else's
 * event wearing our key.
 *
 * Unconfirmable means NOT ours, deliberately. Wrongly storing an event shows a
 * duplicate, which is cosmetic; wrongly skipping one hides busy time, which
 * lets a member be double-booked.
 */
async function confirmOwnedEvents(client: Client, claimed: Map<string, string>): Promise<Set<string>> {
  const owned = new Set<string>();
  if (!claimed.size) return owned;

  const meetingIds = [...new Set(claimed.values())];
  const { data, error } = await client
    .from("live_meetings")
    .select("id, external_calendar_event_id")
    .in("id", meetingIds);

  if (error || !data) {
    console.error("[google-calendar] could not confirm event ownership", error?.message);
    return owned;
  }

  const eventIdByMeeting = new Map(
    (data as Array<{ id: string; external_calendar_event_id: string | null }>).map((r) => [
      r.id,
      r.external_calendar_event_id,
    ]),
  );

  for (const [googleEventId, meetingId] of claimed) {
    if (eventIdByMeeting.get(meetingId) === googleEventId) owned.add(googleEventId);
  }
  return owned;
}

export async function applyEvents(
  client: Client,
  calendarRowId: string,
  userId: string,
  events: GoogleEvent[],
): Promise<CalendarSyncSummary> {
  const summary: CalendarSyncSummary = { upserted: 0, deleted: 0, skipped: 0 };

  const tombstones: string[] = [];
  const rows: Array<Record<string, unknown>> = [];

  // Which marked events are genuinely ours, resolved once for the whole page.
  const claimed = new Map<string, string>();
  for (const event of events) {
    if (isTombstone(event)) continue;
    const meetingId = markerMeetingId(event);
    if (meetingId && event.id) claimed.set(event.id, meetingId);
  }
  const ours = await confirmOwnedEvents(client, claimed);

  for (const event of events) {
    if (isTombstone(event)) {
      if (event.id) tombstones.push(event.id);
      continue;
    }
    // Our own writes come straight back down this pipe. Storing them would show
    // every pushed meeting twice — once as itself and once as an "external"
    // event — and the copy would then count against the member's availability,
    // so every FundExecs meeting would block the time it already occupies.
    //
    // The marker alone is not proof: extendedProperties.private is writable by
    // any integration with access to the calendar, so a foreign event carrying
    // our key would be hidden from availability and invite a double-booking.
    // Only an event this app recorded against that meeting is skipped.
    if (event.id && ours.has(event.id)) {
      summary.skipped++;
      continue;
    }
    const normalized = normalizeEvent(event);
    if (!normalized) {
      summary.skipped++;
      continue;
    }
    rows.push(toRow(calendarRowId, userId, normalized));
  }

  if (tombstones.length) {
    const { error } = await client
      .from("external_events")
      .delete()
      .eq("calendar_id", calendarRowId)
      .in("google_event_id", tombstones);
    if (error) console.error("[google-calendar] tombstone delete failed", error);
    else summary.deleted = tombstones.length;
  }

  if (rows.length) {
    // Chunked: a first sync of a busy calendar can carry thousands of events,
    // and one oversized statement is how a sync dies at the last row.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await client
        .from("external_events")
        .upsert(chunk as never, { onConflict: "calendar_id,google_event_id" });
      if (error) console.error("[google-calendar] event upsert failed", error);
      else summary.upserted += chunk.length;
    }
  }

  return summary;
}

function toRow(calendarRowId: string, userId: string, e: NormalizedEvent): Record<string, unknown> {
  return {
    calendar_id: calendarRowId,
    user_id: userId,
    google_event_id: e.googleEventId,
    ical_uid: e.icalUid,
    summary: e.summary,
    description: e.description,
    location: e.location,
    html_link: e.htmlLink,
    starts_at: e.startsAt,
    ends_at: e.endsAt,
    is_all_day: e.isAllDay,
    status: e.status,
    transparency: e.transparency,
    recurring_event_id: e.recurringEventId,
    etag: e.etag,
    google_updated_at: e.googleUpdatedAt,
    updated_at: new Date().toISOString(),
  };
}

/** Store the calendar list, preserving each calendar's local show/hide choice. */
export async function applyCalendarList(
  client: Client,
  connectionId: string,
  userId: string,
  entries: GoogleCalendarListEntry[],
): Promise<number> {
  const rows = entries
    .filter((e) => !e.deleted)
    .map(normalizeCalendar)
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => ({
      connection_id: connectionId,
      user_id: userId,
      google_calendar_id: c.googleCalendarId,
      summary: c.summary,
      description: c.description,
      time_zone: c.timeZone,
      background_color: c.backgroundColor,
      foreground_color: c.foregroundColor,
      access_role: c.accessRole,
      is_primary: c.isPrimary,
      updated_at: new Date().toISOString(),
    }));

  if (!rows.length) return 0;

  // Note the absence of is_visible and blocks_availability: those are the
  // member's choices, and a routine sync must not silently re-tick a box they
  // deliberately cleared.
  const { error } = await client
    .from("google_calendars")
    .upsert(rows as never, { onConflict: "connection_id,google_calendar_id" });
  if (error) {
    console.error("[google-calendar] calendar list upsert failed", error);
    return 0;
  }
  return rows.length;
}

export interface ConnectionSyncSummary {
  calendars: number;
  upserted: number;
  deleted: number;
  skipped: number;
  failed: number;
}

/**
 * Sync one member's connection: refresh the calendar list, then each calendar's
 * events.
 *
 * A single calendar failing does not abandon the rest — one shared calendar the
 * member lost access to should not stop their own from syncing.
 */
export async function syncConnection(
  client: Client,
  conn: ConnectionRow,
  now: Date = new Date(),
): Promise<ConnectionSyncSummary> {
  const summary: ConnectionSyncSummary = { calendars: 0, upserted: 0, deleted: 0, skipped: 0, failed: 0 };

  const token = await accessTokenFor(conn);
  if (!token.ok || !token.data) {
    await recordConnectionResult(client, conn.id, false, token.error, now);
    summary.failed++;
    return summary;
  }
  const accessToken = token.data;

  const list = await listCalendars(accessToken);
  if (!list.ok) {
    await recordConnectionResult(client, conn.id, false, list.error, now);
    summary.failed++;
    return summary;
  }
  summary.calendars = await applyCalendarList(client, conn.id, conn.user_id, list.data ?? []);

  const { data: calendars, error } = await client
    .from("google_calendars")
    .select("id, google_calendar_id, sync_token")
    .eq("connection_id", conn.id);
  if (error) {
    await recordConnectionResult(client, conn.id, false, error.message, now);
    summary.failed++;
    return summary;
  }

  for (const cal of (calendars ?? []) as Array<{ id: string; google_calendar_id: string; sync_token: string | null }>) {
    let page = await listEvents(accessToken, cal.google_calendar_id, cal.sync_token, now);

    // A 410 is routine: the cursor aged out and Google can no longer express
    // the delta. Drop it and take the whole window once, rather than treating
    // it as a failure and leaving the calendar frozen.
    if (!page.ok && page.tokenExpired) {
      await client.from("google_calendars").update({ sync_token: null } as never).eq("id", cal.id);
      page = await listEvents(accessToken, cal.google_calendar_id, null, now);
    }

    if (!page.ok || !page.data) {
      summary.failed++;
      continue;
    }

    const applied = await applyEvents(client, cal.id, conn.user_id, page.data.events);
    summary.upserted += applied.upserted;
    summary.deleted += applied.deleted;
    summary.skipped += applied.skipped;

    await client
      .from("google_calendars")
      .update({
        sync_token: page.data.nextSyncToken,
        last_synced_at: now.toISOString(),
        updated_at: now.toISOString(),
      } as never)
      .eq("id", cal.id);
  }

  // Any calendar failing counts the connection as failed, so a member whose
  // grant is half-broken sees it rather than a reassuring green tick.
  await recordConnectionResult(client, conn.id, summary.failed === 0, null, now);
  return summary;
}

/** Persist the outcome of a sync against a connection. */
export async function recordConnectionResult(
  client: Client,
  connectionId: string,
  ok: boolean,
  error: string | null | undefined,
  now: Date = new Date(),
): Promise<void> {
  const stamp = now.toISOString();
  const patch = ok
    ? { last_sync_at: stamp, last_error: null, consecutive_failures: 0, updated_at: stamp }
    : { last_error: error ?? "Unknown error", updated_at: stamp };

  const { error: updateError } = await client
    .from("google_calendar_connections")
    .update(patch as never)
    .eq("id", connectionId);
  if (updateError) console.error("[google-calendar] failed to record sync result", updateError);

  if (!ok) {
    try {
      const { error: rpcError } = await client.rpc("increment_google_calendar_failures", {
        connection_id: connectionId,
      });
      if (rpcError) console.error("[google-calendar] failure count not incremented", rpcError);
    } catch (err) {
      console.error("[google-calendar] failure count not incremented", err);
    }
  }
}

/**
 * Busy intervals from connected Google calendars, for availability.
 *
 * Reads cache only, exactly as the ICS path does: a booking-page visitor asking
 * for slots must never wait on Google. Transparent ("free") events and
 * calendars the member excluded are left out.
 */
export async function googleBusyForUser(
  client: Client,
  userId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<Array<{ start: string; end: string }>> {
  try {
    const { data, error } = await client
      .from("external_events")
      .select("starts_at, ends_at, transparency, status, google_calendars!inner(blocks_availability)")
      .eq("user_id", userId)
      .eq("google_calendars.blocks_availability", true)
      .lt("starts_at", windowEnd.toISOString())
      .gt("ends_at", windowStart.toISOString())
      .limit(2000);
    if (error) throw new Error(error.message);

    return ((data ?? []) as Array<{ starts_at: string; ends_at: string; transparency: string | null; status: string | null }>)
      .filter((r) => r.status !== "cancelled" && r.transparency !== "transparent")
      .map((r) => ({ start: r.starts_at, end: r.ends_at }));
  } catch (err) {
    // Availability must still resolve. Losing busy time can permit a
    // double-booking, so this is logged loudly rather than swallowed.
    console.error("[google-calendar] busy lookup failed for user", userId, err);
    return [];
  }
}

export interface SweepSummary {
  connections: number;
  upserted: number;
  deleted: number;
  failed: number;
}

/**
 * Sync connections that have not been refreshed recently. Driven by cron, and
 * by a member's explicit "sync now".
 *
 * Stalest first, so a backlog drains fairly rather than starving whoever sorts
 * last. Bounded per sweep: one member with a decade of history must not consume
 * the whole run.
 */
export async function syncStaleGoogleConnections(
  client: Client,
  opts: { userId?: string; limit?: number; now?: Date } = {},
): Promise<SweepSummary> {
  const now = opts.now ?? new Date();
  const summary: SweepSummary = { connections: 0, upserted: 0, deleted: 0, failed: 0 };

  let query = client
    .from("google_calendar_connections")
    .select(
      "id, user_id, organization_id, google_email, refresh_ciphertext, refresh_iv, refresh_auth_tag, last_sync_at, last_error, consecutive_failures",
    )
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit ?? 25);
  if (opts.userId) query = query.eq("user_id", opts.userId);

  const { data, error } = await query;
  if (error) {
    console.error("[google-calendar] sweep query failed", error);
    return summary;
  }

  for (const conn of (data ?? []) as ConnectionRow[]) {
    const result = await syncConnection(client, conn, now);
    summary.connections++;
    summary.upserted += result.upserted;
    summary.deleted += result.deleted;
    summary.failed += result.failed;
  }

  return summary;
}
