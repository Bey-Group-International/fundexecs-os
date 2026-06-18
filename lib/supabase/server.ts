// Server Supabase clients for the Next.js App Router.
//
// - createServerClient(): request-scoped, cookie-bound, RLS-enforced. Use this
//   inside Server Components, Route Handlers, and Server Actions.
// - createServiceClient(): service-role, RLS-BYPASSING. Server-only. Use only
//   for trusted background work (task engine, audit writes). Never expose to
//   the browser and never derive the acting user from it without checks.
import { createServerClient as createSSRClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createRawClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export function createServerClient() {
  const cookieStore = cookies();
  return createSSRClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Safe to ignore when middleware refreshes the session.
          }
        },
      },
    },
  );
}

export function createServiceClient() {
  return createRawClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
