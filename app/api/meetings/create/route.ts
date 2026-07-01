import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

function generateRoomCode(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 10; i++) {
    if (i === 3 || i === 7) code += "-";
    else code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as { title?: string; orgId?: string };
    const roomCode = generateRoomCode();

    const { data, error } = await supabase
      .from("live_meetings")
      .insert({
        room_code: roomCode,
        title: body.title?.trim() || "Meeting",
        host_id: user.id,
        organization_id: body.orgId ?? null,
        status: "waiting",
      })
      .select("id, room_code")
      .single();

    if (error) throw error;
    return NextResponse.json({ id: data.id, roomCode: data.room_code });
  } catch (err) {
    console.error("[/api/meetings/create]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create meeting" },
      { status: 500 },
    );
  }
}
