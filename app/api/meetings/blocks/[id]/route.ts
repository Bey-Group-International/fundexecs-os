// Adjust or clear one blocked span. RLS scopes both to the owner, and the
// explicit user_id filter means someone else's id resolves as not-found rather
// than as a silent no-op that reports success.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { serializeBlock, validateBlock } from "@/lib/meetings/blocks";
import type { SchedulingBlock } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      startsAt?: string;
      endsAt?: string;
    };

    const supabase = await createServerClient();
    const { data: prior } = await supabase
      .from("scheduling_blocks")
      .select("*")
      .eq("id", id)
      .eq("user_id", auth.ctx.userId)
      .maybeSingle();
    if (!prior) return NextResponse.json({ error: "Blocked time not found" }, { status: 404 });

    const current = prior as unknown as SchedulingBlock;
    // Validate the whole span, not just the edited half: moving only the start
    // past the existing end has to fail the same way setting both would.
    const valid = validateBlock({
      title: body.title ?? current.title,
      startsAt: body.startsAt ?? current.starts_at,
      endsAt: body.endsAt ?? current.ends_at,
    });
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 422 });

    const { data, error } = await supabase
      .from("scheduling_blocks")
      .update({
        title: valid.title,
        starts_at: valid.startsAt,
        ends_at: valid.endsAt,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", id)
      .eq("user_id", auth.ctx.userId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Blocked time not found" }, { status: 404 });

    return NextResponse.json({ block: serializeBlock(data as unknown as SchedulingBlock) });
  } catch (err) {
    console.error("[/api/meetings/blocks/[id]] PATCH", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update blocked time" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const supabase = await createServerClient();
    // Blocks are hard-deleted. There is nothing to preserve — no room, no
    // history, no attendee who was told about it — and leaving a soft-deleted
    // row behind risks it still blocking slots.
    const { data, error } = await supabase
      .from("scheduling_blocks")
      .delete()
      .eq("id", id)
      .eq("user_id", auth.ctx.userId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Blocked time not found" }, { status: 404 });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[/api/meetings/blocks/[id]] DELETE", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to clear blocked time" },
      { status: 500 },
    );
  }
}
