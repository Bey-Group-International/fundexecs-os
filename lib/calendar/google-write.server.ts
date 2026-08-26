// lib/calendar/google-write.server.ts
// Pushing a FundExecs meeting onto the member's Google calendar.
//
// The counterpart to google.server.ts, which only reads. This is the half that
// makes the sync two-way, and it replaces a stub that marked meetings "synced"
// without contacting anybody.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { accessTokenFor, type ConnectionRow } from "@/lib/calendar/google.server";
import { describeGoogleError } from "@/lib/calendar/google";
import {
  FUNDEXECS_MARKER_KEY,
  decideWrite,
  outcomeForStatus,
  toGoogleEvent,
  type WritableMeeting,
  type WriteOutcome,
} from "@/lib/calendar/google-write";

const API = "https://www.googleapis.com/calendar/v3";
const FETCH_TIMEOUT_MS = 10_000;

// Same client type the read side uses, so callers can pass either a service
// client (cron) or a request-scoped server client (a member's own action).
type ServiceClient = SupabaseClient<Database>;

export interface PushResult {
  ok: boolean;
  status: WriteOutcome;
  eventId: string | null;
  error?: string;
  /** What was actually done, for the audit trail and for tests. */
  action: "created" | "updated" | "deleted" | "skipped";
}

interface RawResponse {
  status: number;
  body: string;
  json: { id?: string } | null;
}

/**
 * One authenticated write. Never throws, for the same reason the read side
 * never does: these run inside loops where an exception abandons the rest.
 */
async function apiWrite(
  accessToken: string,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  params: Record<string, string> = {},
): Promise<RawResponse> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    // DELETE answers 204 with no body, and a 404 body is not worth parsing.
    const text = res.status === 204 ? "" : (await res.text().catch(() => "")).slice(0, 1000);
    let json: { id?: string } | null = null;
    try {
      json = text ? (JSON.parse(text) as { id?: string }) : null;
    } catch {
      json = null;
    }
    return { status: res.status, body: text, json };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "TimeoutError";
    // 0 is not a real HTTP status; it routes to the retryable branch, which is
    // what a timeout deserves.
    return { status: aborted ? 504 : 503, body: aborted ? "timeout" : "unreachable", json: null };
  }
}

/** The connection to write through: the member's primary, writable calendar. */
export async function writeTargetFor(
  client: ServiceClient,
  userId: string,
): Promise<{ conn: ConnectionRow; calendarId: string } | null> {
  const { data: conn } = await client
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn) return null;

  const { data: cal } = await client
    .from("google_calendars")
    .select("google_calendar_id, access_role, is_primary")
    .eq("user_id", userId)
    // owner and writer are the roles that may create events; reader and
    // freeBusyReader would 403 on every write.
    .in("access_role", ["owner", "writer"])
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();

  const calendarId = (cal as { google_calendar_id?: string } | null)?.google_calendar_id;
  if (!calendarId) return null;

  return { conn: conn as unknown as ConnectionRow, calendarId };
}

/**
 * Bring one meeting's Google event in line with the meeting.
 *
 * Creates, updates or removes it depending on what the meeting now is —
 * see `decideWrite`. Writes the resulting status back onto the row so the
 * meetings UI stops claiming a sync that never happened.
 */
