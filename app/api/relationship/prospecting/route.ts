import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { buildProspectingPlanForOrg } from "@/lib/relationship/prospecting-copilot";
import { savePlan } from "@/lib/relationship/plan-history";

// POST /api/relationship/prospecting — Earn's prospecting copilot.
//
// Body: { goal: string }. Returns a reviewable, approval-gated ProspectingPlan
// (scored + segmented + compliance-gated prospects, routed to an executive
// agent with a recommended sequence). This route never sends outreach — the
// plan is a draft the user approves. Everything downstream (enrollment) still
// passes the compliance gate.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { orgId, userId } = auth.ctx;

  const rateLimit = checkRateLimit({ key: `org:${orgId}:prospecting`, limit: 20, windowMs: 60_000 });
  if (!rateLimit.ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...rateLimitHeaders(rateLimit, 20) },
    });
  }

  const { goal } = await request.json().catch(() => ({ goal: "" }));
  if (!goal || typeof goal !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'goal'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = await createServerClient();
  const plan = await buildProspectingPlanForOrg(supabase, orgId, goal);

  // Persist the run for history (best-effort — never blocks the response).
  const planId = await savePlan(supabase, orgId, userId, plan, goal);

  return new Response(JSON.stringify({ ...plan, planId }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
