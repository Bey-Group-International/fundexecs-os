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
import { busyEventsOnly, parseIcs } from "@/lib/calendar/ics";
import {
  FEED_FETCH_TIMEOUT_MS,
  FEED_MAX_BYTES,
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
  if (!valid.ok) return { ok: false, busy: [], error: valid.error };

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
      return { ok: false, busy: [], error: `The calendar service returned ${res.status}.` };
    }

    // Guard on the declared length first, then on what actually arrives — a
    // server can lie about or omit Content-Length.
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > FEED_MAX_BYTES) {
      return { ok: false, busy: [], error: "That calendar is too large to import." };
    }

    const text = await readCapped(res, FEED_MAX_BYTES);
    if (text === null) {
      return { ok: false, busy: [], error: "That calendar is too large to import." };
    }

    // A URL that needs a login returns a sign-in page with status 200. Saying
    // "no events" there would read as an empty calendar, which is the wrong
    // and dangerous answer.
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      return {
        ok: false,
        busy: [],
        error: "That address didn't return a calendar. Check it's the secret ICS link, not the web page.",
      };
    }

    const windowStart = new Date(now.getTime() - 86_400_000);
    const windowEnd = new Date(now.getTime() + FEED_WINDOW_DAYS * 86_400_000);
    const events = busyEventsOnly(parseIcs(text, { windowStart, windowEnd }));
    const busy = mergeIntervals(events.map((e) => ({ start: e.startIso, end: e.endIso })));

    return { ok: true, busy, eventCount: events.length };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      busy: [],
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
  result: FetchFeedResult,
  now: Date = new Date(),
): Promise<void> {
  const stamp = now.toISOString();
  const patch = result.ok
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
        last_error: result.error ?? "Unknown error",
        // A failure leaves the previous cached_busy in place on purpose:
        // yesterday's busy time is a far better guess than suddenly declaring
        // the host free because their calendar host had a bad minute.
        updated_at: stamp,
      };

  const { error } = await client.from("calendar_feeds").update(patch as never).eq("id", feedId);
  if (error) console.error("[calendar-feeds] failed to record fetch result", error);

  if (!result.ok) {
    // Incremented separately: doing it in the patch above would need a read
    // first and race with a concurrent sweep.
    try {
      const { error: rpcError } = await client.rpc("increment_calendar_feed_failures", { feed_id: feedId });
      if (rpcError) console.error("[calendar-feeds] failure count not incremented", rpcError);
    } catch (err) {
      console.error("[calendar-feeds] failure count not incremented", err);
    }
  }
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
    .select("id, url, cached_at")
    .eq("is_active", true)
    .order("cached_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit ?? 25);
  if (opts.userId) query = query.eq("user_id", opts.userId);

  const { data, error } = await query;
  if (error) {
    console.error("[calendar-feeds] refresh query failed", error);
    return summary;
  }

  for (const row of (data ?? []) as Array<{ id: string; url: string; cached_at: string | null }>) {
    if (!opts.force && !cacheIsStale(row.cached_at, now)) {
      summary.skipped++;
      continue;
    }
    const result = await fetchFeed(row.url, now);
    await recordFeedResult(client, row.id, result, now);
    if (result.ok) summary.refreshed++;
    else summary.failed++;
  }

  return summary;
}
