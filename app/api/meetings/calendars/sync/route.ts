// POST /api/meetings/calendars/sync — pull this member's Google calendars now.
//
// Between the hourly cron sweeps there was no way to ask for a refresh: a
// meeting accepted in Google two minutes ago simply was not here, and the only
// remedy was to wait for the top of the hour. `syncStaleGoogleConnections` has
// always taken a `userId` for exactly this — "a member's explicit sync now" —
// but nothing ever called it with one.
//
// Scoped to the caller and run under their own session. RLS on the three sync
// tables is owner-based, so this cannot read or write another member's
// calendar even though the underlying helper is the same one cron runs.
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { syncStaleGoogleConnections } from "@/lib/calendar/google.server";
import { refreshStaleFeeds } from "@/lib/calendar/feeds.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Time budget for one manual sync. A member is watching a spinner, so this is
 * shorter than the cron sweep's patience; whatever it does not finish, the next
 * sweep picks up.
 */
const SYNC_BUDGET_MS = 25_000;

export async function POST() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const supabase = await createServerClient();
    const result = await syncStaleGoogleConnections(supabase, {
      userId: auth.ctx.userId,
      budgetMs: SYNC_BUDGET_MS,
    });

    // Subscribed ICS feeds refresh alongside: from the member's side "Sync now"
    // means every connected calendar, not the Google half of them. Best-effort
    // — one unreachable third-party URL must not fail a Google sync that
    // worked.
    let feeds = { refreshed: 0, failed: 0, skipped: 0 };
    try {
      feeds = await refreshStaleFeeds(supabase, { userId: auth.ctx.userId, force: true });
    } catch (err) {
      console.error("[/api/meetings/calendars/sync] feeds", err);
    }

    return NextResponse.json({
      // No connection is not an error: a member with only ICS feeds, or none at
      // all, pressed a button and nothing was wrong.
      connections: result.connections,
      upserted: result.upserted,
      deleted: result.deleted,
      failed: result.failed,
      incomplete: result.incomplete,
      feedsRefreshed: feeds.refreshed,
    });
  } catch (err) {
    console.error("[/api/meetings/calendars/sync] POST", err);
    return NextResponse.json({ error: "Couldn't sync your calendars." }, { status: 500 });
  }
}
