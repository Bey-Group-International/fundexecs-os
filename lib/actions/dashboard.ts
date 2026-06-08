'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  BRIEF_SEEN_COOKIE,
  DAILY_DONE_COOKIE,
  DISMISSED_ALERTS_COOKIE,
  LAST_VISIT_COOKIE,
  readDailyDone,
  readDismissedAlerts,
  todayKey
} from '@/lib/dashboard/state';

/* ============================================================================
 * Dashboard inline actions — server actions backing the actionable cards.
 *
 * All three persist to httpOnly cookies (UX state only; RLS owns data access),
 * so the Command Center is a control surface, not just a report, with no schema
 * dependency. Each revalidates the canvas so the server-rendered loader reflects
 * the change on the next paint.
 * ========================================================================= */

const ONE_YEAR = 60 * 60 * 24 * 365;
const ONE_DAY = 60 * 60 * 24;

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/'
};

/**
 * Record that the operator has seen the desk *now*. Called from a tiny client
 * effect AFTER the "since you were away" summary is computed against the prior
 * value — so this visit becomes the baseline for the next one.
 */
export async function markVisited(): Promise<void> {
  (await cookies()).set(LAST_VISIT_COOKIE, new Date().toISOString(), {
    ...baseCookie,
    maxAge: ONE_YEAR
  });
}

/**
 * Mark Earn's first-use launch brief as seen, so the welcome card never shows
 * again for this member. Best-effort UX state (httpOnly cookie); no data access.
 * No revalidate — the card hides itself client-side on dismiss.
 */
export async function dismissLaunchBrief(): Promise<{ ok: true }> {
  (await cookies()).set(BRIEF_SEEN_COOKIE, '1', { ...baseCookie, maxAge: ONE_YEAR });
  return { ok: true };
}

/** Dismiss a Major Alert. Idempotent; capped so the cookie stays small. */
export async function dismissAlert(id: string): Promise<{ ok: true }> {
  const clean = id.trim();
  if (clean) {
    const next = await readDismissedAlerts();
    next.add(clean);
    (await cookies()).set(DISMISSED_ALERTS_COOKIE, Array.from(next).slice(-50).join(','), {
      ...baseCookie,
      maxAge: ONE_YEAR
    });
  }
  revalidatePath('/command-center');
  return { ok: true };
}

/** Toggle a daily-command item's done state for *today*. Resets each day. */
export async function toggleDailyDone(id: string): Promise<{ ok: true; done: boolean }> {
  const clean = id.trim();
  const set = await readDailyDone();
  let done = false;
  if (clean) {
    if (set.has(clean)) {
      set.delete(clean);
      done = false;
    } else {
      set.add(clean);
      done = true;
    }
    const value = `${todayKey()}:${Array.from(set).slice(-50).join(',')}`;
    (await cookies()).set(DAILY_DONE_COOKIE, value, { ...baseCookie, maxAge: ONE_DAY });
  }
  revalidatePath('/command-center');
  return { ok: true, done };
}
