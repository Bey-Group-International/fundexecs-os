import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

// GET /api/health — infrastructure liveness probe.
// Protected with CRON_SECRET Bearer token so it is not open to the public
// (same pattern as /api/cron). Uses service-role client so the DB probe
// returns a real result even when there are no session cookies.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Compare byte lengths (not string code units) before timingSafeEqual to
  // avoid a throw when the header contains multi-byte characters.
  const aBytes = Buffer.from(authHeader);
  const eBytes = Buffer.from(expected);
  const matches = aBytes.length === eBytes.length && timingSafeEqual(aBytes, eBytes);
  if (!matches) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });
  }

  const ts = new Date().toISOString();
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("organizations").select("id").limit(1);
    if (error) throw error;
    return NextResponse.json({ status: "ok", db: "ok", ts });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error("[health] db probe failed", message);
    return NextResponse.json({ status: "degraded", db: "error", error: message, ts }, { status: 503 });
  }
}
