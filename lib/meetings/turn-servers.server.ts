// lib/meetings/turn-servers.server.ts
// Assembling the ICE server list for one caller.
//
// Two relays can back a call. A TURN server of our own (TURN_URLS and
// TURN_SECRET), whose credentials are computed below from the shared secret;
// or Cloudflare's hosted TURN (CLOUDFLARE_TURN_KEY_ID and
// CLOUDFLARE_TURN_API_TOKEN), for a deployment that would rather not run a
// server, whose credentials Cloudflare issues. Our own server wins when both
// are set: it is the one somebody deliberately stood up.
//
// What follows about there being no outbound call is true of the self-hosted
// path. The Cloudflare path makes one, bounded by a timeout and cached.
//
// Short, now, and that is the point. This used to hold an outbound fetch to a
// TURN vendor, a cache to stop a failure being served for an hour, a
// classification of the vendor's HTTP statuses, and a retry story. All of it
// existed because the credentials came from somewhere else. They are computed
// here, so the failure modes it managed no longer exist: there is no request
// to fail, no status to classify, nothing worth caching, and no bill.
//
// It still reads the environment and still logs, so it stays out of the pure
// module — and out of the route, which a Next.js route module's export rules
// would not let hold a testable reset anyway.

import {
  buildIceServers,
  cleanCredential,
  hasRelayUrl,
  mintTurnCredential,
  normalizeTtlSeconds,
  parseCloudflareIceServers,
  parseTurnUrls,
  turnFailureLog,
  type TurnUnavailableReason,
} from "./turn-credentials";

export type TurnLookup =
  | { relay: true; iceServers: RTCIceServer[] }
  | { relay: false; reason: TurnUnavailableReason | "provider_error" };

/**
 * Public STUN, for deployments that have not stood a TURN server up yet.
 *
 * Enough to connect two people on ordinary home or office networks, and not
 * enough for the ones this change is about. Kept so a developer running
 * locally, and a deployment mid-migration, still get working calls between
 * peers that can reach each other directly.
 */
export const FALLBACK_STUN: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

const CLOUDFLARE_API = "https://rtc.live.cloudflare.com/v1/turn/keys";
const CLOUDFLARE_TIMEOUT_MS = 5_000;

/**
 * How long one set of Cloudflare credentials is handed out for.
 *
 * They are issued for the configured TTL (12 hours by default) and served from
 * here for at most an hour of that, so anyone given a set still has hours left
 * on it however long their call runs. Caching is what keeps a room of people
 * joining at once from being a burst of API calls in front of every join.
 */
const CLOUDFLARE_CACHE_MS = 60 * 60_000;

let cloudflareCache: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;

/** Test hook: forget any cached Cloudflare credentials. */
export function resetTurnCacheForTests(): void {
  cloudflareCache = null;
}

type SelfHosted = { urls: string[]; secret: string | null };
type Cloudflare = { keyId: string | null; token: string | null };

function selfHostedConfig(): SelfHosted {
  return { urls: parseTurnUrls(process.env.TURN_URLS), secret: cleanCredential(process.env.TURN_SECRET) };
}

function cloudflareConfig(): Cloudflare {
  return {
    keyId: cleanCredential(process.env.CLOUDFLARE_TURN_KEY_ID),
    token: cleanCredential(process.env.CLOUDFLARE_TURN_API_TOKEN),
  };
}

function selfHostedReady(c: SelfHosted): boolean {
  return Boolean(c.secret) && hasRelayUrl(c.urls);
}

/**
 * Credentials from Cloudflare, or why not. Never throws: this sits in front of
 * every call join, and a relay that cannot be reached must degrade the call to
 * STUN, not fail the join.
 */
