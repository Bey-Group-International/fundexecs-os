import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadRelationshipDashboard } from "@/lib/relationship/relationship-dashboard";

// GET /api/relationship/dashboard — the Relationship Command Center: aggregated
// CRM counts, campaign performance, intent signals, and recommended next
// actions for the org. Read-only.
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
  const dashboard = await loadRelationshipDashboard(supabase, auth.ctx.orgId);
  return new Response(JSON.stringify(dashboard), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
