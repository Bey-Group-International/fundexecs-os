// Who is already in a room, for the screen before it.
//
// The pre-join screen used to say nothing about the room behind it, so a guest
// could not tell an empty room from a full one, or a host who had not arrived
// from one ignoring them. This says how many people are in, since when, and
// whether the host is among them — to anyone holding the link, as the invite
// screen already says the meeting exists. NAMES only go to a signed-in member
// of the meeting's organisation, who could read them on the meetings list
// anyway; an anonymous link-holder learns a head-count and nothing about who.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { roomSnapshot } from "@/lib/meetings/room-presence";
import type { ParticipantRow } from "@/lib/meetings/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The screen polls about every fifteen seconds, and its connection check makes
// three quick reads on opening; this leaves room for several tabs.
const LIMIT = 40;
const WINDOW_MS = 60_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ roomCode: string }> }) {
  const limit = checkRateLimit({ key: `room-presence:${clientIp(req)}`, limit: LIMIT, windowMs: WINDOW_MS });
  if (!limit.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: rateLimitHeaders(limit, LIMIT) });
  }

  const { roomCode } = await params;
  const code = roomCode?.trim();
  if (!code) return NextResponse.json({ error: "Missing room code" }, { status: 400 });

  try {
    const supabase = hasSupabaseServiceEnv() ? createServiceClient() : await createServerClient();
    const { data: meeting } = await supabase
      .from("live_meetings")
      .select("id, host_id, organization_id, status")
      .eq("room_code", code)
      .is("deleted_at", null)
      .maybeSingle();
    const m = meeting as { id: string; host_id: string | null; organization_id: string | null; status: string } | null;
    if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: rows } = await supabase
      .from("live_meeting_participants")
      .select("meeting_id, display_name, joined_at, left_at, user_id, guest_key")
      .eq("meeting_id", m.id)
      .is("left_at", null)
      .limit(200);

    // Names for a signed-in member of the meeting's organisation only.
    let withNames = false;
    try {
      const own = await createServerClient();
      const { data: auth } = await own.auth.getUser();
      const userId = auth?.user?.id;
      if (userId && m.organization_id) {
        const { data: member } = await supabase
          .from("organization_members")
          .select("principal_id")
          .eq("organization_id", m.organization_id)
          .eq("principal_id", userId)
          .maybeSingle();
        withNames = Boolean(member);
      }
    } catch {
      // No session: a head-count only.
    }

    const snapshot = roomSnapshot((rows ?? []) as ParticipantRow[], m.host_id, { withNames });
    return NextResponse.json(
      { ...snapshot, ended: m.status === "ended" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[/api/meetings/public/[roomCode]/presence] GET", err);
    return NextResponse.json({ error: "Could not read the room" }, { status: 500 });
  }
}
