// app/api/meetings/public/[roomCode]/removed/route.ts
// Asking whether the people you can see are still supposed to be here.
//
// A removal reaches the room as a nudge — "the removals for this room changed"
// — and deliberately carries no names, because anyone holding the room code can
// publish on a broadcast channel and a nudge that named its target would be a
// way to eject anybody from any meeting whose link had been forwarded once. See
// removal-channel.ts.
//
// So each client answers the nudge here, naming the SIGNALLING IDS it can see.
// Those are the only identifiers a participant actually has for the others, and
// they are already public within the room — everyone sees everyone's — so
// naming them discloses nothing. The server does the resolving, from the row
// the knock wrote.
//
// That is the second reason this shape and not the obvious one. An earlier
// version took durable subjects that each peer had announced over the
// signalling channel, which meant a client could ask about — and, through the
// removal route, act on — an identity it had simply claimed. Signalling ids
// cannot be repurposed that way: the server looks up whose they are.
//
// Unauthenticated, like the knock endpoints beside it, because invite-link
// guests are participants too and they have to drop a removed peer just as the
// host does.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { isRemoved, subjectFor } from "@/lib/meetings/removal";

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
 * Most peers one call may ask about at once.
 *
 * A meeting is a handful of people; this is a bound on a request body, not a
 * product limit.
 */
const MAX_IDS = 64;

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

  const body = (await req.json().catch(() => ({}))) as { signalIds?: unknown };
  const wanted = (Array.isArray(body.signalIds) ? body.signalIds : [])
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .slice(0, MAX_IDS);
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

  const meeting = data as { id: string; live_meeting_removals?: unknown };
  const removals = (meeting.live_meeting_removals ?? []) as Array<{
    user_id: string | null;
    guest_key: string | null;
  }>;
  // Nobody has been removed, so there is nothing to resolve anyone against.
  if (removals.length === 0) return NextResponse.json({ removed: [] });

  // Only the tiles that were asked about. `in` on an indexed (meeting_id,
  // signal_id) is one lookup, and it cannot return a row for anybody the
  // caller did not name.
  const { data: rows } = await (supabase as any)
    .from("live_meeting_admissions")
    .select("signal_id, user_id, guest_key")
    .eq("meeting_id", meeting.id)
    .in("signal_id", wanted);

  const admissions = (rows ?? []) as Array<{
    signal_id: string | null;
    user_id: string | null;
    guest_key: string | null;
  }>;

  // Both identifiers, independently, for the same reason the knock checks both:
  // subjectFor prefers the account, so a guest removed by key who has since
  // signed in would be looked up under an account nobody removed.
  const removed = admissions
    .filter(
      (row) =>
        isRemoved(removals, subjectFor(row.user_id, null)) ||
        isRemoved(removals, subjectFor(null, row.guest_key)),
    )
    .map((row) => row.signal_id)
    .filter((id): id is string => typeof id === "string");

  return NextResponse.json({ removed });
}
