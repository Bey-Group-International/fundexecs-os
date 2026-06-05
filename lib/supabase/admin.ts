import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/**
 * Resolve a server env var by its canonical suffix, tolerating an integration
 * prefix. The Supabase → Vercel integration names its vars with the project
 * slug as a prefix (e.g. `fundexecs_os_SUPABASE_SERVICE_ROLE_KEY`), so we
 * accept the exact name first, then any var ending in `_<suffix>`.
 */
function resolveServerEnv(suffix: string): string | undefined {
  const exact = process.env[suffix];
  if (exact) return exact;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.endsWith(`_${suffix}`)) return value;
  }
  return undefined;
}

/**
 * Service-role Supabase client for trusted server-side work (ingestion jobs,
 * cross-user writes). Bypasses RLS, so it must NEVER be imported into client
 * code — the `server-only` guard above enforces that at build time.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || resolveServerEnv('SUPABASE_URL');
  const serviceRoleKey = resolveServerEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
