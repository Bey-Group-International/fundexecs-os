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

  const {
    data: { user }
  } = await supabase.auth.getUser();

  // OAuth safety net: if a provider redirect lands on a non-callback path
  // (e.g. Supabase fell back to the Site URL because the callback URL was not
  // in the redirect allowlist), forward the auth `code` to /auth/callback so
  // it gets exchanged — and surface any OAuth `error` on the login page.
  const url = request.nextUrl;
  if (url.pathname !== '/auth/callback') {
    if (url.searchParams.has('code')) {
      const callback = url.clone();
      callback.pathname = '/auth/callback';
      if (!callback.searchParams.get('next')) {
        callback.searchParams.set('next', '/command-center');
      }
      return NextResponse.redirect(callback);
    }
    if (url.searchParams.has('error') && url.pathname !== '/login') {
      const login = url.clone();
      login.pathname = '/login';
      return NextResponse.redirect(login);
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

  if (!user && isProtected) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.searchParams.set('redirectedFrom', pathname);
    return NextResponse.redirect(login);
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
      return NextResponse.redirect(onboarding);
    }

    if (isComplete && isOnboarding) {
      const commandCenter = request.nextUrl.clone();
      commandCenter.pathname = '/command-center';
      commandCenter.search = '';
      return NextResponse.redirect(commandCenter);
    }
  }

  return supabaseResponse;
}
