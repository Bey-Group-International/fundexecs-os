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
  // Canonical host: redirect www → apex (https://fundexecs.com) with a
  // permanent 308 so auth cookies and the OAuth redirect allow-list only ever
  // need the one host. Runs before any Supabase work.
  if (request.headers.get('host') === 'www.fundexecs.com') {
    const target = new URL(
      request.nextUrl.pathname + request.nextUrl.search,
      'https://fundexecs.com'
    );
    return NextResponse.redirect(target, 308);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  );

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

  // Gate authenticated areas. Unauthenticated users hitting a protected
  // route are redirected to /login. Adjust the matcher list as modules land.
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
    '/integrations'
  ];
  const isProtected = protectedPrefixes.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectedFrom', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
