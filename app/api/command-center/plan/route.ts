import { requireOrgContext } from "@/lib/auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { CONVERSATIONAL_COST, gateConversationalSpend } from "@/lib/conversational-gate";
import { planLiveEarn } from "@/lib/command-center-live";

// Planning a flow calls Claude; give it room beyond the default request window.
export const maxDuration = 60;

// POST /api/command-center/plan — turn an operator directive into the Command
// Center's Earn timeline (flow kind + Step[]), with Earn's dialogue synthesized
// by Claude. Authed like the rest of the (app) surface; the spend gate is a
// no-op when Claude isn't configured, so the deterministic fallback runs free.
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { orgId } = auth.ctx;

  const rateLimit = checkRateLimit({
    key: `org:${orgId}:command-center-plan`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...rateLimitHeaders(rateLimit, 30) },
    });
  }

  const { prompt } = await request.json().catch(() => ({ prompt: "" }));
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return new Response(JSON.stringify({ error: "Missing 'prompt'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const gate = await gateConversationalSpend(orgId, CONVERSATIONAL_COST.promptPlan, "command-center-plan");
  if (!gate.ok) {
    return new Response(JSON.stringify({ error: gate.error }), {
      status: gate.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const plan = await planLiveEarn({ prompt });
  return new Response(JSON.stringify(plan), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
