import 'server-only';

import { cache } from 'react';
import { headers, cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

/** The minimal authenticated-user shape the server loaders need. */
export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * Per-request authenticated user.
 *
 * The edge middleware validates the session with `getUser()` (which works
 * reliably there) and forwards the result on the trusted `x-fx-user-id` /
 * `x-fx-user-email` request headers. We read those here instead of calling
 * `getUser()` again in the page render, because the serverless runtime's
 * `getUser()` call to the Auth server can fail on a perfectly valid session —
 * which previously returned a null user and bounced authenticated members to
 * /login. (RLS data queries are unaffected: PostgREST verifies the JWT from the
 * cookies locally, no Auth-server round-trip.)
 *
 * Falls back to a direct `getUser()` only if the header is absent (e.g. a route
 * the middleware matcher doesn't cover). Wrapped in React `cache()` so repeated
 * calls within one render share a single result.
 */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const h = await headers();
  const id = h.get('x-fx-user-id');
  if (id) {
    // TEMP root-cause probe: does the serverless render actually receive the
    // auth cookie, and does getUser() see a session? Behaviour uses the header
    // regardless. Remove once confirmed.
    try {
      const authCookieNames = (await cookies())
        .getAll()
        .filter((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
        .map((c) => `${c.name}(${c.value.length})`)
        .join(',');
      const supabase = await createClient();
      const { data, error } = await supabase.auth.getUser();
      console.log(
        `[authsrc] serverlessUser=${data.user ? 'yes' : 'NO'} err=${error?.message ?? 'none'} authCookies=[${authCookieNames || 'NONE'}]`
      );
    } catch (e) {
      console.log(
        `[authsrc] serverless getUser threw: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    return { id, email: h.get('x-fx-user-email') };
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
});
