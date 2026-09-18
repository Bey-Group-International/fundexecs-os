// GET /api/network/export — download the current roster view as CSV.
//
// Accepts the same filter parameters as /api/network/roster, so what downloads
// is what the operator is looking at, plus an optional `ids` list for "export
// selected". Exporting is the single highest-risk read in a CRM — it is how a
// relationship book leaves the building — so it is rate limited hard and always
// audited with the shape of what left.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { filterRoster, getRoster, parseRosterQuery, sortRoster } from "@/lib/network-roster";
import { rosterToCsv } from "@/lib/network-csv";
import { recordNetworkAudit } from "@/lib/network-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ROWS = 10_000;
const LIMIT_PER_HOUR = 10;

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-export`,
    limit: LIMIT_PER_HOUR,
    windowMs: 3_600_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Export rate limit exceeded. Try again shortly." },
      { status: 429, headers: rateLimitHeaders(rateLimit, LIMIT_PER_HOUR) },
    );
  }

  try {
    const params = req.nextUrl.searchParams;
    const query = parseRosterQuery(params);

    const supabase = await createServerClient();
    const { people } = await getRoster(supabase, auth.ctx.orgId);

    let rows = filterRoster(people, query);

    const idParam = params.get("ids");
    if (idParam) {
      const ids = new Set(idParam.split(",").map((s) => s.trim()).filter(Boolean));
      rows = rows.filter((p) => ids.has(p.id));
    }

    rows = sortRoster(rows, query.sort).slice(0, MAX_ROWS);

    await recordNetworkAudit(supabase as never, {
      orgId: auth.ctx.orgId,
      actorId: auth.ctx.userId,
      action: "export",
      entityType: "network_roster",
      metadata: {
        rows: rows.length,
        format: "csv",
        selection: idParam ? "selected" : "filtered_view",
        filters: {
          q: query.q || null,
          stage: query.stage,
          kind: query.kind,
          temp: query.temp,
          owner: query.owner,
          needsAttention: query.needsAttention,
        },
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(rosterToCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="network-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[network/export]", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
