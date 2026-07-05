// POST /api/earn/browser/extract
//
// SEAM. Live extraction requires the browser driver, which is out of scope for
// this Phase-1 foundation. This route audits that extraction was requested and
// returns a `pending` marker rather than scraping anything. When the driver
// lands, this is where it plugs in: extract → normalize → enqueue a
// earn_review_queue row for field-level operator review.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { loadSession, writeAudit } from "@/lib/earn/browser-operator/server";

export const dynamic = "force-dynamic";

type Payload = { id?: string };

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:earn-browser-extract`,
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

  await writeAudit(supabase, {
    orgId: auth.ctx.orgId,
    sessionId: session.id,
    userId: auth.ctx.userId,
    input: {
      action: "extraction_started",
      url: session.current_url,
      summary: "Extraction requested — awaiting the browser driver seam.",
    },
  });

  return NextResponse.json({
    pending: true,
    reason: "Live extraction is a seam pending the browser driver",
  });
}
