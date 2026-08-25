// lib/calendar/feeds.ts
// Rules for external calendar subscriptions. Pure — the fetching and storage
// live in feeds.server.ts, so everything decided here is directly testable.

/** Longest a cached busy set is trusted before a refresh is due. */
export const FEED_CACHE_TTL_MS = 30 * 60_000;
/** How far ahead an imported feed is read. Matches the booking window ceiling. */
export const FEED_WINDOW_DAYS = 120;
/** Cap on bytes read from a third-party URL. */
export const FEED_MAX_BYTES = 5 * 1024 * 1024;
/** How long to wait on a third-party server before giving up. */
export const FEED_FETCH_TIMEOUT_MS = 10_000;
/** Failures in a row before a feed is called broken in the UI. */
export const FEED_FAILURE_ALERT_THRESHOLD = 3;

export interface BusyInterval {
  start: string;
  end: string;
}

export type FeedUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Validate a subscription URL before we ever fetch it.
 *
 * This is an SSRF boundary, not a formatting check: the URL is supplied by a
 * user and then requested by our server, so a permissive parse would let
 * someone aim it at internal infrastructure — cloud metadata endpoints,
 * localhost admin ports, private ranges — and read the response back through
 * their own calendar. Only http(s) to a public host is allowed.
 *
 * Hostname checks cannot be complete on their own (DNS can resolve a public
 * name to a private address), so the server-side fetcher pairs this with a
 * redirect-following ban. Together they cover the realistic cases.
 */
export function validateFeedUrl(input: string): FeedUrlValidation {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "Paste the calendar's secret ICS address." };

  // webcal:// is what calendar apps hand out; it is http(s) underneath.
  const normalized = raw.replace(/^webcal:\/\//i, "https://");

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return { ok: false, error: "That doesn't look like a calendar address." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https calendar addresses are supported." };
  }

  const host = url.hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "[::1]" || host === "::1") {
    return { ok: false, error: "That address points back at this server, not a calendar." };
  }

  // IPv4 private and link-local ranges, including the cloud metadata address.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const isPrivate =
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
    if (isPrivate) {
      return { ok: false, error: "That address is on a private network, not a calendar service." };
    }
  }

  // IPv6 loopback, unique-local (fc00::/7) and link-local (fe80::/10).
  if (host.startsWith("[")) {
    const inner = host.slice(1, -1);
    if (inner === "::1" || /^f[cd]/i.test(inner) || /^fe[89ab]/i.test(inner)) {
      return { ok: false, error: "That address is on a private network, not a calendar service." };
    }
  }

  // `.internal` and `.local` are reserved for private networks.
  if (host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, error: "That address is on a private network, not a calendar service." };
  }

  return { ok: true, url: url.toString() };
}

/**
 * Merge overlapping or touching intervals.
 *
 * Availability is checked against every interval, so collapsing them keeps that
 * work proportional to distinct busy blocks rather than to raw event count — a
 * feed with a hundred overlapping events becomes a handful of spans.
 */
export function mergeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  const parsed = intervals
    .map((i) => ({ start: new Date(i.start).getTime(), end: new Date(i.end).getTime() }))
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .sort((a, b) => a.start - b.start);

  const out: Array<{ start: number; end: number }> = [];
  for (const current of parsed) {
    const last = out[out.length - 1];
    // `>=` merges touching spans too: 09:00–10:00 and 10:00–11:00 is one block.
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      out.push({ ...current });
    }
  }

  return out.map((i) => ({
    start: new Date(i.start).toISOString(),
    end: new Date(i.end).toISOString(),
  }));
}

/** Whether a feed's cache is old enough to warrant a refetch. */
export function cacheIsStale(cachedAt: string | null, now: Date = new Date(), ttlMs = FEED_CACHE_TTL_MS): boolean {
  if (!cachedAt) return true;
  const at = new Date(cachedAt).getTime();
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at >= ttlMs;
}

export interface FeedHealth {
  state: "ok" | "never_fetched" | "stale" | "failing";
  message: string | null;
}

/**
 * How a feed should be described to its owner.
 *
 * A feed that has been failing looks exactly like a free calendar from the
 * outside — no events, no busy time — so the difference has to be visible or a
 * host will take bookings believing they are free.
 */
export function feedHealth(feed: {
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}): FeedHealth {
  if (feed.consecutiveFailures >= FEED_FAILURE_ALERT_THRESHOLD) {
    return {
      state: "failing",
      message: feed.lastError
        ? `Not syncing: ${feed.lastError}`
        : "Not syncing — this calendar hasn't been reachable.",
    };
  }
  if (!feed.lastSuccessAt) {
    return { state: "never_fetched", message: "Waiting for its first sync." };
  }
  const age = Date.now() - new Date(feed.lastSuccessAt).getTime();
  if (Number.isFinite(age) && age > 6 * 3600_000) {
    return { state: "stale", message: "Last synced more than six hours ago." };
  }
  return { state: "ok", message: null };
}
