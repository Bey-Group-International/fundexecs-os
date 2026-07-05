// POST /api/earn/browser/extract
//
// REAL, compliant, browser-FREE live extraction for public sources that need no
// browser and no restricted scraping: SEC EDGAR (public JSON API) and public
// company / investor websites (plain HTTP GET). It runs the extraction engine,
// which produces a review record and enqueues a pending `earn_review_queue` row
// WITHOUT saving anything into real records — that only happens on approval.
//
// Authenticated / restricted sources (linkedin, gmail, google_*) are NOT done
// here: they honestly return `{ pending: true }` because they require the
// authenticated-browser driver that runs on the worker service (a separate seam).

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { loadSession, writeAudit } from "@/lib/earn/browser-operator/server";
import { BROWSER_DATA_SOURCES, type BrowserDataSource } from "@/lib/earn/browser-operator/types";
import {
  isLiveExtractionSource,
  runExtraction,
  type ExtractionTarget,
} from "@/lib/earn/browser-operator/extraction-engine.server";

export const dynamic = "force-dynamic";

// States from which extraction may legally begin (the machine also enforces this).
const EXTRACTABLE_STATES = new Set(["navigating", "user_auth_completed", "extracting"]);

type Payload = {
  id?: string;
  source?: string;
  target?: ExtractionTarget;
};

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
  const source = payload.source as BrowserDataSource | undefined;
  if (!source || !BROWSER_DATA_SOURCES.includes(source)) {
    return NextResponse.json({ error: "Required: source (a valid data source)." }, { status: 400 });
  }

  const supabase = await createServerClient();
  const session = await loadSession(supabase, payload.id, auth.ctx.orgId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Authenticated / restricted sources are honestly deferred to the worker seam.
  if (!isLiveExtractionSource(source)) {
    await writeAudit(supabase, {
      orgId: auth.ctx.orgId,
      sessionId: session.id,
      userId: auth.ctx.userId,
      input: {
        action: "extraction_started",
        sourceType: source,
        summary: `Live extraction for '${source}' requires the authenticated-browser worker seam.`,
      },
    });
    return NextResponse.json({
      pending: true,
      reason: `'${source}' requires an authenticated browser session on the worker service; not available in this seam.`,
    });
  }

  // Validate the session is in a state that can legally extract (defence in depth
  // — the state machine rejects illegal transitions again inside the engine).
  if (!EXTRACTABLE_STATES.has(session.status)) {
    return NextResponse.json(
      { error: `Cannot extract from '${session.status}'. The session must be navigating a permitted source first.` },
      { status: 409 },
    );
  }

  const result = await runExtraction(supabase, {
    session,
    source,
    target: payload.target ?? {},
  });

  if (!result.ok) {
    if (result.reason === "illegal_transition") {
      return NextResponse.json(
        { error: `Cannot extract from '${result.from ?? session.status}'.` },
        { status: 409 },
      );
    }
    if (result.reason === "policy_rejected") {
      return NextResponse.json({ error: result.message }, { status: 403 });
    }
    if (result.reason === "invalid_target") {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    if (result.reason === "no_data" || result.reason === "source_error") {
      return NextResponse.json({ error: result.message }, { status: 422 });
    }
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    sessionId: result.session.id,
    status: result.session.status,
    reviewQueueId: result.reviewQueueId,
    proposedDestination: result.destination,
    review: result.review,
    points: result.points,
  });
}
