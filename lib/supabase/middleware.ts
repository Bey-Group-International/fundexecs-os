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

  // Gate authenticated areas. Unauthenticated users hitting a protected
  // route are redirected to /login. Adjust the matcher list as modules land.
  const protectedPrefixes = [
    '/dashboard',
    '/pipeline',
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
