// lib/meetings/turn-servers.server.ts
// Assembling the ICE server list for one caller.
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
  parseTurnUrls,
  turnFailureLog,
  type TurnUnavailableReason,
} from "./turn-credentials";

export type TurnLookup =
  | { relay: true; iceServers: RTCIceServer[] }
  | { relay: false; reason: TurnUnavailableReason };

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

/**
 * The ICE servers for one caller.
 *
 * `label` only ever reaches the TURN server's own log, so an operator watching
 * relayed sessions can tell which room they belong to. It is not an identity
 * and nothing is authorized by it — the HMAC is.
 */
export function turnServers(label?: string): TurnLookup {
  const urls = parseTurnUrls(process.env.TURN_URLS);
  const secret = cleanCredential(process.env.TURN_SECRET);

  if (urls.length === 0 && !secret) {
    console.error(turnFailureLog("unconfigured"));
    return { relay: false, reason: "unconfigured" };
  }

  // Half-configured is its own case, and a likelier mistake than either of the
  // clean ones: somebody sets the URLs and forgets the secret, or stands up the
  // server and leaves TURN_URLS holding only a stun: entry.
  if (!secret) {
    console.error(turnFailureLog("misconfigured", "TURN_URLS is set but TURN_SECRET is empty"));
    return { relay: false, reason: "misconfigured" };
  }
  if (!hasRelayUrl(urls)) {
    console.error(turnFailureLog("misconfigured", "TURN_URLS contains no turn: or turns: entry"));
    return { relay: false, reason: "misconfigured" };
  }

  const credential = mintTurnCredential({
    secret,
    ttlSeconds: normalizeTtlSeconds(process.env.TURN_TTL_SECONDS),
    nowSeconds: Math.floor(Date.now() / 1000),
    label,
  });

  return { relay: true, iceServers: buildIceServers(urls, credential) };
}
