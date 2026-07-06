import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadCampaignAnalytics } from "@/lib/relationship/campaign-analytics";

// GET /api/relationship/campaigns — campaign analytics for the org: per-cadence
// enrollment counts (active / completed / stopped / replied) + reply rate, plus
// org-wide totals. Read-only.
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
  const analytics = await loadCampaignAnalytics(supabase, auth.ctx.orgId);
  return new Response(JSON.stringify(analytics), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
