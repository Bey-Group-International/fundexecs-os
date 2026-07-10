import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Minimal public lookup of a meeting by its room code, so an invitee who does
 * not yet have a FundExecs account can render the invite screen and join as a
 * guest. The room code is the access capability (like a Zoom/Meet link), so the
 * service role is used to bypass the org-scoped RLS on live_meetings — but ONLY
 * non-sensitive fields are returned. Attendees, objective, agenda, notes, and
 * everything else stay RLS-protected and are never exposed to anonymous callers.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  const { roomCode } = await params;
  const code = roomCode?.trim();
  if (!code) return NextResponse.json({ error: "Missing room code" }, { status: 400 });

  // Prefer the service role (works for anonymous guests). Where it isn't
  // configured (e.g. local dev), fall back to the request-scoped client, which
  // still resolves the meeting for authenticated org members.
  const supabase = hasSupabaseServiceEnv() ? createServiceClient() : await createServerClient();

  const { data, error } = await supabase
    .from("live_meetings")
    .select("id, title, status")
    .eq("room_code", code)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = data as { id: string; title: string | null; status: string };
  return NextResponse.json({ id: row.id, title: row.title ?? "Meeting", status: row.status });
}
