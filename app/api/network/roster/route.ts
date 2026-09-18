// GET /api/network/roster — a filtered, sorted, paged slice of the active
// network.
//
// The Network page used to render the whole roster into the initial HTML and
// let the browser do the filtering. This endpoint is what replaces that: the
// server composes once (cached briefly per org), applies the query, and returns
// one page plus the facet counts the filter chips need. Read-only.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { applyRosterQuery, getRoster, parseRosterQuery } from "@/lib/network-roster";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LIMIT_PER_MIN = 120;

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Paging and filtering are chatty by nature, so the ceiling is generous —
  // it exists to stop a runaway client, not to pace normal use.
  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-roster`,
    limit: LIMIT_PER_MIN,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, LIMIT_PER_MIN) },
    );
  }

  try {
    const query = parseRosterQuery(req.nextUrl.searchParams);
    const supabase = await createServerClient();
    const { people, pulse } = await getRoster(supabase, auth.ctx.orgId, {
      fresh: req.nextUrl.searchParams.get("fresh") === "1",
    });

    return NextResponse.json(applyRosterQuery(people, query, pulse), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[network/roster]", err);
    return NextResponse.json({ error: "Failed to load roster" }, { status: 500 });
  }
}
