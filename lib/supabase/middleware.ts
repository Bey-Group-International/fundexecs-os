import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './database.types';

/** Legacy scope: auth cookies were briefly written to the shared parent domain
 * (see cookie-domain.ts). Those shadow the host-only cookies and break refresh,
 * so we expire them on fundexecs.com hosts until they're gone. */
const LEGACY_COOKIE_DOMAIN = '.fundexecs.com';

function isAuthCookie(name: string): boolean {
  return name.startsWith('sb-') && name.includes('auth-token');
}

/**
 * Expire any auth cookies still scoped to the parent `.fundexecs.com` domain so
 * they can't shadow the host-only cookies. Host-only cookies of the same name
 * are a separate cookie and are left untouched. No-op off fundexecs.com and once
 * no parent-domain cookies remain — so it self-heals existing sessions.
 */
function clearLegacyDomainCookies(request: NextRequest, response: NextResponse) {
  if (!request.nextUrl.hostname.endsWith('fundexecs.com')) return;
  for (const c of request.cookies.getAll()) {
    if (isAuthCookie(c.name)) {
      response.cookies.set({
        name: c.name,
        value: '',
        domain: LEGACY_COOKIE_DOMAIN,
        path: '/',
        maxAge: 0
      });
    }
  }
}

/**
 * Refreshes the Supabase auth session on every request and keeps the
 * session cookies in sync. Call this from the root proxy (proxy.ts).
 *
 * NOTE: Do not run code between creating the client and calling
 * `supabase.auth.getUser()` — it can make sessions hard to debug.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // If Supabase isn't configured on this deployment (env vars missing),
  // `@supabase/ssr` throws "Your project's URL and Key are required", which
  // would 500 EVERY request — including the public landing page — because the
  // proxy runs on all routes. Skip the auth refresh instead so public pages
  // still render. Protected routes simply won't see a session until the env is
  // configured.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
  }

  // Host-only cookies (no custom domain) — matches the official Supabase SSR
  // pattern; the browser client, server client and middleware all agree on
  // scope, so the rotated refresh token round-trips correctly.
  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      }
    }
  });

  const { data: getUserData, error: getUserError } = await supabase.auth.getUser();
  const user = getUserData.user;

  // Build a redirect that carries the refreshed session cookies. Returning a
  // bare NextResponse.redirect() would DROP the cookies `setAll` wrote on
  // `supabaseResponse`, so a rotated refresh token would be lost and the next
  // request would fail with "Invalid Refresh Token" → an endless bounce.
  const redirectTo = (url: URL) => {
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => res.cookies.set(cookie));
    clearLegacyDomainCookies(request, res);
    return res;
  };

  // OAuth safety net: if a *page* redirect lands on a non-callback path
  // (e.g. Supabase fell back to the Site URL because the callback URL was not
  // in the redirect allowlist), forward the auth `code` to /auth/callback so
  // it gets exchanged — and surface any OAuth `error` on the login page.
  //
  // API routes are excluded: the integration OAuth callbacks
  // (/api/integrations/{provider}/callback) receive and exchange their OWN
  // provider `code`. Forwarding theirs to /auth/callback would hand a
  // Calendly/Slack code to Supabase and fail with "PKCE code verifier not found".
  const url = request.nextUrl;
  if (url.pathname !== '/auth/callback' && !url.pathname.startsWith('/api/')) {
    if (url.searchParams.has('code')) {
      const callback = url.clone();
      callback.pathname = '/auth/callback';
      if (!callback.searchParams.get('next')) {
        callback.searchParams.set('next', '/command-center');
      }
      return redirectTo(callback);
    }
    if (url.searchParams.has('error') && url.pathname !== '/login') {
      const login = url.clone();
      login.pathname = '/login';
      return redirectTo(login);
    }
  }

  const pathname = url.pathname;

  // Paths that never receive a status-based redirect — even when the user is
  // signed in. Anything `_next` / `public` is already filtered out by the
  // matcher in `proxy.ts`, but defending here too keeps this function safe in
  // isolation.
  const isStaticAsset =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/public') ||
    pathname.startsWith('/favicon') ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml';
  const isOnboarding = pathname === '/onboarding' || pathname.startsWith('/onboarding/');
  const isPublic =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname.startsWith('/auth/');
  const isAllowedApi =
    pathname === '/api/ask-earn' ||
    pathname === '/api/earn/profile-suggest' ||
    pathname.startsWith('/auth/callback');

  // Gate authenticated areas. Unauthenticated users hitting a protected route
  // are redirected to /login. Adjust the matcher list as modules land.
  const protectedPrefixes = [
    '/dashboard',
    '/pipeline',
    '/strategy',
    '/ask-earn',
    '/admin',
    '/notifications',
    '/settings',
    '/command-center',
    '/connections',
    '/integrations',
    '/onboarding'
  ];
  const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));

  // TEMP auth diagnostic — logged on gated paths only. Remove once resolved.
  if (isProtected || isOnboarding) {
    const authCookies = request.cookies
      .getAll()
      .filter((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
      .map((c) => `${c.name}(${c.value.length})`)
      .join(',');
    console.log(
      `[authdiag] path=${pathname} user=${user ? 'yes' : 'no'} err=${getUserError?.message ?? 'none'} cookies=[${authCookies || 'NONE'}]`
    );
  }

  if (!user && isProtected) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.searchParams.set('redirectedFrom', pathname);
    return redirectTo(login);
  }

  // Bidirectional onboarding gate. For an authenticated user, look up their
  // `member_profiles.status`. Anything other than `'complete'` forces them
  // onto `/onboarding`; a completed profile is bounced away from `/onboarding`
  // back into the app. We only run the lookup for routes that actually need
  // gating — static assets, public pages, and the two allow-listed APIs skip
  // it so the middleware stays fast on hot paths.
  if (user && !isStaticAsset && !isPublic && !isAllowedApi) {
    const { data: mp } = await supabase
      .from('member_profiles')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle();
    const isComplete = mp?.status === 'complete';

    if (!isComplete && !isOnboarding) {
      const onboarding = request.nextUrl.clone();
      onboarding.pathname = '/onboarding';
      onboarding.search = '';
      onboarding.searchParams.set('from', pathname);
      return redirectTo(onboarding);
    }

    if (isComplete && isOnboarding) {
      const commandCenter = request.nextUrl.clone();
      commandCenter.pathname = '/command-center';
      commandCenter.search = '';
      return redirectTo(commandCenter);
    }
  }

  clearLegacyDomainCookies(request, supabaseResponse);
  return supabaseResponse;
}
