import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadNetworkActivity, loadNetworkLiveCounts } from "@/lib/network-active";

// GET /api/network/activity — the live network pulse. Returns the chronological
// activity feed plus cheap count-only "live" metrics so the Network page can
// poll on an interval for a near-real-time view without re-running the full
// capital map. Read-only.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get("limit") ?? "40", 10) || 40));

  try {
    const supabase = await createServerClient();
    const [events, live] = await Promise.all([
      loadNetworkActivity(supabase, auth.ctx.orgId, limit),
      loadNetworkLiveCounts(supabase, auth.ctx.orgId),
    ]);
    return NextResponse.json(
      { events, live },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[network/activity]", err);
    return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
  }
}
