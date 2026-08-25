// Manually blocked time on a member's calendar: list a window, or block a new
// one. A block belongs to the signed-in member, never to the org at large —
// RLS scopes both directions, and the insert stamps user_id from the session
// rather than trusting the body.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { serializeBlock, validateBlock } from "@/lib/meetings/blocks";
import type { SchedulingBlock } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Widest window a single list call will read, so a bad `from` can't scan all history. */
const MAX_RANGE_DAYS = 400;
const LIST_LIMIT = 500;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 86_400_000);
    const to = toParam ? new Date(toParam) : new Date(Date.now() + 120 * 86_400_000);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json({ error: "Invalid date range." }, { status: 422 });
    }
    if (to <= from) return NextResponse.json({ error: "The range has to end after it starts." }, { status: 422 });
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `Ask for at most ${MAX_RANGE_DAYS} days at a time.` }, { status: 422 });
    }

    const supabase = await createServerClient();
    // A block starting before the window can still run into it, so the lower
    // bound is on ends_at — the same reason busyIntervals looks back.
    const { data, error } = await supabase
      .from("scheduling_blocks")
      .select("*")
      .eq("user_id", auth.ctx.userId)
      .gt("ends_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .order("starts_at", { ascending: true })
      .limit(LIST_LIMIT);
    if (error) throw new Error(error.message);

    return NextResponse.json({
      blocks: ((data ?? []) as unknown as SchedulingBlock[]).map(serializeBlock),
    });
  } catch (err) {
    console.error("[/api/meetings/blocks] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load blocked time" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      startsAt?: string;
      endsAt?: string;
    };
    const valid = validateBlock(body);
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 422 });

    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("scheduling_blocks")
      .insert({
        // From the session, never the body: a member may only block their own time.
        user_id: auth.ctx.userId,
        organization_id: auth.ctx.orgId,
        title: valid.title,
        starts_at: valid.startsAt,
        ends_at: valid.endsAt,
      } as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ block: serializeBlock(data as unknown as SchedulingBlock) }, { status: 201 });
  } catch (err) {
    console.error("[/api/meetings/blocks] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to block that time" },
      { status: 500 },
    );
  }
}
