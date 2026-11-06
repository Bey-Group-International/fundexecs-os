// app/api/meetings/[id]/chat/pin/route.ts
// Pin one chat message to the top of the meeting's chat, or clear the pin.
//
// Host only, decided here from the session — never from the body. The room
// hears about a pin over its broadcast channel at once; this is what makes it
// survive for somebody who joins later, who reads it with the chat history.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { authorizeMeetingMember } from "@/lib/meetings/meeting-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SupabaseLike = { from: (table: string) => any };

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const member = await authorizeMeetingMember(id);
  if (!member.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!member.isHost) return NextResponse.json({ error: "Only the host can pin a message." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { messageId?: unknown };
  const messageId =
    body.messageId === null ? null : typeof body.messageId === "string" && body.messageId.length <= 64 ? body.messageId : undefined;
  if (messageId === undefined) {
    return NextResponse.json({ error: "Say which message to pin, or null to clear the pin." }, { status: 422 });
  }

  const authed = (await createServerClient()) as SupabaseLike;
  const db: SupabaseLike = hasSupabaseServiceEnv() ? (createServiceClient() as SupabaseLike) : authed;

  // The message must be this meeting's: a pin pointing at another meeting's
  // chat would show its words in a room that never saw them.
  if (messageId) {
    const { data: row } = await db
      .from("live_meeting_chat")
      .select("id")
      .eq("id", messageId)
      .eq("meeting_id", id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "That message is not in this meeting's chat." }, { status: 404 });
  }

  const { error } = await db.from("live_meetings").update({ pinned_chat_message_id: messageId }).eq("id", id);
  if (error) {
    console.error("[/api/meetings/[id]/chat/pin] could not save the pin", error.message);
    return NextResponse.json({ error: "Could not pin that message." }, { status: 500 });
  }
  return NextResponse.json({ pinned: messageId });
}
