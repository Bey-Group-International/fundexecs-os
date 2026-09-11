// lib/meetings/turn-credentials.ts
// Minting TURN credentials ourselves, with no provider to ask.
//
// This replaces a hosted TURN vendor. The vendor was not a small dependency:
// it was an outbound HTTP call on the path of every meeting join, it cost
// money per gigabyte relayed, it could refuse us, and for ten weeks it did —
// answering 401 into a log nobody read while every call quietly ran without a
// relay and guests behind symmetric NAT could not connect at all.
//
// None of that was necessary. TURN authentication has a standard scheme for
// exactly this situation: the server and the application share one secret, and
// the application computes short-lived credentials from it locally. No API, no
// account, no network call, no bill, and no 401 — you cannot be refused by a
// computation. It is draft-uberti-behave-turn-rest-00, and coturn implements
// it as `use-auth-secret` with a `static-auth-secret`.
//
// What this does NOT remove is the relay itself. A guest behind symmetric NAT,
// a corporate firewall, or mobile CGNAT cannot reach a peer directly — that is
// how those networks work, not a shortcoming of the code — so somebody has to
// run a TURN server. This change means it is yours rather than rented.
//
// Pure and deterministic: the only import is Node's HMAC, which is a function
// of its inputs. No network, no clock of its own, no environment reads.

import { createHmac } from "node:crypto";

/** Why a response carries no relay, for the client to log and an operator to read. */
export type TurnUnavailableReason =
  /** No TURN_SECRET / TURN_URLS in this environment — TURN is not set up here. */
  | "unconfigured"
  /** They are set, and to something unusable. */
  | "misconfigured";

/**
 * How long a minted credential lasts.
 *
 * Long enough to cover a meeting that started before the credential was issued
 * and ran over; short enough that a leaked one is worth little. The expiry is
 * carried in the username, so the TURN server enforces it without being told
 * anything by us.
 */
export const DEFAULT_TURN_TTL_SECONDS = 12 * 60 * 60;

/** Bounds on a configured TTL, so a typo cannot mint a permanent credential. */
export const MIN_TURN_TTL_SECONDS = 60;
export const MAX_TURN_TTL_SECONDS = 24 * 60 * 60;

/** The URL schemes a peer connection can actually use. */
const ICE_SCHEMES = ["turn:", "turns:", "stun:", "stuns:"] as const;

/**
 * Clean a value read from the environment.
 *
 * Trims, and strips one matching pair of surrounding quotes. Both come from the
 * same place: a value pasted into a dashboard field, or copied out of a `.env`
 * line where the quotes were the file format rather than part of the secret.
 * A shared secret that silently carries a trailing newline produces credentials
 * the TURN server rejects, which looks exactly like a wrong secret.
 */
export function cleanCredential(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
    }
  }
  return value.length > 0 ? value : null;
}

/**
 * The TURN/STUN URLs this deployment should hand out.
 *
 * Comma- or whitespace-separated, because both are what people type. Anything
 * without a recognised scheme is dropped rather than passed through: a peer
 * connection given a malformed URL logs nothing useful and simply fails to
 * gather that candidate, which is the kind of silence this whole change exists
 * to stop.
 */
