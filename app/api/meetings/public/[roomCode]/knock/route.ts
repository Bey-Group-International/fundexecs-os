import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Waiting-room "knock" for anyone joining a meeting who isn't the host — including
// unauthenticated invite-link guests, which is why this uses the service role
// (like the public room lookup) and is keyed by a client-generated guest_key
// rather than auth. Knocking is idempotent: an existing knock returns its current
// decision, so re-POSTs (and reconnects) never reset an admit/deny.

function client() {
  return hasSupabaseServiceEnv() ? createServiceClient() : null;
}

async function resolveMeeting(code: string) {
  const supabase = client() ?? (await createServerClient());
  const { data } = await supabase
    .from("live_meetings")
    .select("id, organization_id, status")
    .eq("room_code", code)
    .is("deleted_at", null)
    .maybeSingle();
  return { supabase, meeting: data as { id: string; organization_id: string | null; status: string } | null };
}

// POST — record (or look up) this guest's knock. Returns the current status.
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = await params;
  const code = roomCode?.trim();
  if (!code) return NextResponse.json({ error: "Missing room code" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { guestKey?: string; displayName?: string };
  const guestKey = typeof body.guestKey === "string" ? body.guestKey.trim() : "";
  const displayName = (typeof body.displayName === "string" && body.displayName.trim()) || "Guest";
  if (!guestKey) return NextResponse.json({ error: "guestKey required" }, { status: 400 });

  const { supabase, meeting } = await resolveMeeting(code);
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (meeting.status === "ended") return NextResponse.json({ status: "ended" });

  // Return the existing decision rather than clobbering it.
  const { data: existing } = await (supabase as any)
    .from("live_meeting_admissions")
    .select("id, status")
    .eq("meeting_id", meeting.id)
    .eq("guest_key", guestKey)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ admissionId: existing.id as string, status: existing.status as string });
  }

  const { data: inserted, error } = await (supabase as any)
    .from("live_meeting_admissions")
    .insert({
      meeting_id: meeting.id,
      organization_id: meeting.organization_id,
      guest_key: guestKey,
      display_name: displayName,
      status: "waiting",
    })
    .select("id, status")
    .maybeSingle();
  if (error || !inserted) return NextResponse.json({ error: "Could not knock" }, { status: 500 });
  return NextResponse.json({ admissionId: inserted.id as string, status: inserted.status as string });
}

// GET ?key=<guestKey> — poll the decision. Guests can't use RLS/Realtime, so they
// poll this while on the waiting screen.
export async function GET(req: NextRequest, { params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = await params;
  const code = roomCode?.trim();
  const guestKey = req.nextUrl.searchParams.get("key")?.trim() ?? "";
  if (!code || !guestKey) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { supabase, meeting } = await resolveMeeting(code);
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (meeting.status === "ended") return NextResponse.json({ status: "ended" });

  const { data } = await (supabase as any)
    .from("live_meeting_admissions")
    .select("status")
    .eq("meeting_id", meeting.id)
    .eq("guest_key", guestKey)
    .maybeSingle();
  return NextResponse.json({ status: (data?.status as string | undefined) ?? "unknown" });
}
