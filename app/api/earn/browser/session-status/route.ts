// GET /api/earn/browser/session-status?id=<sessionId>
//
// Return a session plus its recent audit trail, org-scoped. Used by the control
// panel to poll live status.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { loadSession } from "@/lib/earn/browser-operator/server";
import type { EarnBrowserAuditLog } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:earn-browser-status`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 120) },
    );
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Required: ?id=<sessionId>." }, { status: 400 });
  }

  const supabase = await createServerClient();
  const session = await loadSession(supabase, id, auth.ctx.orgId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: audit } = await supabase
    .from("earn_browser_audit_logs")
    .select("*")
    .eq("session_id", id)
    .eq("organization_id", auth.ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    ok: true,
    session,
    audit: (audit ?? []) as EarnBrowserAuditLog[],
  });
}
