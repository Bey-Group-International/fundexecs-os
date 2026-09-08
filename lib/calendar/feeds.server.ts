// lib/calendar/feeds.server.ts
// Fetching external calendar feeds and turning them into cached busy time.
//
// The hard constraint: availability is read on every booking-page slot lookup,
// by an anonymous visitor, on a request we want fast. Fetching a third-party
// URL there would put someone else's uptime and latency on our critical path.
// So reads use the cache, and refreshing happens outside the request that needs
// the answer.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { busyEventsOnly, parseIcs, type IcsEvent } from "@/lib/calendar/ics";
import {
  FEED_FETCH_TIMEOUT_MS,
  FEED_MAX_BYTES,
  FEED_PAST_DAYS,
  FEED_WINDOW_DAYS,
  type BusyInterval,
  cacheIsStale,
  mergeIntervals,
  validateFeedUrl,
} from "@/lib/calendar/feeds";

type Client = SupabaseClient<Database>;

export interface FeedRow {
  id: string;
  user_id: string;
  label: string;
  url: string;
  is_active: boolean;
  last_fetched_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  cached_busy: unknown;
  cached_at: string | null;
}

export interface FetchFeedResult {
  ok: boolean;
  busy: BusyInterval[];
  /**
   * Every event read, including the transparent ones `busy` excludes.
   *
   * This used to be discarded the moment the intervals were merged, which is
   * why a subscribed calendar could block a booking slot and still draw nothing
   * on the grid. The grid wants each event, with its title; availability wants
   * the merged opaque ones. Both come out of the same parse.
   */
  events: IcsEvent[];
  error?: string;
  eventCount?: number;
}

/**
 * Fetch one feed and reduce it to merged busy intervals.
 *
 * Never throws. Every failure mode a third-party URL can present — timeout,
 * 404, HTML error page, hostile size — resolves to `ok: false` with a reason a
 * person can act on.
 */
export async function fetchFeed(url: string, now: Date = new Date()): Promise<FetchFeedResult> {
  const valid = validateFeedUrl(url);
  if (!valid.ok) return { ok: false, busy: [], events: [], error: valid.error };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(valid.url, {
      signal: controller.signal,
      // A redirect can walk a validated public URL to a private one, which
      // would reopen the SSRF hole validateFeedUrl closes. Calendar providers
      // serve ICS directly, so refusing redirects costs nothing real.
      redirect: "error",
      headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5" },
      cache: "no-store",
    });

    if (!res.ok) {
      return { ok: false, busy: [], events: [], error: `The calendar service returned ${res.status}.` };
    }

    // Guard on the declared length first, then on what actually arrives — a
    // server can lie about or omit Content-Length.
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > FEED_MAX_BYTES) {
      return { ok: false, busy: [], events: [], error: "That calendar is too large to import." };
    }

    const text = await readCapped(res, FEED_MAX_BYTES);
    if (text === null) {
      return { ok: false, busy: [], events: [], error: "That calendar is too large to import." };
    }

    // A URL that needs a login returns a sign-in page with status 200. Saying
    // "no events" there would read as an empty calendar, which is the wrong
    // and dangerous answer.
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      return {
        ok: false,
        busy: [],
        events: [],
        error: "That address didn't return a calendar. Check it's the secret ICS link, not the web page.",
      };
    }

    const windowStart = new Date(now.getTime() - FEED_PAST_DAYS * 86_400_000);
    const windowEnd = new Date(now.getTime() + FEED_WINDOW_DAYS * 86_400_000);
    const events = parseIcs(text, { windowStart, windowEnd });
    const busyEvents = busyEventsOnly(events);
    const busy = mergeIntervals(busyEvents.map((e) => ({ start: e.startIso, end: e.endIso })));

    // eventCount stays the count of events that consume availability — it is
    // what the failure copy and the health panel have always meant by it.
    return { ok: true, busy, events, eventCount: busyEvents.length };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      busy: [],
      events: [],
      error: aborted
        ? "The calendar service didn't respond in time."
        : "Couldn't reach that calendar address.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Read a response body, giving up past `maxBytes`. Null when it overruns. */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return new TextEncoder().encode(text).length > maxBytes ? null : text;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(joined);
}

