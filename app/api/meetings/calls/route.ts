// app/api/meetings/calls/route.ts
// The recorded calls: a page of them, a search of what was said in them, a
// narrowed range, and the page after the last one shown.
//
// Searching is done here rather than in the browser because the alternative is
// shipping every transcript the organisation has ever recorded to a laptop so
// it can grep them — which is slow on the first call and untenable by the
// fiftieth. Postgres narrows; transcript-search.ts, the same function the
// report page highlights with, decides the matches and the snippet. The query
// itself lives in call-archive.server.ts, shared with the page's first render.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadCallPage } from "@/lib/meetings/call-archive.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = req.nextUrl.searchParams;
  const supabase = await createServerClient();
  try {
    const page = await loadCallPage(
      supabase,
      { userId: auth.ctx.userId, orgId: auth.ctx.orgId },
      { query: params.get("q") ?? "", before: params.get("before"), since: params.get("since") },
    );
    return NextResponse.json(page);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load calls" },
      { status: 500 },
    );
  }
}