export async function pushMeetingToGoogle(
  client: ServiceClient,
  meeting: WritableMeeting,
  userId: string,
): Promise<PushResult> {
  const target = await writeTargetFor(client, userId);
  const decision = decideWrite(meeting, { connected: Boolean(target) });

  if (decision.kind === "skip") {
    const status: WriteOutcome = !target
      ? "not_connected"
      : meeting.external_calendar_sync_enabled === true
        ? "sync_pending"
        : "sync_off";
    await recordSync(client, meeting.id, { status, eventId: meeting.external_calendar_event_id, error: null });
    return { ok: false, status, eventId: null, error: decision.reason, action: "skipped" };
  }

  // Non-null past this point: a non-skip decision requires a connection.
  const { conn, calendarId } = target!;
  const token = await accessTokenFor(conn);
  if (!token.ok || !token.data) {
    const error = token.error ?? "Could not authenticate with Google.";
    await recordSync(client, meeting.id, { status: "sync_failed", eventId: meeting.external_calendar_event_id, error });
    return { ok: false, status: "sync_failed", eventId: null, error, action: "skipped" };
  }

  const encodedCal = encodeURIComponent(calendarId);

  if (decision.kind === "delete") {
    const res = await apiWrite(token.data, "DELETE", `/calendars/${encodedCal}/events/${encodeURIComponent(decision.eventId)}`, undefined, {
      sendUpdates: "all",
    });
    // Already gone is the outcome we wanted; treat it as success rather than
    // leaving a dead id on the row forever.
    const gone = res.status === 404 || res.status === 410;
    if ((res.status >= 200 && res.status < 300) || gone) {
      await recordSync(client, meeting.id, { status: "sync_off", eventId: null, error: null });
      return { ok: true, status: "sync_off", eventId: null, action: "deleted" };
    }
    const error = describeGoogleError(res.status, res.body);
    await recordSync(client, meeting.id, { status: "sync_failed", eventId: decision.eventId, error });
    return { ok: false, status: "sync_failed", eventId: decision.eventId, error, action: "skipped" };
  }

  let body: ReturnType<typeof toGoogleEvent>;
  try {
    body = toGoogleEvent(meeting);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Could not build the event.";
    await recordSync(client, meeting.id, { status: "sync_failed", eventId: meeting.external_calendar_event_id, error });
    return { ok: false, status: "sync_failed", eventId: null, error, action: "skipped" };
  }

  // A create is only a create if no event for this meeting already exists.
  // One may, if an earlier run wrote it and then failed to store the id; making
  // a second one is how a member ends up with the same meeting twice.
  let targetEventId = decision.kind === "update" ? decision.eventId : null;
  if (decision.kind === "create") {
    targetEventId = await findEventByMarker(token.data, calendarId, meeting.id);
  }

  const res = targetEventId
    ? await apiWrite(
        token.data,
        "PATCH",
        `/calendars/${encodedCal}/events/${encodeURIComponent(targetEventId)}`,
        body,
        { sendUpdates: "all" },
      )
    : await apiWrite(token.data, "POST", `/calendars/${encodedCal}/events`, body, { sendUpdates: "all" });

  const verdict = outcomeForStatus(res.status);

  if (verdict.outcome === "synced") {
    const eventId = res.json?.id ?? targetEventId;
    const recorded = await recordSync(client, meeting.id, { status: "synced", eventId, error: null });
    const action = targetEventId ? "updated" : "created";

    if (!recorded.ok) {
      // The event is on the calendar but its id is not on the row. Saying
      // "synced" here would be the same lie this whole change exists to remove,
      // and the next push would rely on the marker lookup above to avoid a
      // duplicate rather than on a stored id.
      return {
        ok: false,
        status: "sync_pending",
        eventId,
        error: `The calendar event was written but could not be recorded: ${recorded.error ?? "unknown error"}`,
        action,
      };
    }
    return { ok: true, status: "synced", eventId, action };
  }

  const error = describeGoogleError(res.status, res.body);
  await recordSync(client, meeting.id, {
    status: verdict.outcome,
    // A 404/410 means the event is gone from Google; dropping the id makes the
    // next attempt create a fresh one instead of patching a ghost forever.
    eventId: verdict.forgetEventId ? null : meeting.external_calendar_event_id,
    error,
  });
  return { ok: false, status: verdict.outcome, eventId: null, error, action: "skipped" };
}

/**
 * Persist the sync outcome on the meeting row.
 *
 * Returns whether it stuck. supabase-js resolves with `{ error }` rather than
 * throwing, so a discarded result is a silently lost write — and losing the
 * event id after a successful create is what makes the next push produce a
 * duplicate event on someone's calendar.
 */
export async function recordSync(
  client: ServiceClient,
  meetingId: string,
  next: { status: WriteOutcome; eventId: string | null; error: string | null },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await client
      .from("live_meetings")
      .update({
        external_calendar_provider: "google",
        external_calendar_sync_status: next.status,
        external_calendar_event_id: next.eventId,
        external_calendar_last_error: next.error,
      } as never)
      .eq("id", meetingId);

    if (error) {
      console.error("[google-calendar] could not record sync status for", meetingId, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google-calendar] could not record sync status for", meetingId, err);
    return { ok: false, error: message };
  }
}

/**
 * An event this app already wrote for a meeting, found by its private marker.
 *
 * Makes a create idempotent. If a previous run wrote the event but failed to
 * store its id — a lost update, a crash between the two — creating again would
 * put a second copy of the same meeting on the calendar. Google can query the
 * private property directly, so the orphan is recoverable rather than doubled.
 */
export async function findEventByMarker(
  accessToken: string,
  calendarId: string,
  meetingId: string,
): Promise<string | null> {
  const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("privateExtendedProperty", `${FUNDEXECS_MARKER_KEY}=${meetingId}`);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("showDeleted", "false");

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: Array<{ id?: string; status?: string }> };
    const found = (body.items ?? []).find((e) => e?.id && e.status !== "cancelled");
    return found?.id ?? null;
  } catch {
    // Recovery is best-effort: failing to find an orphan must not stop the
    // write, it just means this one may create a second copy.
    return null;
  }
}
