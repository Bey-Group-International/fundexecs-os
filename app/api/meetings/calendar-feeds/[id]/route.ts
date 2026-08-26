// One external calendar connection: refresh it now, pause it, or disconnect.
// RLS scopes every operation to the owner, and the explicit user_id filter
// makes someone else's id resolve as not-found rather than a silent no-op.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { fetchFeed, recordFeedResult } from "@/lib/calendar/feeds.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      action?: "refresh";
      label?: string;
      isActive?: boolean;
    };

    const supabase = await createServerClient();
    const { data: feed } = await supabase
      .from("calendar_feeds")
      .select("id, url")
      .eq("id", id)
      .eq("user_id", auth.ctx.userId)
      .maybeSingle();
    if (!feed) return NextResponse.json({ error: "Calendar not found" }, { status: 404 });

    if (body.action === "refresh") {
      const result = await fetchFeed((feed as { url: string }).url);
      await recordFeedResult(supabase, id, result);
      return NextResponse.json(
        result.ok
          ? { ok: true, eventCount: result.eventCount ?? 0 }
          : { ok: false, error: result.error },
        { status: result.ok ? 200 : 502 },
      );
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.label === "string") patch.label = body.label.trim().slice(0, 80) || "External calendar";
    if (typeof body.isActive === "boolean") patch.is_active = body.isActive;

    const { error } = await supabase
      .from("calendar_feeds")
      .update(patch as never)
      .eq("id", id)
      .eq("user_id", auth.ctx.userId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/meetings/calendar-feeds/[id]] PATCH", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update that calendar" },
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
    // Hard delete: the row holds a credential to someone's calendar, so there
    // is nothing worth keeping once they disconnect it.
    const { data, error } = await supabase
      .from("calendar_feeds")
      .delete()
      .eq("id", id)
      .eq("user_id", auth.ctx.userId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Calendar not found" }, { status: 404 });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[/api/meetings/calendar-feeds/[id]] DELETE", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to disconnect that calendar" },
      { status: 500 },
    );
  }
}
