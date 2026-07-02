import { NextResponse } from "next/server";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { grantTrialCreditsIfEligible } from "@/lib/trial";
import { getSessionContext } from "@/lib/auth";

// OAuth callback (Google) and email OTP verification callback.
// Supabase redirects here with either:
//   - `code` — OAuth authorization code (Google sign-in)
//   - `token_hash` + `type=email` — email OTP verify link
// In both cases we exchange for a session and redirect into the app.
// On email verification we also attempt the free trial credit grant.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  // Only allow internal, same-origin paths — never "//evil.com" or absolute URLs.
  const rawNext = searchParams.get("next") ?? "/workspace";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/workspace";

  if (!hasSupabaseServerEnv()) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Auth not configured.")}`);
  }

  const supabase = createServerClient();

  if (code) {
    // OAuth flow (Google)
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await maybeGrantTrial();
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Could not sign in with Google. Please try again.")}`,
    );
  }

  if (tokenHash && type === "email") {
    // Email OTP / magic-link verification
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (!error) {
      await maybeGrantTrial();
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Email verification link is invalid or expired.")}`,
    );
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Invalid callback parameters.")}`,
  );
}

// Best-effort trial credit grant after any successful auth exchange.
// Silently swallows errors so a credit-system hiccup never blocks login.
async function maybeGrantTrial(): Promise<void> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return;
    await grantTrialCreditsIfEligible(ctx.orgId);
  } catch (err) {
    console.error("[auth-callback] maybeGrantTrial failed:", err);
  }
}
