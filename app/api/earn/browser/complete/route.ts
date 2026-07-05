// POST /api/earn/browser/complete
//
// Terminal success. Finalizes an operator-approved save: transitions
// `approved_for_save → saved` through the state machine (illegal from anywhere
// else → 409) and writes the `saved` + `session_completed` audit rows. Reaching
// `approved_for_save` requires the operator to have passed the review + save
// gates first — this route cannot bypass them.

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
    key: `org:${auth.ctx.orgId}:earn-browser-complete`,
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

  const result = await transitionSession(supabase, session, "save_complete", {
    save_approved: true,
  });

  if (!result.ok && result.reason === "illegal_transition") {
    return NextResponse.json(
      {
        error: `Cannot complete from '${result.from}'. The reviewed data must be approved for save first.`,
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
    input: { action: "saved", summary: "Approved data saved into the system." },
  });
  await writeAudit(supabase, {
    orgId: auth.ctx.orgId,
    sessionId: session.id,
    userId: auth.ctx.userId,
    input: { action: "session_completed" },
  });

  return NextResponse.json({ ok: true, session: result.session });
}
