import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { FALLBACK_STUN, turnServers } from "@/lib/meetings/turn-servers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ICE servers for the meeting's peer connections — STUN to discover a public
// address, TURN to relay when a direct path cannot be built.
//
// This used to require a signed-in user, which meant invite-link GUESTS — the
// one population that is always on somebody else's network — were the only
// people who never got TURN. Their client swallowed the 401 and fell back to
// STUN alone, so a guest behind symmetric NAT, a corporate firewall or mobile
// CGNAT had no relay candidate of their own: a guest-to-guest call could not
// connect at all, and a guest-to-host call survived only by leaning on the
// host's relay. Cameras and microphones opened fine and then went nowhere,
// which is exactly what it looked like from the outside.
//
// Being signed in was never the right question. The right one is "has the host
// let this person into this meeting" — so an admitted guest is authorized by
// their admission row, the same record the waiting room already decides. TURN
// relay capacity is worth money and worth protecting, so the gate stays closed
// to anyone who has not been admitted: no room code, no admission, no
// credentials. Credentials are now minted here from a shared secret rather than
// fetched from a vendor, which removes the only outbound call this endpoint
// made — but the gate matters more, not less: a credential this hands out is
// good on OUR relay, and bandwidth we pay for.
//
// See docs/infra/turn-server.md for the relay itself.

// Generous for people (one call joins once, plus a reconnect or two) and tight
// enough that the endpoint is not a free TURN-credential dispenser. Keyed by IP
// because the un-authenticated callers are precisely the ones worth bounding.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

/** Credentials are per-caller and short-lived; never let a cache hold them. */
const PRIVATE = { "Cache-Control": "private, no-store" } as const;

type SupabaseLike = { from: (table: string) => any };

/**
 * Whether this caller may have ICE servers for this meeting.
 *
 * Two ways in, and the second is the one that was missing:
 *
 *  - signed in: unchanged from before, and deliberately not narrowed to the
 *    meeting. A member creating a room on the fly has no room code yet, and
 *    a signed-in caller is already someone this deployment gave an account to.
 *  - admitted: an invite-link guest holding a `guest_key` that the host (or
 *    quick access) has already moved to `admitted` on a meeting that is still
 *    running. A guest who has not knocked, is still waiting, or was denied
 *    gets nothing — the same answer as a stranger.
 */
async function authorize(req: NextRequest): Promise<boolean> {
  const authed = await createServerClient();
  const { data: { user } } = await authed.auth.getUser();
  if (user) return true;

  const roomCode = req.nextUrl.searchParams.get("roomCode")?.trim() ?? "";
  const guestKey = req.nextUrl.searchParams.get("guestKey")?.trim() ?? "";
  if (!roomCode || !guestKey) return false;

  // Service role, like the knock route: a guest has no session for RLS to read,
  // which is the whole reason the admissions table is keyed by guest_key.
  const svc: SupabaseLike = hasSupabaseServiceEnv() ? createServiceClient() : authed;

  // One query. The meeting is joined with `!inner` so a soft-deleted meeting
  // yields no row, and `status` is checked here rather than after: an ended
  // meeting needs no relay.
  const { data } = await svc
    .from("live_meeting_admissions")
    .select("id, status, live_meetings!inner(room_code, status, deleted_at)")
    .eq("guest_key", guestKey)
    .eq("status", "admitted")
    .eq("live_meetings.room_code", roomCode)
    .is("live_meetings.deleted_at", null)
    .neq("live_meetings.status", "ended")
    .maybeSingle();

  return !!data;
}

export async function GET(req: NextRequest) {
  const limit = checkRateLimit({
    key: `ice-servers:${clientIp(req)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { ...rateLimitHeaders(limit, RATE_LIMIT), ...PRIVATE } },
    );
  }

  if (!(await authorize(req))) {
    // Deliberately the same answer whether the meeting does not exist, the
    // guest never knocked, or the host said no: this endpoint is not a way to
    // discover which room codes are real.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  }

  // The room code reaches the TURN server's own log, so an operator can see
  // which meeting a relayed session belongs to. It authorizes nothing.
  const turn = turnServers(req.nextUrl.searchParams.get("roomCode")?.trim() || undefined);
  if (turn.relay) {
    return NextResponse.json({ iceServers: turn.iceServers, relay: true }, { headers: PRIVATE });
  }

  // `reason` rather than only `relay: false`. The client logs it, so the next
  // person to open a console on a failing call learns in one line whether this
  // deployment has no TURN server configured at all, or has one configured
  // wrongly — which are different jobs for the same person.
  return NextResponse.json(
    { iceServers: FALLBACK_STUN, relay: false, reason: turn.reason },
    { headers: PRIVATE },
  );
}
