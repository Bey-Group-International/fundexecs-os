import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { ACTIVE_TASK_STATUSES, buildActivityMap } from "@/lib/command-center-roster";

export const dynamic = "force-dynamic";

// GET /api/command-center/roster — the org's live executive activity overlay for
// the Command Center world: agentKey -> { task, progress }, from the org's
// active top-level tasks. Authed; a read, so no spend gate. Best-effort — any
// failure returns an empty overlay so the world simply renders idle.
export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { orgId } = auth.ctx;

  const rateLimit = checkRateLimit({
    key: `org:${orgId}:command-center-roster`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...rateLimitHeaders(rateLimit, 60) },
    });
  }

  try {
    const supabase = await createServerClient();
    const { data } = await supabase
      .from("tasks")
      .select("assigned_agent, title, status, progress")
      .eq("organization_id", orgId)
      .in("status", [...ACTIVE_TASK_STATUSES])
      .is("parent_task_id", null)
      .order("updated_at", { ascending: false })
      .limit(60);

    const activity = buildActivityMap(data ?? []);
    return new Response(JSON.stringify({ activity }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[command-center/roster] error:", err);
    return new Response(JSON.stringify({ activity: {} }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
