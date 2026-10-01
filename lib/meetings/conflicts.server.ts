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

/**
 * Busy time a connected calendar holds against ANY meeting of a series, or
 * against the one meeting when there is no series.
 *
 * One read across the whole span rather than one per meeting: a year of weekly
 * meetings is 52 windows, and they are all answered from the same stored copy.
 * What comes back is only the busy time that actually overlaps a meeting.
 */
export async function loadSeriesExternalConflicts(
  supabase: Client,
  opts: { userId: string; starts: string[]; durationMinutes: number; timezone: string },
): Promise<BusyInterval[]> {
  const windows = opts.starts
    .map((iso) => new Date(iso).getTime())
    .filter((ms) => Number.isFinite(ms))
    .map((ms) => [ms, ms + opts.durationMinutes * 60_000] as const);
  if (windows.length === 0) return [];
  const busy = await loadExternalConflicts(supabase, {
    userId: opts.userId,
    startIso: new Date(Math.min(...windows.map(([s]) => s))).toISOString(),
    endIso: new Date(Math.max(...windows.map(([, e]) => e))).toISOString(),
    timezone: opts.timezone,
  });
  if (windows.length === 1) return busy;
  return busy.filter((b) => {
    const s = new Date(b.start).getTime();
    const e = new Date(b.end).getTime();
    return windows.some(([ws, we]) => s < we && e > ws);
  });
}
