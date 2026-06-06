/**
 * Cookie domain for Supabase auth cookies.
 *
 * Returns `undefined` everywhere — auth cookies are host-only, matching the
 * official Supabase SSR pattern.
 *
 * History: we briefly scoped auth cookies to the shared parent `.fundexecs.com`
 * to try to share the PKCE verifier across www/auth subdomains. That was the
 * wrong fix (the real PKCE issue was a middleware redirect hijack) and it was
 * actively harmful: the browser client and the server wrote the auth cookie at
 * different scopes, so two same-named cookies coexisted. The browser then resent
 * the stale one, and Supabase's rotated refresh token was never recognised —
 * "Invalid Refresh Token: Refresh Token Not Found" — bouncing every signed-in
 * user back to /login on the next request. The whole app and the OAuth callbacks
 * live on a single host (www.fundexecs.com), so host-only cookies are correct
 * and sufficient. The middleware expires any leftover parent-domain cookies so
 * existing sessions self-heal.
 */
export function authCookieDomain(): string | undefined {
  return undefined;
}
