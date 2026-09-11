// The shared vocabulary of a referral link, used by three places that must
// agree: the middleware that captures a code from a /join/CODE landing, the
// /join route handler that captures one from a ?ref= link, and the invite page
// that renders it.

/** Cookie the code rides in until onboarding claims it. */
export const REFERRAL_COOKIE = "referral_code";

/** 30 days — long enough to survive "I'll look at this properly next week". */
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** Options every write of the cookie shares, so the two writers can't drift. */
export const REFERRAL_COOKIE_OPTIONS = {
  path: "/",
  maxAge: REFERRAL_COOKIE_MAX_AGE,
  httpOnly: true,
  sameSite: "lax",
} as const;

// Codes are drawn from an unambiguous alphabet (lib/gift-earn.ts) and travel
// through links people retype, so accept any case and surrounding whitespace.
// Deliberately looser than the 8 characters we currently issue: a longer or
// differently-shaped code must not silently stop being captured.
const CODE_PATTERN = /^[A-Za-z0-9]{1,32}$/;

/**
 * The canonical form of a code: upper-case, trimmed. Returns null for anything
 * that isn't shaped like a code at all, so a junk path can't reach the database
 * or the cookie.
 */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const clean = (raw ?? "").trim();
  if (!CODE_PATTERN.test(clean)) return null;
  return clean.toUpperCase();
}

/**
 * The code an invite-page URL is carrying, or null if this isn't one. Matches
 * `/join/CODE` exactly — never `/join`, and never anything below it — because
 * the middleware uses this to decide whether to write the referral cookie.
 */
export function referralCodeFromJoinPath(pathname: string): string | null {
  const match = /^\/join\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  // A path segment arrives percent-encoded; a malformed escape is not a code.
  let segment: string;
  try {
    segment = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return normalizeReferralCode(segment);
}
