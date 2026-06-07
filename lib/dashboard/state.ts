import 'server-only';
import { cookies } from 'next/headers';

/* ============================================================================
 * Dashboard per-user UI state — lightweight, cookie-backed.
 *
 * These cookies govern UX only (last-visit deltas, dismissed alerts, daily
 * check-offs). They never affect data access — RLS owns that independently — so
 * a stale or absent value is always safe. Keeping this out of the database
 * means the "compounding" continuity + inline actions work in private beta with
 * zero migration and zero extra round-trips.
 * ========================================================================= */

export const LAST_VISIT_COOKIE = 'fx-lastvisit';
export const DISMISSED_ALERTS_COOKIE = 'fx-dismissed';
export const DAILY_DONE_COOKIE = 'fx-daily';

/** YYYY-MM-DD in UTC — the bucket key for "today's" daily check-offs. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The timestamp of the previous visit (ISO), or null on the first ever visit. */
export async function readLastVisit(): Promise<string | null> {
  const v = (await cookies()).get(LAST_VISIT_COOKIE)?.value;
  if (!v) return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Alert ids the user dismissed. Capped defensively so the cookie can't grow. */
export async function readDismissedAlerts(): Promise<Set<string>> {
  const v = (await cookies()).get(DISMISSED_ALERTS_COOKIE)?.value;
  if (!v) return new Set();
  return new Set(
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50)
  );
}

/** Daily-command ids the user checked off *today*. A new day resets the set. */
export async function readDailyDone(): Promise<Set<string>> {
  const v = (await cookies()).get(DAILY_DONE_COOKIE)?.value;
  if (!v) return new Set();
  const [day, ...rest] = v.split(':');
  if (day !== todayKey()) return new Set();
  return new Set(
    (rest.join(':') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50)
  );
}
