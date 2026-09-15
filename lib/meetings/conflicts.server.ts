// lib/meetings/conflicts.server.ts
// The half of the conflict check that lives outside this app.
//
// Scheduling a meeting in here warned about other meetings in here, and about
// time the member had blocked by hand — but said nothing about the calendar
// they actually live in. Someone with Google Calendar connected could book
// straight over a client call and be told the time was free, which is the same
// hole the public booking page had, seen from the other side.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { externalBusyForUser } from "@/lib/calendar/feeds.server";
import { googleBusyForUser } from "@/lib/calendar/google.server";
import { mergeIntervals, type BusyInterval } from "@/lib/calendar/feeds";

type Client = SupabaseClient<Database>;

/**
 * Time the member is already committed to in a calendar we only read.
 *
 * Deliberately just spans: the warning has to say "you are busy then", and the
 * summary of a private event is not needed to say it.
 *
 * Never throws, and never fetches. Both sources answer from what their last
 * sync stored and resolve to nothing rather than failing, so a broken
 * connection costs the member a warning — not the ability to save a meeting.
 */
export async function loadExternalConflicts(
  supabase: Client,
  opts: { userId: string; startIso: string; endIso: string; timezone: string },
): Promise<BusyInterval[]> {
  const from = new Date(opts.startIso);
  const to = new Date(opts.endIso);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) return [];

  // Independent: a revoked Google grant must not also stop a subscribed feed
  // from warning, and neither may take the save down.
  const [feeds, google] = await Promise.all([
    externalBusyForUser(supabase, opts.userId, {
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      timezone: opts.timezone,
    }),
    googleBusyForUser(supabase, opts.userId, from, to, opts.timezone),
  ]);

  // Both sources clip to the window they were given, so anything that comes
  // back already overlaps the proposed meeting.
  return mergeIntervals([...feeds, ...google]);
}
