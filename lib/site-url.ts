/**
 * The canonical site origin used for OAuth / email auth redirects.
 *
 * Prefers `NEXT_PUBLIC_SITE_URL` (set in production to `https://fundexecs.com`)
 * so auth always returns users to the canonical host instead of whatever
 * origin they happened to start on (preview deploys, `www`, localhost). Falls
 * back to the live browser origin on the client and Vercel's deployment URL on
 * the server, then to localhost for local dev.
 */
export function getSiteURL(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  if (typeof window !== 'undefined') return window.location.origin;

  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`;

  return 'http://localhost:3000';
}
