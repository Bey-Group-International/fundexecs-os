import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database.types';
import { authCookieDomain } from './cookie-domain';
import { supabaseAnonKey, supabaseUrl } from './env';

/**
 * Supabase client for use in Server Components, Route Handlers, and
 * Server Actions. Wires Supabase auth into Next.js cookies so sessions
 * persist across requests.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl()!, supabaseAnonKey()!, {
    cookieOptions: { domain: authCookieDomain() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions (see proxy.ts).
        }
      }
    }
  });
}
