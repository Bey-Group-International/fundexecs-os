// POST /api/earn/browser/resume
//
// The auth-handoff resume. Only valid from `paused_for_user_auth`: after the
// operator has signed in directly (Earn never sees the credentials), they tell
// Earn to continue. Marks the handoff complete, transitions to
// `user_auth_completed`, and audits it. Illegal from any other status → 409.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { loadSession, transitionSession, writeAudit } from "@/lib/earn/browser-operator/server";

export const dynamic = "force-dynamic";

type Payload = { id?: string };

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:earn-browser-resume`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 30) },
    );
  }

  const payload = (await req.json().catch(() => null)) as Payload | null;
  if (!payload?.id) {
    return NextResponse.json({ error: "Required: id (session id)." }, { status: 400 });
  }

  const supabase = await createServerClient();
  const session = await loadSession(supabase, payload.id, auth.ctx.orgId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const result = await transitionSession(supabase, session, "resume_after_auth", {
    auth_handoff_completed: true,
  });

  if (!result.ok && result.reason === "illegal_transition") {
    return NextResponse.json(
      {
        error: `Cannot resume from '${result.from}'. Resume is only valid while paused for user authentication.`,
      },
      { status: 409 },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await writeAudit(supabase, {
    orgId: auth.ctx.orgId,
    sessionId: session.id,
    userId: auth.ctx.userId,
    input: { action: "user_auth_completed", summary: "Operator confirmed sign-in; Earn resumed." },
  });

  return NextResponse.json({ ok: true, session: result.session });
}
