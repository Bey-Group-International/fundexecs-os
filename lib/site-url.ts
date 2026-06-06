/**
 * The canonical site origin used for OAuth / email auth redirects.
 *
 * Prefers `NEXT_PUBLIC_SITE_URL` (set in production to
 * `https://www.fundexecs.com` — the canonical host; the apex `fundexecs.com`
 * 308-redirects to it) so auth always returns users to that one host instead of
 * whatever origin they happened to start on (apex, preview deploys, localhost).
 * Pinning this keeps the PKCE code-verifier cookie on a single host so the
 * `/auth/callback` code exchange doesn't break across an apex→www redirect. Falls
 * back to the live browser origin on the client and Vercel's deployment URL on
 * the server, then to localhost for local dev.
 *
 * The result is always normalized to an absolute origin with an explicit scheme
 * and no trailing slash. Provider OAuth (Calendly, Slack) rejects a schemeless
 * `redirect_uri`, so a value like `www.fundexecs.com` is coerced to
 * `https://www.fundexecs.com`.
 */
export function getSiteURL(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return normalizeOrigin(fromEnv);

  if (typeof window !== 'undefined') return window.location.origin;

  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`;

  return 'http://localhost:3000';
}

/** Trim trailing slashes and guarantee an explicit scheme (defaults to https). */
function normalizeOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}
