import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadInterestSignals } from "@/lib/relationship/interest-signals";

// GET /api/relationship/signals — first-party intent signals for the org:
// engagement across deal shares, data room, marketplace, and the investor
// portal, aggregated into per-source totals and a ranked list of the most
// engaged parties. Read-only.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const supabase = await createServerClient();
  const signals = await loadInterestSignals(supabase, auth.ctx.orgId);
  return new Response(JSON.stringify(signals), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
