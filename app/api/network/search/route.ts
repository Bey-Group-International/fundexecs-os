// GET /api/network/search — ranked lexical search over the org's contacts.
//
// The search itself is Postgres (full text + trigram), so it returns without
// touching a model. `?ai=1` opts into a model-written relevance line per
// result; it is a second step the caller asks for, not a toll on every query.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { searchNetwork } from "@/lib/network-search";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LIMIT_PER_MIN = 60;

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ results: [] });

  const useAI = req.nextUrl.searchParams.get("ai") === "1";

  // The AI path costs an API call, so it gets its own, tighter budget.
  const policy = useAI
    ? { key: `org:${auth.ctx.orgId}:network-search-ai`, limit: 10, windowMs: 60_000 }
    : { key: `org:${auth.ctx.orgId}:network-search`, limit: LIMIT_PER_MIN, windowMs: 60_000 };
  const rateLimit = checkRateLimit(policy);
  if (!rateLimit.ok) {
    return NextResponse.json(
      {
        error: useAI
          ? "AI ranking is rate limited. Results below are unranked."
          : "Rate limit exceeded",
      },
      { status: 429, headers: rateLimitHeaders(rateLimit, policy.limit) },
    );
  }

  const parsed = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20;

  try {
    const results = await searchNetwork(q, {
      limit,
      useAI,
      stage: req.nextUrl.searchParams.get("stage"),
      capitalRole: req.nextUrl.searchParams.get("role"),
    });
    return NextResponse.json({ results, aiRanked: useAI }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[network/search]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
