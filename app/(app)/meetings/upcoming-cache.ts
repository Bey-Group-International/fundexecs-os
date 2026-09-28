// The upcoming-meetings list, shared by every copy of it on the page.
//
// The meetings page renders the list from the server, and then the list used
// to fetch /api/meetings/upcoming again the moment it mounted — the same query
// the server had just run. Opening the calendar mounts a second copy in its
// rail, which fetched a third time, and every realtime change to a meeting then
// refetched once per copy. This keeps one answer and one request in flight.

import type { UpcomingMeeting } from "./UpcomingMeetingsList";

/** How long an answer is trusted by a copy that is only now mounting. */
export const UPCOMING_FRESH_MS = 30_000;

let latest: { at: number; data: UpcomingMeeting[] } | null = null;
let inflight: Promise<UpcomingMeeting[] | null> | null = null;

/** Record an answer obtained elsewhere — the server render the page arrived with. */
export function seedUpcoming(data: UpcomingMeeting[]): void {
  latest = { at: Date.now(), data };
}

/** The last answer, if it is recent enough to use instead of asking again. */
export function recentUpcoming(maxAgeMs: number = UPCOMING_FRESH_MS): UpcomingMeeting[] | null {
  return latest && Date.now() - latest.at <= maxAgeMs ? latest.data : null;
}

/**
 * Fetch the list, sharing a request already in flight.
 *
 * Every copy schedules its refresh on the same realtime event, so without this
 * each one sent its own identical request. Null when the request failed, so a
 * caller keeps what it has rather than emptying the list.
 */
export function fetchUpcoming(): Promise<UpcomingMeeting[] | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/meetings/upcoming", { cache: "no-store" });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: UpcomingMeeting[] };
      const data = json.data ?? [];
      latest = { at: Date.now(), data };
      return data;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test hook: forget everything, so one test's answer is not the next one's. */
export function resetUpcomingCache(): void {
  latest = null;
  inflight = null;
}
