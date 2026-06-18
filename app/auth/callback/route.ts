import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// OAuth callback. Supabase redirects here with a `code` after the user
// authorizes with Google; we exchange it for a session (persisted to cookies)
// and send them into the app. The (app) layout bounces to onboarding when the
// new principal has no organization yet.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/workspace";

  if (code) {
    const supabase = createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Could not sign in with Google. Please try again.")}`,
  );
}
