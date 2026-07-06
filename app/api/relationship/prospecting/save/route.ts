import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { savePlanToCrm, type PlanProspectLike } from "@/lib/relationship/prospect-persistence";

// POST /api/relationship/prospecting/save — persist a prospecting plan into the
// CRM. Body: { goalText: string, prospects: [{ candidate: {...} }] }. Writes
// deduplicated, consent-stamped contacts and a saved list, RLS-scoped to the
// caller's org. Returns a summary. Never sends outreach.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { orgId, userId } = auth.ctx;

  const rateLimit = checkRateLimit({ key: `org:${orgId}:prospecting-save`, limit: 20, windowMs: 60_000 });
  if (!rateLimit.ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...rateLimitHeaders(rateLimit, 20) },
    });
  }

  const payload = await request.json().catch(() => ({}));
  const goalText = typeof payload.goalText === "string" ? payload.goalText : "";
  const prospects: PlanProspectLike[] = Array.isArray(payload.prospects) ? payload.prospects : [];
  if (!goalText || prospects.length === 0) {
    return new Response(JSON.stringify({ error: "Missing 'goalText' or 'prospects'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = await createServerClient();
    const result = await savePlanToCrm(supabase, orgId, userId, { prospects, goalText });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Save failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
