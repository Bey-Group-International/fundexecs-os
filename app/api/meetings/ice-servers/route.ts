import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import {
  TURN_CREDENTIAL_TTL_MS,
  classifyTurnStatus,
  cleanCredential,
  credentialWasDirty,
  isUsableIceServerList,
  meteredCredentialsUrl,
  turnFailureLog,
  type TurnUnavailableReason,
} from "@/lib/meetings/turn-credentials";

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

/**
 * Credentials held in the instance, not in the fetch cache.
 *
 * This replaces `next: { revalidate: 3540 }`, and the difference is the whole
 * point: Next's data cache stores whatever the fetch returned, so a single 401
 * was liable to be served back for the next 59 minutes without the provider
 * being asked again. An operator who fixed the key would see nothing change for
 * an hour and reasonably conclude the fix had not worked.
 *
 * Only successes are stored here. A failure leaves the slot empty, so the very
 * next request re-asks — which is exactly the behaviour you want on the day
 * somebody is standing at the dashboard pasting in a new key.
 */
let cachedServers: { servers: RTCIceServer[]; expiresAt: number } | null = null;

/** So a fix is visible immediately in the same instance, and tests are honest. */
export function __resetTurnCacheForTests(): void {
  cachedServers = null;
}

type TurnLookup =
  | { relay: true; iceServers: RTCIceServer[] }
  | { relay: false; reason: TurnUnavailableReason };

/**
 * Fetch TURN credentials, or say why there are none.
 *
 * Never throws: every caller of this endpoint would rather have STUN and a
 * reason than a 500.
 */
async function turnServers(): Promise<TurnLookup> {
  const now = Date.now();
  if (cachedServers && cachedServers.expiresAt > now) {
    return { relay: true, iceServers: cachedServers.servers };
  }

  const rawKey = process.env.METERED_API_KEY;
  const apiKey = cleanCredential(rawKey);
  const appName = cleanCredential(process.env.METERED_APP_NAME) ?? "fundexecs";

  if (!apiKey) {
    console.error(turnFailureLog({ reason: "unconfigured", appName, dirty: false }));
    return { relay: false, reason: "unconfigured" };
  }

  const dirty = credentialWasDirty(rawKey);

  try {
    // `no-store` rather than a revalidate window: the caching is done above,
    // where a failure cannot be mistaken for an answer.
    const res = await fetch(meteredCredentialsUrl(appName, apiKey), { cache: "no-store" });
    const status = classifyTurnStatus(res.status);

    if (status !== "ok") {
      const reason: TurnUnavailableReason = status === "rejected" ? "rejected" : "unavailable";
      console.error(turnFailureLog({ reason, status: res.status, appName, dirty }));
      return { relay: false, reason };
    }

    const servers = await res.json() as unknown;
    if (!isUsableIceServerList(servers)) {
      // A 200 carrying nothing usable. Treated as the provider failing rather
      // than as success, because handing a peer connection an empty server list
      // looks like success at every point that checks it.
      console.error(turnFailureLog({ reason: "unavailable", status: res.status, appName, dirty }));
      return { relay: false, reason: "unavailable" };
    }

    const iceServers = servers as RTCIceServer[];
    cachedServers = { servers: iceServers, expiresAt: now + TURN_CREDENTIAL_TTL_MS };
    return { relay: true, iceServers };
  } catch (err) {
    console.error(turnFailureLog({ reason: "unavailable", appName, dirty }), err);
    return { relay: false, reason: "unavailable" };
  }
}

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

  const turn = await turnServers();
  if (turn.relay) {
    return NextResponse.json({ iceServers: turn.iceServers, relay: true }, { headers: PRIVATE });
  }

  // `reason` rather than only `relay: false`. The client logs it, so the next
  // person to open a console on a failing call learns in one line whether this
  // deployment has no TURN, has a key the provider refuses, or caught the
  // provider having a bad afternoon — three problems with three different owners.
  return NextResponse.json(
    { iceServers: FALLBACK_STUN, relay: false, reason: turn.reason },
    { headers: PRIVATE },
  );
}
