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
  // Enumeration is Node-only territory — the edge runtime inlines statically
  // referenced vars and can reject dynamic access. Never let the fallback
  // scan take a runtime down.
  try {
    for (const [key, value] of Object.entries(process.env)) {
      if (value && key.endsWith(`_${suffix}`)) return value;
    }
  } catch {
    // Fall through — exact-name miss with no scannable env.
  }
  return undefined;
}

/**
 * Forgive the common paste shapes — surrounding whitespace, a missing
 * https:// scheme (bare hostname), a trailing slash. The malformed-URL
 * variant of this misconfiguration 500'd /login in production; the same
 * normalization already guards the e2e seeder and playwright.config.ts.
 */
function normalizeUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

/** The Supabase project URL, for server runtimes (Node + edge). */
export function supabaseUrl(): string | undefined {
  return normalizeUrl(
    resolveBySuffix('NEXT_PUBLIC_SUPABASE_URL') ?? resolveBySuffix('SUPABASE_URL')
  );
}

/** The Supabase anon/publishable key, for server runtimes (Node + edge). */
export function supabaseAnonKey(): string | undefined {
  return resolveBySuffix('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? resolveBySuffix('SUPABASE_ANON_KEY');
}
