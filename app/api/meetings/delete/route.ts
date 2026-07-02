import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    meetingId?: string;
    clearAll?: boolean;
    soft?: boolean;
  };

  // deleted_at added in migration 20260702000003; types not yet regenerated
  const softPayload = { deleted_at: new Date().toISOString() } as any; // eslint-disable-line

  if (body.clearAll) {
    if (body.soft) {
      const { error } = await supabase
        .from("live_meetings")
        .update(softPayload)
        .eq("host_id", user.id)
        .is("deleted_at", null);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await supabase
        .from("live_meetings")
        .delete()
        .eq("host_id", user.id);
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
      .eq("host_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("live_meetings")
      .delete()
      .eq("id", body.meetingId)
      .eq("host_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
