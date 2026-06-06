import 'server-only';

import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Per-request cached authenticated user.
 *
 * A single page render fans out to several loaders (shell identity, active org,
 * member profile, dashboard context, trust…), each of which previously called
 * `supabase.auth.getUser()` independently. `getUser()` hits the Auth server, and
 * with that server capped at a small connection pool, the burst of concurrent
 * validations (multiplied across the document + RSC requests) intermittently
 * failed — returning a null user on a perfectly valid session and bouncing the
 * member to /login.
 *
 * Wrapping the call in React `cache()` dedupes every `getAuthUser()` in one
 * render to a SINGLE `getUser()` network call, keeping us well under the cap and
 * making the result consistent across all loaders in that render.
 */
export const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user;
});