export function parseTurnUrls(raw: string | undefined | null): string[] {
  const cleaned = cleanCredential(raw);
  if (!cleaned) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of cleaned.split(/[\s,]+/)) {
    const url = piece.trim().replace(/^["']|["']$/g, "");
    if (!url) continue;
    if (!ICE_SCHEMES.some((s) => url.toLowerCase().startsWith(s))) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** Whether any of these URLs can actually relay, as opposed to only discover. */
export function hasRelayUrl(urls: readonly string[]): boolean {
  return urls.some((u) => /^turns?:/i.test(u));
}

/** Keep a configured TTL inside something sane, whatever was typed. */
export function normalizeTtlSeconds(raw: string | undefined | null): number {
  const cleaned = cleanCredential(raw);
  if (!cleaned) return DEFAULT_TURN_TTL_SECONDS;
  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TURN_TTL_SECONDS;
  return Math.min(MAX_TURN_TTL_SECONDS, Math.max(MIN_TURN_TTL_SECONDS, parsed));
}

export interface TurnCredential {
  username: string;
  credential: string;
  /** Unix seconds at which the TURN server will stop accepting this. */
  expiresAt: number;
}

/**
 * Mint one short-lived credential.
 *
 * The scheme, exactly:
 *
 *   username   = "<unix expiry>" or "<unix expiry>:<label>"
 *   credential = base64( HMAC-SHA1( secret, username ) )
 *
 * The TURN server recomputes the same HMAC from the username it receives and
 * its own copy of the secret, and rejects anything whose expiry has passed. It
 * never needs to have heard of the user, which is why no account exists to be
 * billed or revoked.
 *
 * ── On SHA-1, because a scanner will flag this and someone will want to fix it
 *
 * DO NOT change this to SHA-256. It is not a preference; it is the wire format.
 * coturn computes base64(HMAC-SHA1(static-auth-secret, username)) and compares
 * byte for byte, so a credential minted with any other hash is rejected by
 * every TURN server on earth, and every guest who needed a relay silently
 * stops connecting. There is no negotiation step in which a stronger hash
 * could be agreed.
 *
 * It is also not a weakness. What is broken about SHA-1 is collision
 * resistance — an attacker's ability to find two inputs with the same digest.
 * HMAC does not rest on that property, and HMAC-SHA1 remains unbroken as a
 * message authentication code; NIST still permits it for exactly this use.
 * Here it authenticates a short, server-chosen string under a secret the
 * attacker does not have, for at most a few hours.
 *
 * The alternative that would satisfy a scanner is worse: static long-term
 * credentials in the TURN server's user database, handed to every invite-link
 * guest, never expiring, and giving anyone who captures one free use of the
 * relay forever. And it would not even remove SHA-1 from the system — STUN's
 * MESSAGE-INTEGRITY (RFC 5389), which every TURN exchange carries, is
 * HMAC-SHA1 regardless of how the credential was derived.
 */
export function mintTurnCredential(input: {
  secret: string;
  ttlSeconds: number;
  /** Unix SECONDS, not milliseconds — the wire format is seconds. */
  nowSeconds: number;
  /** Optional identifier, for reading the TURN server's own logs. */
  label?: string;
}): TurnCredential {
  const expiresAt = Math.floor(input.nowSeconds) + input.ttlSeconds;
  // A label is only ever for the operator's log, so anything that would confuse
  // the ":"-delimited stamp is removed rather than escaped.
  const label = input.label?.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 32);
  // Named for what it is rather than for the field it lands in. The protocol
  // carries this as the STUN USERNAME attribute, but it is not a user's name
  // and identifies nobody: it is an expiry, optionally tagged with the room so
  // the relay's own log is readable, and it travels in cleartext.
  const stamp = label ? `${expiresAt}:${label}` : String(expiresAt);
  const credential = createHmac("sha1", input.secret).update(stamp).digest("base64");
  return { username: stamp, credential, expiresAt };
}

/**
 * The ICE server list a browser gets.
 *
 * STUN entries carry no credentials — they are a public "what is my address"
 * service and reject requests that try to authenticate. Only turn:/turns:
 * entries get the username and password, which is why they are split here
 * rather than having one blanket entry.
 */
export function buildIceServers(
  urls: readonly string[],
  credential: TurnCredential,
): RTCIceServer[] {
  const stun = urls.filter((u) => /^stuns?:/i.test(u));
  const relay = urls.filter((u) => /^turns?:/i.test(u));
  const servers: RTCIceServer[] = [];
  if (stun.length > 0) servers.push({ urls: stun });
  if (relay.length > 0) {
    servers.push({ urls: relay, username: credential.username, credential: credential.credential });
  }
  return servers;
}

/**
 * What to write in the server log, addressed to whoever has to fix it.
 *
 * The line this ultimately replaces was `Metered returned 401`: true, emitted
 * five times over ten weeks, and it told nobody what to do.
 */
export function turnFailureLog(reason: TurnUnavailableReason, detail?: string): string {
  const consequence =
    "Meetings will run on STUN only, so guests behind symmetric NAT, a corporate firewall or mobile CGNAT will fail to connect.";
  if (reason === "unconfigured") {
    return `[turn] No TURN relay configured: set TURN_URLS and TURN_SECRET to your own TURN server. ${consequence}`;
  }
  return `[turn] TURN is configured but unusable${detail ? ` (${detail})` : ""}.`
    + ` TURN_URLS must list at least one turn: or turns: URL and TURN_SECRET must match the TURN server's static-auth-secret. ${consequence}`;
}
