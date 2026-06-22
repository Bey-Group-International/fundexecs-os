import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendRadarDigests } from "@/lib/radar-send";

// The Act-now Radar digest sweep: build + compose + push the ranked sourcing
// brief to every org with enabled, due delivery prefs (in-app, Slack, email).
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/digest — the scheduled digest sweep (wired via vercel.json crons).
 *
 * Runs without a user session, so it uses the service-role client and scopes
 * every write to the pref's own organization. Protected by CRON_SECRET: Vercel
 * Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
 */
export async function GET(request: Request) {
  // Require the secret — never run the sweep open, or any caller could trigger
  // digest pushes. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured — the digest sweep is disabled" },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "The digest sweep requires SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  const summary = await sendRadarDigests(supabase);
  return NextResponse.json(summary);
}
