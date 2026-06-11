'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** Restrict to same-origin relative paths to avoid open redirects. */
function safePath(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') ? path : '/command-center';
}

/**
 * Server-side password sign-in. Signing in here writes the Supabase session into
 * server-readable cookies — the same path the Google OAuth callback uses — so
 * the middleware sees the session on the very next request and the user isn't
 * bounced back to /login. (Client-side sign-in wrote cookies the server never
 * received, causing a /login ⇄ /command-center redirect loop.)
 *
 * Returns an error message on failure; on success it redirects (never returns).
 */
export async function signInWithPasswordAction(
  redirectTo: string,
  email: string,
  password: string
): Promise<{ error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect(safePath(redirectTo));
}
