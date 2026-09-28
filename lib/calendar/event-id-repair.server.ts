// lib/calendar/event-id-repair.server.ts
// The sweep that reattaches calendar events to the meetings that lost them.
//
// The rules — which meetings, grouped how, counted how — are in
// event-id-repair.ts, along with the explanation of why this reads rather than
// writes. The short version, because it is the one thing about this file that
// must not be "simplified": every write in google-write.server.ts carries
// `sendUpdates: "all"`. Re-pushing these meetings would email every attendee of
// every one of them. Nothing here touches a calendar's contents.
//
// No `server-only` import, matching the other sweeps in this repo: the `.server`
// suffix is the marker, and the guard would put this beyond the reach of a test.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { accessTokenFor } from "@/lib/calendar/google.server";
import { lookupEventByMarker, recordSync, writeTargetFor } from "@/lib/calendar/google-write.server";
import {
  NO_REPAIRS,
  byHost,
  countOutcome,
  type RepairOutcome,
  type RepairStats,
  type RepairableMeeting,
} from "@/lib/calendar/event-id-repair";

type Client = SupabaseClient<Database>;

/**
 * Bounded per sweep, like every other job here: a backlog is taken next hour.
 *
 * Each repair is one Google API read, so this is also the rate limit. Fifty an
 * hour clears a realistic backlog within a day without ever looking like a
 * runaway to Google.
 */
export const MAX_PER_SWEEP = 50;

/**
 * Reattach the event ids that the provider constraint cost us.
 *
 * Idempotent by construction: a meeting whose id is recorded no longer matches
 * the query, so re-running only ever picks up what is still broken. Safe to run
 * on a schedule forever — and worth it, because a host who reconnects a calendar
 * months from now has their rows healed on the next sweep rather than never.
 */
export async function runEventIdRepair(
  supabase: Client,
  limit = MAX_PER_SWEEP,
): Promise<RepairStats> {
  // One more than the bound, purely to learn whether a backlog remains without
  // a second COUNT query.
  const { data, error } = await supabase
    .from("live_meetings")
    .select("id, host_id, external_calendar_sync_enabled, external_calendar_event_id, deleted_at, is_draft")
    .eq("external_calendar_sync_enabled", true)
    .is("external_calendar_event_id", null)
    .is("deleted_at", null)
    .eq("is_draft", false)
    .not("host_id", "is", null)
    // Newest first: a meeting somebody is about to hold matters more than one
    // from last spring, and the bound means order decides who waits.
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (error) {
    console.error("[calendar-repair] could not list meetings missing an event id", error.message);
    return NO_REPAIRS;
  }

  const rows = (data ?? []) as unknown as RepairableMeeting[];
  const more = rows.length > limit;
  const work = byHost(more ? rows.slice(0, limit) : rows);

  let stats: RepairStats = { ...NO_REPAIRS, more };

  for (const [hostId, meetings] of work) {
    // One lookup and one token per host, not per meeting.
    const target = await writeTargetFor(supabase, hostId).catch(() => null);
    if (!target) {
      // Their calendar is gone, or never was. Not a failure and not something a
      // retry fixes — but the rows stay eligible, so reconnecting heals them.
      for (let i = 0; i < meetings.length; i++) stats = countOutcome(stats, "noCalendar");
      continue;
    }

    const token = await accessTokenFor(target.conn).catch(() => null);
    // `ok` and `data` are separate fields on GoogleCallResult, so the token is
    // what gets checked rather than the flag: an "ok" result carrying no token
    // is just as unusable, and reading through the flag would have meant
    // handing `undefined` to every lookup below.
    const accessToken = token?.ok ? token.data : undefined;
    if (!accessToken) {
      // A refresh token that no longer works is the same situation from the
      // other side. Counted as a failure because, unlike a missing calendar,
      // it may well work next hour.
      console.warn("[calendar-repair] no access token for host", hostId, token?.error);
      for (let i = 0; i < meetings.length; i++) stats = countOutcome(stats, "failed");
      continue;
    }

    for (const meeting of meetings) {
      stats = countOutcome(stats, await repairOne(supabase, accessToken, target.calendarId, meeting));
    }
  }

  return stats;
}

/**
 * One meeting: find its event, record its id.
 *
 * Never throws. A sweep that dies partway through leaves the rest of a backlog
 * untouched and gives no account of what it did manage.
 */
async function repairOne(
  supabase: Client,
  accessToken: string,
  calendarId: string,
  meeting: RepairableMeeting,
): Promise<RepairOutcome> {
  // `lookupEventByMarker` rather than `findEventByMarker`, because the two
  // answers it separates are the two this sweep reports. The flattened version
  // returns null both for "no such event" and for "could not reach Google", and
  // counting an outage as the former would hand somebody a list of meetings to
  // go and fix by hand that were never broken.
  const found = await lookupEventByMarker(accessToken, calendarId, meeting.id).catch(
    (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
  );
  if (!found.ok) {
    console.warn("[calendar-repair] lookup failed for", meeting.id, found.error);
    return "failed";
  }

  // No event carries this meeting's marker. Either the push never got as far as
  // creating one, or somebody deleted it from Google. Creating one here would be
  // a decision — and would notify every attendee — so it is left for a person.
  if (!found.eventId) return "noEvent";
  const eventId = found.eventId;

  const recorded = await recordSync(supabase as never, meeting.id, {
    status: "synced",
    eventId,
    error: null,
  });
  if (!recorded.ok) {
    console.warn("[calendar-repair] could not record", eventId, "for", meeting.id, recorded.error);
    return "failed";
  }
  return "reattached";
}
