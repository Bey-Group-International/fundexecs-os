// Session refresh helper for Next.js middleware. Runs on every matched request
// to keep the Supabase auth cookie fresh. Auth *gating* happens in the authed
// layout (lib/auth.ts) — this only refreshes the session.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // If Supabase env isn't configured (e.g. a preview deployment without the
  // vars), skip the refresh rather than throwing — a missing env var must never
  // 500 every route, including the public landing page. Trim guards against a
  // value pasted with stray whitespace.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return response;

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touch the session so the cookie is refreshed when near expiry. Never let a
  // transient auth/network error crash the request — gating happens in the
  // authed layout, not here.
  try {
    await supabase.auth.getUser();
  } catch {
    // ignore
  }

  return response;
}
