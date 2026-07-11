import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export async function DELETE(req: NextRequest) {
  // Scope every delete to the caller's ACTIVE org. Scoping by host_id alone let a
  // user who hosts meetings in multiple orgs wipe meetings across all of them with
  // clearAll — this bounds it to the org whose meetings they're actually viewing.
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const supabase = await createServerClient();

  const body = (await req.json().catch(() => ({}))) as {
    meetingId?: string;
    clearAll?: boolean;
    soft?: boolean;
  };

  // deleted_at added in migration 20260702000003; types not yet regenerated
  const softPayload = { deleted_at: new Date().toISOString() } as any;

  if (body.clearAll) {
    if (body.soft) {
      const { error } = await supabase
        .from("live_meetings")
        .update(softPayload)
        .eq("organization_id", auth.ctx.orgId)
        .eq("host_id", auth.ctx.userId)
        .is("deleted_at", null);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await supabase
        .from("live_meetings")
        .delete()
        .eq("organization_id", auth.ctx.orgId)
        .eq("host_id", auth.ctx.userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!body.meetingId) {
    return NextResponse.json({ error: "meetingId required" }, { status: 400 });
  }

  if (body.soft) {
    const { error } = await supabase
      .from("live_meetings")
      .update(softPayload)
      .eq("id", body.meetingId)
      .eq("organization_id", auth.ctx.orgId)
      .eq("host_id", auth.ctx.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("live_meetings")
      .delete()
      .eq("id", body.meetingId)
      .eq("organization_id", auth.ctx.orgId)
      .eq("host_id", auth.ctx.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
