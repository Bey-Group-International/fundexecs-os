import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';
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
 * `getUser()` can return a null user on a perfectly valid session — which
 * previously bounced authenticated members to /login. (RLS data queries are
 * unaffected: PostgREST verifies the JWT from the cookies locally.)
 *
 * Falls back to a direct `getUser()` only if the header is absent (e.g. a route
 * the middleware matcher doesn't cover). Wrapped in React `cache()` so repeated
 * calls within one render share a single result.
 */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const h = await headers();
  const id = h.get('x-fx-user-id');
  if (id) return { id, email: h.get('x-fx-user-email') };

  const supabase = await createClient();
  let {
    data: { user }
  } = await supabase.auth.getUser();

  // Same transient-null guard as the middleware: a valid session can briefly
  // resolve to a null user when the Auth server is momentarily unreachable.
  // Retry once before reporting "no user" so a blip doesn't bounce the member.
  if (!user) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    ({
      data: { user }
    } = await supabase.auth.getUser());
  }

  return user ? { id: user.id, email: user.email ?? null } : null;
});
