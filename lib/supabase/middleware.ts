import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './database.types';

/**
 * Refreshes the Supabase auth session on every request and keeps the
 * session cookies in sync. Call this from the root proxy (proxy.ts).
 *
 * NOTE: Do not run code between creating the client and calling
 * `supabase.auth.getUser()` — it can make sessions hard to debug.
 */
/** True when the request carries a Supabase auth-token cookie (possibly chunked
 *  as `…-auth-token.0`/`.1`). Used to distinguish a transient `getUser()` null
 *  on a real session from a genuinely signed-out request. */
function hasSupabaseAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));
}

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

  let {
    data: { user }
  } = await supabase.auth.getUser();

  // The edge/serverless Auth call can transiently return a null user on a
  // perfectly valid session (a momentary failure to reach the Auth server).
  // When we still hold a Supabase auth cookie, that "null" is almost certainly
  // a blip — not a signed-out user — so retry once before treating the request
  // as unauthenticated. Without this, a single blip on a protected navigation
  // (e.g. clicking the top-nav bell) bounces a signed-in member to /login.
  if (!user && hasSupabaseAuthCookie(request)) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    ({
      data: { user }
    } = await supabase.auth.getUser());
  }

  // Pass the edge-validated user to the (serverless) page via a TRUSTED request
  // header. The serverless runtime's `getUser()` can fail to reach the Auth
  // server even on a valid session — which made pages see a null user and
  // redirect authenticated members to /login. The header lets the page trust the
  // user the edge already validated, with no second network round-trip.
  // Security: strip any client-supplied value first, then set only from the
  // validated user — the matcher runs this on every app route, so it can't be
  // spoofed past the middleware.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-fx-user-id');
  requestHeaders.delete('x-fx-user-email');
  if (user) {
    requestHeaders.set('x-fx-user-id', user.id);
    if (user.email) requestHeaders.set('x-fx-user-email', user.email);
  }
  {
    const rebuilt = NextResponse.next({ request: { headers: requestHeaders } });
    supabaseResponse.cookies.getAll().forEach((cookie) => rebuilt.cookies.set(cookie));
    supabaseResponse = rebuilt;
  }

  // Build a redirect that carries the refreshed session cookies. Returning a
  // bare NextResponse.redirect() would DROP the cookies `setAll` wrote on
  // `supabaseResponse`, so a rotated refresh token would be lost and the next
  // request would fail with "Invalid Refresh Token" → an endless bounce.
  const redirectTo = (url: URL) => {
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => res.cookies.set(cookie));
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
    pathname.startsWith('/p/') ||
    pathname.startsWith('/auth/');
  const isAllowedApi =
    pathname === '/api/ask-earn' ||
    pathname === '/api/earn/profile-suggest' ||
    pathname.startsWith('/auth/callback');

  // Gate authenticated areas. Unauthenticated users hitting a protected route
  // are redirected to /login (preserving `redirectedFrom`). Every entry is an
  // auth-only surface whose page already self-redirects when there's no session;
  // listing it here does that earlier (before the server render) and uniformly.
  // Routes that intentionally render a graceful no-org or public-preview state
  // for signed-out visitors — /deal-desk, /governance, /ic-memos, /lp-room — are
  // deliberately NOT listed; they handle that case themselves.
  const protectedPrefixes = [
    '/admin',
    '/ask-earn',
    '/audit',
    '/cap-table',
    '/capital-stack',
    '/command-center',
    '/connections',
    '/dashboard',
    '/diligence',
    '/inbox-intelligence',
    '/integrations',
    '/knowledge',
    '/match-inbox',
    '/materials',
    '/notifications',
    '/objections',
    '/onboarding',
    '/partners',
    '/pipeline',
    '/profile',
    '/referrals',
    '/settings',
    '/strategy'
  ];
  const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));

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
    // Perf: once a profile is `complete` we cache that in a lightweight cookie
    // keyed to the user id, so the hot path skips the per-request
    // `member_profiles` lookup. The cookie value is the user's own id — a
    // different user (e.g. shared browser) won't match, so they still get a
    // fresh check. This governs ONLY the onboarding redirect (a UX gate); it
    // never affects data access, which RLS enforces independently, so a stale
    // or forged value is harmless.
    let isComplete = request.cookies.get('fx-onb')?.value === user.id;

    if (!isComplete) {
      const { data: mp } = await supabase
        .from('member_profiles')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle();
      isComplete = mp?.status === 'complete';
      if (isComplete) {
        supabaseResponse.cookies.set('fx-onb', user.id, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24
        });
      }
    }

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

  return supabaseResponse;
}
