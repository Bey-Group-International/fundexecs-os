// lib/meetings/turn-servers.server.ts
// Fetching TURN credentials from the provider, and remembering the good ones.
//
// Lives here rather than in the route for two reasons. A Next.js route module
// may only export the names the framework recognises, so the reset a test needs
// cannot live beside the handler — and the handler is better off thin anyway:
// authorize, ask, answer. The decisions this makes are all in
// turn-credentials.ts, which is pure; this is the part that calls out.

import {
  TURN_CREDENTIAL_TTL_MS,
  classifyTurnStatus,
  cleanCredential,
  credentialWasDirty,
  isUsableIceServerList,
  meteredCredentialsUrl,
  turnFailureLog,
  type TurnUnavailableReason,
} from "./turn-credentials";

export type TurnLookup =
  | { relay: true; iceServers: RTCIceServer[] }
  | { relay: false; reason: TurnUnavailableReason };

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

/** Drop the cached credentials. For tests, and for an explicit re-read. */
export function resetTurnCache(): void {
  cachedServers = null;
}

/**
 * Fetch TURN credentials, or say why there are none.
 *
 * Never throws: every caller would rather have STUN and a reason than a 500.
 */
export async function turnServers(): Promise<TurnLookup> {
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
