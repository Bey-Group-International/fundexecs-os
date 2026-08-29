// The post-auth redirect target ("come back to where I was going").
//
// Shared by the login surface, the sign-in server actions, and /auth/callback
// so one definition of "safe internal path" governs the whole flow. Splitting
// it would let the entry point and the exit point disagree about what counts as
// acceptable — and the exit point is the one an attacker gets to aim.
export const DEFAULT_POST_AUTH_PATH = "/workspace";

/**
 * Reduce an untrusted `next` value to a same-origin path, or fall back.
 *
 * Prefix checks alone are bypassable: a leading backslash is normalized to a
 * slash by browsers, turning the value protocol-relative and pointing it off
 * site. So the candidate is resolved against our own origin and the result is
 * required to stay there.
 */
export function sanitizeNextPath(
  rawNext: string | null | undefined,
  origin: string,
  fallback: string = DEFAULT_POST_AUTH_PATH,
): string {
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//") || rawNext.includes("\\")) {
    return fallback;
  }
  try {
    const base = new URL(origin);
    const resolved = new URL(rawNext, base);
    if (resolved.origin !== base.origin) return fallback;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return fallback;
  }
}

/**
 * The same check, but reporting "nothing usable was asked for" as null rather
 * than substituting a default — so a caller can tell an absent `next` from one
 * that was rejected, and omit the parameter entirely instead of baking the
 * fallback into a URL.
 */
export function safeNextPathOrNull(
  rawNext: string | null | undefined,
  origin: string,
): string | null {
  // A sentinel no sanitized path can equal: every accepted value starts with
  // "/", so a leading space is unreachable output.
  const sentinel = " rejected";
  const result = sanitizeNextPath(rawNext, origin, sentinel);
  return result === sentinel ? null : result;
}
