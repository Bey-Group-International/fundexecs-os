// POST /api/earn/browser/start
//
// Kick off a browser-operator session. Builds a scope card from the prompt,
// creates the session in `awaiting_user_approval` (nothing opens until the
// operator approves), writes the `scope_created` audit row, and returns the
// scope card + session id for the approval UI.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { buildScopeCard, scopeRequiresUserAuth } from "@/lib/earn/browser-operator";
import type { EarnBrowserSession, Json } from "@/lib/supabase/database.types";
import { writeAudit } from "@/lib/earn/browser-operator/server";

export const dynamic = "force-dynamic";

type Payload = { prompt?: string; taskId?: string | null };

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:earn-browser-start`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 20) },
    );
  }

  const payload = (await req.json().catch(() => null)) as Payload | null;
  const prompt = payload?.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "Required: prompt (what should Earn research?)." }, { status: 400 });
  }

  const scope = buildScopeCard(prompt);
  const requiresUserAuth = scopeRequiresUserAuth(scope);

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("earn_browser_sessions")
    .insert({
      organization_id: auth.ctx.orgId,
      user_id: auth.ctx.userId,
      task_id: payload?.taskId ?? null,
      status: "awaiting_user_approval",
      requested_prompt: prompt,
      approved_scope: scope as unknown as Json,
      requires_user_auth: requiresUserAuth,
      review_required: true,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not create session" }, { status: 500 });
  }

  const session = data as EarnBrowserSession;
  await writeAudit(supabase, {
    orgId: auth.ctx.orgId,
    sessionId: session.id,
    userId: auth.ctx.userId,
    input: { action: "scope_created", summary: `Scope proposed for: ${prompt}` },
  });

  return NextResponse.json({
    ok: true,
    sessionId: session.id,
    status: session.status,
    requiresUserAuth,
    scope,
  });
}