async function cloudflareIceServers(
  keyId: string,
  token: string,
): Promise<{ ok: true; iceServers: RTCIceServer[] } | { ok: false; detail: string }> {
  const now = Date.now();
  if (cloudflareCache && cloudflareCache.expiresAt > now) {
    return { ok: true, iceServers: cloudflareCache.iceServers };
  }

  try {
    const res = await fetch(`${CLOUDFLARE_API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: normalizeTtlSeconds(process.env.TURN_TTL_SECONDS) }),
      signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      // 401/403 is a wrong token or key id; anything else is Cloudflare's side.
      return { ok: false, detail: `Cloudflare answered ${res.status}` };
    }
    const iceServers = parseCloudflareIceServers(await res.json().catch(() => null));
    if (iceServers.length === 0) return { ok: false, detail: "Cloudflare returned no TURN servers" };
    cloudflareCache = { iceServers, expiresAt: now + CLOUDFLARE_CACHE_MS };
    return { ok: true, iceServers };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return { ok: false, detail: timedOut ? "Cloudflare timed out" : "Cloudflare was unreachable" };
  }
}

/**
 * The ICE servers for one caller.
 *
 * `label` only ever reaches our own TURN server's log, so an operator watching
 * relayed sessions can tell which room they belong to. It is not an identity
 * and nothing is authorized by it — the HMAC is. Cloudflare's credentials carry
 * no label.
 */
export async function turnServers(label?: string): Promise<TurnLookup> {
  const self = selfHostedConfig();
  const cf = cloudflareConfig();

  if (selfHostedReady(self)) {
    const credential = mintTurnCredential({
      secret: self.secret!,
      ttlSeconds: normalizeTtlSeconds(process.env.TURN_TTL_SECONDS),
      nowSeconds: Math.floor(Date.now() / 1000),
      label,
    });
    return { relay: true, iceServers: buildIceServers(self.urls, credential) };
  }

  if (cf.keyId && cf.token) {
    const result = await cloudflareIceServers(cf.keyId, cf.token);
    if (result.ok) return { relay: true, iceServers: result.iceServers };
    console.error(
      `[turn] Cloudflare TURN is configured but credentials could not be issued (${result.detail}).`
        + " Check CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN. This call runs on STUN only.",
    );
    return { relay: false, reason: "provider_error" };
  }

  if (cf.keyId || cf.token) {
    console.error(turnFailureLog("misconfigured", "only one of CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN is set"));
    return { relay: false, reason: "misconfigured" };
  }

  if (self.urls.length === 0 && !self.secret) {
    console.error(turnFailureLog("unconfigured"));
    return { relay: false, reason: "unconfigured" };
  }

  // Half-configured is its own case, and a likelier mistake than either of the
  // clean ones: somebody sets the URLs and forgets the secret, or stands up the
  // server and leaves TURN_URLS holding only a stun: entry.
  if (!self.secret) {
    console.error(turnFailureLog("misconfigured", "TURN_URLS is set but TURN_SECRET is empty"));
  } else {
    console.error(turnFailureLog("misconfigured", "TURN_URLS contains no turn: or turns: entry"));
  }
  return { relay: false, reason: "misconfigured" };
}

/**
 * Whether this deployment can relay calls, without minting a credential,
 * calling Cloudflare, or logging.
 *
 * For surfaces that only need to KNOW — the meetings page warning an admin
 * that guests on restrictive networks will fail to connect. `turnServers`
 * logs an error each time it finds no relay, which is right on the join path
 * and would be noise on every page view. A Cloudflare key counts as configured
 * here; whether Cloudflare accepts it shows up on the join path's log.
 */
export function relayStatus(): { configured: true } | { configured: false; reason: TurnUnavailableReason } {
  const self = selfHostedConfig();
  const cf = cloudflareConfig();
  if (selfHostedReady(self)) return { configured: true };
  if (cf.keyId && cf.token) return { configured: true };
  if (self.urls.length === 0 && !self.secret && !cf.keyId && !cf.token) return { configured: false, reason: "unconfigured" };
  return { configured: false, reason: "misconfigured" };
}
