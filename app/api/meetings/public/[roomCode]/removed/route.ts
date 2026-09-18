// app/api/meetings/public/[roomCode]/removed/route.ts
// Asking whether the people you can see are still supposed to be here.
//
// A removal reaches the room as a nudge — "the removals for this room changed"
// — and deliberately carries no names, because anyone holding the room code can
// publish on a broadcast channel and a nudge that named its target would be a
// way to eject anybody from any meeting whose code had been forwarded once. See
// removal-channel.ts.
//
// So each client answers the nudge here, naming the peers IT can see. Which is
// why this endpoint takes subjects and returns a subset of them, rather than
// returning the meeting's removals: a caller learns only about people it was
// already in a call with, and cannot enumerate a meeting's guest keys — a guest
// key being enough to read that guest's admission status from the poll endpoint
// next door.
//
// Unauthenticated, like the knock endpoints beside it, because invite-link
// guests are participants too and they have to drop a removed peer just as the
// host does.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { parseSubject, removedAmong, subjectKey, type RemovalSubject } from "@/lib/meetings/removal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Comfortably above what a real call generates and well under a loop.
 *
 * A client asks on a removal nudge and when a peer joins, so a busy ten-person
 * meeting is a few dozen requests over its whole length — not the per-tick cost
 * the knock poll pays.
 */
const CHECK_LIMIT = 120;
const CHECK_WINDOW_MS = 60_000;

/**
 * Most peers one call can ask about at once.
 *
 * A meeting is a handful of people; this is a bound on a request body, not a
 * product limit. It is also what stops the endpoint being turned into a bulk
 * oracle one request at a time.
 */
const MAX_SUBJECTS = 64;

type SupabaseLike = { from: (table: string) => any };

export async function POST(req: NextRequest, { params }: { params: Promise<{ roomCode: string }> }) {
  const limit = checkRateLimit({
    key: `removed:${clientIp(req)}`,
    limit: CHECK_LIMIT,
    windowMs: CHECK_WINDOW_MS,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(limit, CHECK_LIMIT) },
    );
  }

  const { roomCode } = await params;
  const code = roomCode?.trim();
  if (!code) return NextResponse.json({ error: "Missing room code" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { subjects?: unknown };
  const raw = Array.isArray(body.subjects) ? body.subjects.slice(0, MAX_SUBJECTS) : [];
  // Parsed one at a time and the unreadable ones dropped, rather than refusing
  // the request: one peer on an older build that announces nothing must not
  // stop a client learning about the others.
  const wanted = raw
    .map(parseSubject)
    .filter((s): s is RemovalSubject => s !== null);
  if (wanted.length === 0) return NextResponse.json({ removed: [] });

  const supabase: SupabaseLike = hasSupabaseServiceEnv()
    ? (createServiceClient() as SupabaseLike)
    : ((await createServerClient()) as SupabaseLike);

  // The meeting and its removals in one round trip, embedded through the
  // foreign key — the same shape the knock poll uses, and for the same reason:
  // this is on the path of a client that is currently in a call.
  const { data } = await (supabase as any)
    .from("live_meetings")
    .select("id, live_meeting_removals(user_id, guest_key)")
    .eq("room_code", code)
    .is("deleted_at", null)
    .maybeSingle();

  // A room code that resolves to nothing gets the same answer as a room nobody
  // has been removed from. There is no reason to tell an unauthenticated caller
  // which room codes are real.
  if (!data) return NextResponse.json({ removed: [] });

  const rows = ((data as { live_meeting_removals?: unknown }).live_meeting_removals ?? []) as Array<{
    user_id: string | null;
    guest_key: string | null;
  }>;

  return NextResponse.json({ removed: removedAmong(rows, wanted).map(subjectKey) });
}
