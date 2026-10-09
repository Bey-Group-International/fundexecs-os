// app/api/meetings/public/[roomCode]/report-link/route.ts
// A guest's link to the report of the meeting they were in.
//
// Unauthenticated, like the knock endpoints beside it, because the person it
// is for has no account to authenticate with. What they have is the room code
// and the guest key their browser knocked with — and the host's decision to
// admit that key, which is the one fact here that nobody can mint for
// themselves. That is the same door `authorizeMeetingCaller` opens for a
// guest's transcript lines and chat, so a guest who could write into the
// meeting can read its summary, and nobody else can.
//
// What it hands back is a signed, expiring link of the kind the summary email
// carries (lib/meetings/report-share.server.ts), naming the guest by a digest
// of their key. The page it opens is read-only and holds the summary alone —
// never the transcript, chat or recording, which stay behind the meeting's own
// rules. `ready` says whether there is anything to read yet, so the thank-you
// screen can say "the summary is being written" instead of handing over a
// link that opens on a holding page without warning.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { guestReportShareUrl } from "@/lib/meetings/report-share.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A guest asks once, on the way out, and maybe again on a reload of that
 * screen. This is far above that and well below a loop — and the admission
 * check behind it is one indexed lookup, so the bound is about not being an
 * oracle for which (room, key) pairs are real rather than about load.
 */
const LINK_LIMIT = 30;
const LINK_WINDOW_MS = 60_000;

type SupabaseLike = { from: (table: string) => any };

export async function POST(req: NextRequest, { params }: { params: Promise<{ roomCode: string }> }) {
  const limit = checkRateLimit({ key: `report-link:${clientIp(req)}`, limit: LINK_LIMIT, windowMs: LINK_WINDOW_MS });
  if (!limit.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: rateLimitHeaders(limit, LINK_LIMIT) });
  }

  const { roomCode } = await params;
  const code = roomCode?.trim();
  if (!code) return NextResponse.json({ error: "Missing room code" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { guestKey?: unknown };
  const guestKey = typeof body.guestKey === "string" ? body.guestKey.trim() : "";
  if (!guestKey) return NextResponse.json({ error: "guestKey required" }, { status: 400 });

  // The link is signed with a key derived from the service-role key and the
  // page it opens reads with the service role, so without that key there is
  // nothing to hand out. Said as 503 rather than 401: the guest did nothing
  // wrong.
  if (!hasSupabaseServiceEnv()) {
    return NextResponse.json({ error: "Report links are not available here" }, { status: 503 });
  }
  const supabase = createServiceClient() as SupabaseLike;

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, room_code")
    .eq("room_code", code)
    .is("deleted_at", null)
    .maybeSingle();
  const row = meeting as { id: string; room_code: string } | null;
  // The same answer whether the room does not exist or the key was never
  // admitted to it: this is not a way to learn which room codes are real.
  if (!row) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: admission }, { data: reports }] = await Promise.all([
    supabase
      .from("live_meeting_admissions")
      .select("id")
      .eq("meeting_id", row.id)
      .eq("guest_key", guestKey)
      .eq("status", "admitted")
      .maybeSingle(),
    // Whether there is anything to read yet. `summary` alone: a row with one
    // is a report, a row without is a report that says there is nothing to
    // summarise, and either is something the page will show.
    supabase
      .from("live_meeting_reports")
      .select("id")
      .eq("meeting_id", row.id)
      .limit(1),
  ]);
  if (!admission) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = guestReportShareUrl(row.room_code, guestKey);
  if (!url) return NextResponse.json({ error: "Report links are not available here" }, { status: 503 });

  return NextResponse.json(
    { url, ready: Array.isArray(reports) && reports.length > 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
