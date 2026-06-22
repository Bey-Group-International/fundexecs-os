import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendFunnelRollups } from "@/lib/funnel-rollup-send";

// The Weekly Funnel Rollup sweep: build this week's Source Outcome Funnel for
// every org with enabled digest prefs, diff it against last week's snapshot, and
// push the "what changed in your funnel" rollup across the existing digest
// channels (in-app, Slack, email). Closes the funnel → proactive-digest loop.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/digest/weekly — the scheduled weekly funnel-rollup sweep (wired via
 * vercel.json crons).
 *
 * Runs without a user session, so it uses the service-role client and scopes
 * every read/write to the org. Protected by CRON_SECRET: Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>` automatically.
 */
export async function GET(request: Request) {
  // Require the secret — never run the sweep open, or any caller could trigger
  // rollup pushes. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured — the weekly rollup sweep is disabled" },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "The weekly rollup sweep requires SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  const summary = await sendFunnelRollups(supabase);
  return NextResponse.json(summary);
}
