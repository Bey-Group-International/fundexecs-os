import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/health — infrastructure liveness probe.
// Protected with CRON_SECRET Bearer token so it is not open to the public
// (same pattern as /api/cron). Probes the DB and returns structured status.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ status: "degraded", error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ts = new Date().toISOString();
  try {
    const supabase = createServerClient();
    const { error } = await supabase.from("organizations").select("id").limit(1);
    if (error) throw error;
    return NextResponse.json({ status: "ok", db: "ok", ts });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error("[health] db probe failed", message);
    return NextResponse.json({ status: "degraded", db: "error", error: message, ts }, { status: 503 });
  }
}
