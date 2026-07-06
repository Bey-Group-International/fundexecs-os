import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { enrollListReady } from "@/lib/relationship/prospect-enrollment";

// POST /api/relationship/prospecting/enroll — enroll a saved list's
// outreach-ready contacts into a sequence. Body: { listId, templateKey,
// allowUnreviewed? }. Every contact passes the compliance + review gates before
// enrollment. Enrollment schedules the sequence; sending stays a separate,
// gated step.
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

  const rateLimit = checkRateLimit({ key: `org:${orgId}:prospecting-enroll`, limit: 10, windowMs: 60_000 });
  if (!rateLimit.ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...rateLimitHeaders(rateLimit, 10) },
    });
  }

  const payload = await request.json().catch(() => ({}));
  const listId = typeof payload.listId === "string" ? payload.listId : "";
  const templateKey = typeof payload.templateKey === "string" ? payload.templateKey : "";
  const allowUnreviewed = Boolean(payload.allowUnreviewed);
  if (!listId || !templateKey) {
    return new Response(JSON.stringify({ error: "Missing 'listId' or 'templateKey'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = await createServerClient();
    const result = await enrollListReady(supabase, orgId, userId, { listId, templateKey, allowUnreviewed });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Enroll failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
