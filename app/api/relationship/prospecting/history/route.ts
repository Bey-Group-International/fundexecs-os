import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { listPlanHistory, getPlan } from "@/lib/relationship/plan-history";

// GET /api/relationship/prospecting/history — recent prospecting runs (summary
// only). With ?id=<planId>, returns the full stored plan for re-rendering.
// Read-only, org-scoped.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const supabase = await createServerClient();
  const id = new URL(request.url).searchParams.get("id");

  const payload = id
    ? { plan: await getPlan(supabase, auth.ctx.orgId, id) }
    : { entries: await listPlanHistory(supabase, auth.ctx.orgId) };

  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
