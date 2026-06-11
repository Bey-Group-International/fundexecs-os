import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSiteURL } from '@/lib/site-url';
import type { Database } from '@/lib/supabase/database.types';
import { authCookieDomain } from '@/lib/supabase/cookie-domain';

/**
 * Server-initiated Google sign-in.
 *
 * The browser client's `signInWithOAuth` did not persist the PKCE code-verifier
 * as a server-readable cookie, so the `/auth/callback` exchange failed with
 * "PKCE code verifier not found". Initiating the flow server-side lets us write
 * the verifier cookie via `Set-Cookie` on the redirect response — the same
 * mechanism the integration connect route uses successfully.
 *
 * Identity only — no Gmail/Calendar scopes here. Requesting restricted scopes
 * at sign-in put Google's "unverified app" wall in front of every user; those
 * scopes belong to the Settings → Integrations connect flow, which asks for
 * them only when a member actually connects Gmail/Calendar.
 */
export async function GET(request: NextRequest) {
  const requested = new URL(request.url).searchParams.get('next');
  const next =
    requested && requested.startsWith('/') && !requested.startsWith('//')
      ? requested
      : '/command-center';

  const cookieStore = await cookies();
  const pending: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { domain: authCookieDomain() },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          for (const cookie of toSet) pending.push(cookie);
        }
      }
    }
  );

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${getSiteURL()}/auth/callback?next=${encodeURIComponent(next)}`
    }
  });

  if (error || !data.url) {
    const login = new URL('/login', request.url);
    login.searchParams.set('error', error?.message ?? 'Could not start Google sign-in.');
    return NextResponse.redirect(login);
  }

  const response = NextResponse.redirect(data.url);
  for (const cookie of pending) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}
