// lib/digest-tracking.ts
// Signed digest-engagement tracking links — the PURE URL layer that closes the
// digest → learning loop with implicit signals.
//
// The digest (lib/radar-digest.ts) ships ranked Radar rows over Slack/email.
// Each row's move link is wrapped so a click routes through /api/digest/track,
// which records the engagement and then redirects to the real deep link; the
// email body also carries a 1×1 open pixel pointing at the same endpoint. Those
// links are reached from inboxes we don't control, so the endpoint is
// unauthenticated by design — instead, every link carries an HMAC over its
// params so a row can only be created from a link this server actually signed.
//
// This module is PURE + deterministic: given a secret + params it builds the
// signed URL and verifies a token. No DB, no network, no env, no `next/headers`
// — the HMAC uses node `crypto` only. The thin server wrapper lives in the
// route handler; the signing convention is testable here in isolation.
import { createHmac, timingSafeEqual } from "crypto";

// The fields a tracking link signs over, in a fixed order. Order matters: the
// canonical string is positional, so signer and verifier must agree exactly.
export interface DigestTrackParams {
  digestLogId: string;
  orgId: string;
  entityId?: string | null;
  entityKind?: string | null;
  moveKind?: string | null;
  action: "opened" | "clicked";
  /** Destination deep link — only present (and signed) for clicks. */
  href?: string | null;
}

// The query keys used on the wire. Kept short + stable; the canonical signing
// string is derived from these in this exact order.
const FIELD_ORDER: (keyof DigestTrackParams)[] = [
  "digestLogId",
  "orgId",
  "entityId",
  "entityKind",
  "moveKind",
  "action",
  "href",
];

const QUERY_KEYS: Record<keyof DigestTrackParams, string> = {
  digestLogId: "digest_log_id",
  orgId: "org_id",
  entityId: "entity_id",
  entityKind: "entity_kind",
  moveKind: "move_kind",
  action: "action",
  href: "href",
};

function norm(v: string | null | undefined): string {
  return v == null ? "" : String(v);
}

/**
 * The canonical string an HMAC is computed over. Positional + newline-joined so
 * empty optionals are unambiguous and reordering query params can't change the
 * signature. Pure.
 */
export function canonicalTrackString(params: DigestTrackParams): string {
  return FIELD_ORDER.map((f) => norm(params[f] as string | null | undefined)).join("\n");
}

/**
 * Sign the params with the server secret. Hex HMAC-SHA256 over the canonical
 * string. Pure (given the same secret + params → same token).
 */
export function signTrackParams(secret: string, params: DigestTrackParams): string {
  return createHmac("sha256", secret).update(canonicalTrackString(params)).digest("hex");
}

/**
 * Constant-time verify a token against freshly-signed params. Returns false on
 * any mismatch (including malformed/short tokens) and never throws. Pure.
 */
export function verifyTrackToken(
  secret: string,
  params: DigestTrackParams,
  token: string | null | undefined,
): boolean {
  if (!token) return false;
  const expected = signTrackParams(secret, params);
  // timingSafeEqual requires equal-length buffers; bail early on a size mismatch.
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * Only allow same-origin / relative deep links as a click destination — never an
 * absolute external URL, so a forged-but-signed link can't be a redirect to an
 * attacker host. A href must begin with a single "/" (not "//", which a browser
 * treats as protocol-relative → external). Pure.
 */
export function isSafeInternalHref(href: string | null | undefined): boolean {
  if (!href) return false;
  if (!href.startsWith("/")) return false;
  if (href.startsWith("//")) return false;
  // Reject anything that smuggles a scheme or a backslash trick.
  if (/[\\]/.test(href)) return false;
  if (/^\/+\s*https?:/i.test(href)) return false;
  return true;
}

/**
 * Build the signed tracking URL for one digest action. Pure: it appends a query
 * string (params + token) onto a base track path. `baseUrl` makes the link
 * absolute so it survives Slack/email; omit it for a relative link.
 *
 * The returned URL points at the /api/digest/track endpoint, which records the
 * engagement and (for clicks) redirects to the validated `href`.
 */
export function buildTrackingUrl(
  secret: string,
  params: DigestTrackParams,
  baseUrl?: string,
): string {
  const token = signTrackParams(secret, params);
  const qs = new URLSearchParams();
  for (const f of FIELD_ORDER) {
    const v = params[f] as string | null | undefined;
    if (v != null && v !== "") qs.set(QUERY_KEYS[f], String(v));
  }
  qs.set("t", token);
  const path = `/api/digest/track?${qs.toString()}`;
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * Parse the query params off a tracking request URL back into DigestTrackParams
 * plus the token. Used by the server verifier; pure (takes a URLSearchParams).
 */
export function parseTrackQuery(
  query: URLSearchParams,
): { params: DigestTrackParams; token: string | null } {
  const params: DigestTrackParams = {
    digestLogId: query.get(QUERY_KEYS.digestLogId) ?? "",
    orgId: query.get(QUERY_KEYS.orgId) ?? "",
    entityId: query.get(QUERY_KEYS.entityId),
    entityKind: query.get(QUERY_KEYS.entityKind),
    moveKind: query.get(QUERY_KEYS.moveKind),
    action: (query.get(QUERY_KEYS.action) as "opened" | "clicked") ?? "opened",
    href: query.get(QUERY_KEYS.href),
  };
  return { params, token: query.get("t") };
}
