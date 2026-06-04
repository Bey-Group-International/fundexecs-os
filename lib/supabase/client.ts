import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

/**
 * Supabase client for use in Client Components (runs in the browser).
 * Reads the public env vars, so it is safe to import from client code.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
