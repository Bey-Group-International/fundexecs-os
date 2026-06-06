/**
 * Cookie domain for Supabase auth cookies.
 *
 * The app runs on www.fundexecs.com while Supabase Auth is on the custom domain
 * auth.fundexecs.com. Both are subdomains of fundexecs.com. Without an explicit
 * domain, the PKCE code-verifier cookie can be scoped so it is not sent to
 * www/auth/callback during the OAuth exchange ("PKCE code verifier not found").
 * Scoping auth cookies to the shared parent domain makes the verifier (and
 * session) readable across www and auth.fundexecs.com.
 *
 * Returns undefined off-production (localhost, *.vercel.app previews) so cookies
 * stay host-only there — setting a `.fundexecs.com` domain on a non-matching
 * host makes the browser silently drop the cookie.
 */
export function authCookieDomain(): string | undefined {
  if (typeof window !== 'undefined') {
    return window.location.hostname.endsWith('fundexecs.com') ? '.fundexecs.com' : undefined;
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  return site.includes('fundexecs.com') ? '.fundexecs.com' : undefined;
}
