import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function generateRoomCode(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 10; i++) {
    if (i === 3 || i === 7) { code += "-"; continue; }
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as { title?: string; orgId?: string; dealId?: string; roomCode?: string };

    // Defense-in-depth alongside the live_meetings_insert RLS policy
    // (20260703190000): don't trust an org id from the request body without
    // checking the caller actually belongs to it — otherwise any
    // authenticated user could attribute a meeting to an org they aren't a
    // member of, and it would appear in that org's meeting list for every
    // real member.
    if (body.orgId) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("principal_id", user.id)
        .eq("organization_id", body.orgId)
        .maybeSingle();
      if (!membership) {
        return NextResponse.json({ error: "Not a member of that organization" }, { status: 403 });
      }
    }

    const roomCode = body.roomCode ?? generateRoomCode();

    const { data, error } = await (supabase
      .from("live_meetings") as any)
      .upsert(
        {
          room_code: roomCode,
          title: body.title?.trim() || "Meeting",
          host_id: user.id,
          organization_id: body.orgId ?? null,
          deal_id: body.dealId ?? null,
          status: "waiting",
        },
        { onConflict: "room_code", ignoreDuplicates: false },
      )
      .select("id, room_code, host_id")
      .single();

    if (error) throw error;
    return NextResponse.json({ id: data.id, roomCode: data.room_code, hostId: data.host_id });
  } catch (err) {
    console.error("[/api/meetings/create]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create meeting" },
      { status: 500 },
    );
  }
}