/** Persist the outcome of a fetch, success or failure, against a feed row. */
export async function recordFeedResult(
  client: Client,
  feedId: string,
  userId: string,
  result: FetchFeedResult,
  now: Date = new Date(),
): Promise<boolean> {
  const stamp = now.toISOString();

  // Events first, then the verdict.
  //
  // Writing the success fields before storing the events meant a failed event
  // write left a feed marked fresh: cached_at stamped, last_error cleared, and
  // cacheIsStale false for the next half hour, so the sweep skipped the retry
  // while the grid kept drawing the previous fetch. A calendar that is quietly
  // half an hour stale and reports itself healthy is the failure this whole
  // change exists to remove.
  const stored = result.ok ? await applyFeedEvents(client, feedId, userId, result.events, now) : null;
  const ok = result.ok && stored!.ok;

  const patch = ok
    ? {
        last_fetched_at: stamp,
        last_success_at: stamp,
        last_error: null,
        consecutive_failures: 0,
        cached_busy: result.busy as never,
        cached_at: stamp,
        updated_at: stamp,
      }
    : {
        last_fetched_at: stamp,
        // A fetch that worked and a store that did not are different problems,
        // and the member is told which.
        last_error:
          result.error ??
          (result.ok ? "Read the calendar, but its events could not be stored." : "Unknown error"),
        // A failure leaves the previous cached_busy in place on purpose:
        // yesterday's busy time is a far better guess than suddenly declaring
        // the host free because their calendar host had a bad minute. That now
        // covers a failed event write too: nothing about this refresh is
        // trustworthy enough to overwrite what the last good one left.
        updated_at: stamp,
      };

  const { error } = await client.from("calendar_feeds").update(patch as never).eq("id", feedId);
  if (error) console.error("[calendar-feeds] failed to record fetch result", error);

  if (!ok) {
    // Incremented separately: doing it in the patch above would need a read
    // first and race with a concurrent sweep.
    try {
      const { error: rpcError } = await client.rpc("increment_calendar_feed_failures", { feed_id: feedId });
      if (rpcError) console.error("[calendar-feeds] failure count not incremented", rpcError);
    } catch (err) {
      console.error("[calendar-feeds] failure count not incremented", err);
    }
  }

  return ok;
}

/**
 * Replace a feed's stored events with what this fetch read.
 *
 * Upsert-then-prune rather than delete-then-insert: a feed refreshes every half
 * hour, and deleting first would leave a window — small, but real, and hit by
 * whoever is looking at the calendar right then — where the member's own
 * subscribed calendar reads as empty. Instead every event read is written with
 * this run's stamp, and only rows the run did not touch are removed.
 *
 * Reports whether the write landed. The caller needs that answer: recording a
 * feed as successfully refreshed when its events did not store would stamp
 * cached_at, silence the retry for half an hour, and leave stale rows on the
 * grid with nothing anywhere saying why.
 */
