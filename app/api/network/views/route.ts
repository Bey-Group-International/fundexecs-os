// Saved roster segments.
//
//   GET    — views you own plus the ones shared with the org.
//   POST   — save the current filter set under a name.
//   DELETE — remove one you own (or any, if you're an admin).
//
// A saved view stores the same filter shape /api/network/roster parses, so
// replaying one is just re-running the roster query — nothing is frozen, and a
// view opened next quarter reflects the book as it is then.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { parseRosterQuery, ROSTER_SORTS } from "@/lib/network-roster";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = (await createServerClient()) as any;
  const { data, error } = await supabase
    .from("network_saved_views")
    .select("id, name, description, filters, sort, is_shared, created_by, created_at")
    .eq("organization_id", auth.ctx.orgId)
    .order("name", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[network/views] read", error);
    return NextResponse.json({ error: "Failed to load saved views" }, { status: 500 });
  }

  return NextResponse.json({
    views: (data ?? []).map((v: Record<string, any>) => ({
      id: v.id,
      name: v.name,
      description: v.description ?? null,
      filters: v.filters ?? {},
      sort: v.sort ?? "warmth",
      isShared: v.is_shared === true,
      isMine: v.created_by === auth.ctx.userId,
      createdAt: v.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-views`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 30) },
    );
  }

  const payload = (await req.json().catch(() => null)) as {
    name?: string;
    description?: string;
    /** The roster query string, e.g. "stage=diligence&attention=1". */
    query?: string;
    isShared?: boolean;
  } | null;

  const name = payload?.name?.trim();
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  // Round-trip the query through the roster parser so only recognised,
  // bounded filters are ever stored — a saved view cannot smuggle a parameter
  // the roster endpoint would not have accepted.
  const parsed = parseRosterQuery(new URLSearchParams(payload?.query ?? ""));
  const filters = {
    q: parsed.q,
    temp: parsed.temp,
    kind: parsed.kind,
    stage: parsed.stage,
    owner: parsed.owner,
    category: parsed.category,
    committedOnly: parsed.committedOnly,
    introOnly: parsed.introOnly,
    needsAttention: parsed.needsAttention,
  };

  const supabase = (await createServerClient()) as any;
  const { data, error } = await supabase
    .from("network_saved_views")
    .upsert(
      {
        organization_id: auth.ctx.orgId,
        created_by: auth.ctx.userId,
        name: name.slice(0, 120),
        description: payload?.description?.slice(0, 500) || null,
        filters,
        sort: (ROSTER_SORTS as readonly string[]).includes(parsed.sort) ? parsed.sort : "warmth",
        is_shared: payload?.isShared === true,
      },
      { onConflict: "organization_id,created_by,name" },
    )
    .select("id, name, description, filters, sort, is_shared, created_at")
    .single();

  if (error || !data) {
    console.error("[network/views] upsert", error);
    return NextResponse.json({ error: "Failed to save that view" }, { status: 500 });
  }

  return NextResponse.json({
    view: {
      id: data.id,
      name: data.name,
      description: data.description ?? null,
      filters: data.filters ?? {},
      sort: data.sort ?? "warmth",
      isShared: data.is_shared === true,
      isMine: true,
      createdAt: data.created_at,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const supabase = (await createServerClient()) as any;
  // RLS decides whether this caller may delete it; a no-op delete is reported
  // as success because the end state the caller asked for is the end state.
  const { error } = await supabase
    .from("network_saved_views")
    .delete()
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id);

  if (error) {
    console.error("[network/views] delete", error);
    return NextResponse.json({ error: "Failed to delete that view" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
