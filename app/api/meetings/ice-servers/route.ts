import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

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
// credentials are metered and worth money, so the gate stays closed to anyone
// who has not been admitted: no room code, no admission, no credentials.

const FALLBACK_STUN: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

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

  const apiKey = process.env.METERED_API_KEY;
  const appName = process.env.METERED_APP_NAME ?? "fundexecs";

  if (!apiKey) {
    // No TURN configured anywhere in this deployment. Say so in the payload
    // rather than only in the shape of it: the client tells the room that
    // relaying is unavailable instead of silently hoping STUN is enough.
    return NextResponse.json({ iceServers: FALLBACK_STUN, relay: false }, { headers: PRIVATE });
  }

  try {
    const res = await fetch(
      `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
      { next: { revalidate: 3540 } }, // cache 59 min (credentials valid 1 hr)
    );
    if (!res.ok) throw new Error(`Metered returned ${res.status}`);
    const servers = await res.json() as RTCIceServer[];
    // An empty or malformed list is a failure wearing a 200: falling through to
    // STUN is better than handing the peer connection an empty server list.
    if (!Array.isArray(servers) || servers.length === 0) throw new Error("Metered returned no servers");
    return NextResponse.json({ iceServers: servers, relay: true }, { headers: PRIVATE });
  } catch (err) {
    console.error("[/api/meetings/ice-servers]", err);
    return NextResponse.json({ iceServers: FALLBACK_STUN, relay: false }, { headers: PRIVATE });
  }
}