export async function applyFeedEvents(
  client: Client,
  feedId: string,
  userId: string,
  events: IcsEvent[],
  now: Date = new Date(),
): Promise<{ ok: boolean; upserted: number; deleted: number }> {
  const stamp = now.toISOString();
  const summary = { ok: true, upserted: 0, deleted: 0 };

  // Instances of one recurring series share a UID and differ only by start, so
  // that pair is the identity. A feed that repeats the same pair twice (rare,
  // but malformed feeds exist) would otherwise make Postgres reject the whole
  // batch for touching a row twice.
  const seen = new Set<string>();
  const rows = [];
  for (const e of events) {
    const key = `${e.uid}@${e.startIso}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      feed_id: feedId,
      user_id: userId,
      uid: e.uid,
      // Description is deliberately not stored. The grid never draws it, and
      // it is the field most likely to carry someone's private notes — there
      // is no reason to hold a copy of that here.
      summary: e.summary,
      location: e.location,
      starts_at: e.startIso,
      ends_at: e.endIso,
      is_all_day: e.allDay,
      transparent: e.transparent,
      status: e.status,
      updated_at: stamp,
    });
  }

  if (rows.length) {
    const { error } = await client
      .from("calendar_feed_events")
      .upsert(rows as never, { onConflict: "feed_id,uid,starts_at" });
    if (error) {
      console.error("[calendar-feeds] event upsert failed", error);
      // Nothing was written, so pruning now would delete a good previous fetch
      // and leave the member with nothing at all.
      summary.ok = false;
      return summary;
    }
    summary.upserted = rows.length;
  }

  // Whatever this run did not write is gone from the feed: an event deleted at
  // the source, or one that has fallen out of the read window.
  const { error: pruneError, count } = await client
    .from("calendar_feed_events")
    .delete({ count: "exact" })
    .eq("feed_id", feedId)
    .lt("updated_at", stamp);
  if (pruneError) console.error("[calendar-feeds] event prune failed", pruneError);
  else summary.deleted = count ?? 0;

  return summary;
}

/** Busy intervals a row already holds, defensively parsed. */
export function cachedBusyOf(row: Pick<FeedRow, "cached_busy">): BusyInterval[] {
  const raw = row.cached_busy;
  if (!Array.isArray(raw)) return [];
  const out: BusyInterval[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { start, end } = item as { start?: unknown; end?: unknown };
    if (typeof start === "string" && typeof end === "string") out.push({ start, end });
  }
  return out;
}

/**
 * All external busy time for a member, from cache.
 *
 * Deliberately does not fetch. A stale cache is reported through the feed's own
 * health rather than repaired here, so an availability lookup never waits on a
 * third party. `refreshStaleFeeds` is what closes the gap.
 */
export async function externalBusyForUser(client: Client, userId: string): Promise<BusyInterval[]> {
  try {
    const { data, error } = await client
      .from("calendar_feeds")
      .select("cached_busy")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(50);
    if (error) throw new Error(error.message);
    const all = (data ?? []).flatMap((row) => cachedBusyOf(row as Pick<FeedRow, "cached_busy">));
    return mergeIntervals(all);
  } catch (err) {
    // Availability must still resolve. Losing external busy time can permit a
    // double-booking, so this is logged loudly rather than swallowed quietly.
    console.error("[calendar-feeds] external busy lookup failed for user", userId, err);
    return [];
  }
}

export interface RefreshSummary {
  refreshed: number;
  failed: number;
  skipped: number;
}

/**
 * Refresh feeds whose cache has aged out. Driven by cron, and by an explicit
 * "sync now" from the owner.
 */
export async function refreshStaleFeeds(
  client: Client,
  opts: { userId?: string; limit?: number; force?: boolean; now?: Date } = {},
): Promise<RefreshSummary> {
  const now = opts.now ?? new Date();
  const summary: RefreshSummary = { refreshed: 0, failed: 0, skipped: 0 };

  let query = client
    .from("calendar_feeds")
    // user_id comes along so the stored events can carry their owner, which is
    // what RLS on calendar_feed_events keys off.
    .select("id, user_id, url, cached_at")
    .eq("is_active", true)
    .order("cached_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit ?? 25);
  if (opts.userId) query = query.eq("user_id", opts.userId);

  const { data, error } = await query;
  if (error) {
    console.error("[calendar-feeds] refresh query failed", error);
    return summary;
  }

  for (const row of (data ?? []) as Array<{ id: string; user_id: string; url: string; cached_at: string | null }>) {
    if (!opts.force && !cacheIsStale(row.cached_at, now)) {
      summary.skipped++;
      continue;
    }
    const result = await fetchFeed(row.url, now);
    // Counted off what was recorded, not off the fetch: a feed whose events
    // failed to store has not been refreshed, however well the download went.
    if (await recordFeedResult(client, row.id, row.user_id, result, now)) summary.refreshed++;
    else summary.failed++;
  }

  return summary;
}
