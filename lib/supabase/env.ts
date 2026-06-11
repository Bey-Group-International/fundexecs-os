/* ============================================================================
 * lib/supabase/env.ts — tolerant SERVER-side resolution of the public
 * Supabase env pair.
 *
 * The Supabase → Vercel integration names its variables with the project
 * slug as a prefix (e.g. `fundexecs_os_NEXT_PUBLIC_SUPABASE_URL`). The
 * browser bundle is immune (values are inlined at build), but server code
 * reading `process.env.NEXT_PUBLIC_SUPABASE_URL` at runtime crashes with
 * "Your project's URL and Key are required" — which 500'd /login and
 * /api/auth/google in production. Resolve the exact name first, then any
 * variable ending in the canonical suffix — the same strategy admin.ts
 * already uses for the service-role key.
 *
 * NOT for client components: the browser client must keep literal
 * `process.env.NEXT_PUBLIC_*` reads so Next can inline them at build.
 * ========================================================================= */

function resolveBySuffix(suffix: string): string | undefined {
  const exact = process.env[suffix];
  if (exact) return exact;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.endsWith(`_${suffix}`)) return value;
  }
  return undefined;
}

/** The Supabase project URL, for server runtimes (Node + edge). */
export function supabaseUrl(): string | undefined {
  return resolveBySuffix('NEXT_PUBLIC_SUPABASE_URL') ?? resolveBySuffix('SUPABASE_URL');
}

/** The Supabase anon/publishable key, for server runtimes (Node + edge). */
export function supabaseAnonKey(): string | undefined {
  return resolveBySuffix('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? resolveBySuffix('SUPABASE_ANON_KEY');
}
