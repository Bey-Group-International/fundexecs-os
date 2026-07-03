import { NextResponse } from "next/server";
import {
  createServerClient,
  createServiceClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";
import { grantTrialCreditsIfEligible } from "@/lib/trial";

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
  const next = sanitizeNextPath(searchParams.get("next"), origin);

  if (!hasSupabaseServerEnv()) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Auth not configured.")}`);
  }

  const supabase = createServerClient();

  if (code) {
    // OAuth flow (Google)
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await maybeGrantTrial(supabase);
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
      await maybeGrantTrial(supabase);
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

// Only allow internal, same-origin paths as post-auth redirect targets. Prefix
// checks alone are bypassable ("/\evil.com" — browsers normalize backslash to
// slash, making it protocol-relative), so resolve against our origin and
// require the result to stay there.
function sanitizeNextPath(rawNext: string | null, origin: string): string {
  const fallback = "/workspace";
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//") || rawNext.includes("\\")) {
    return fallback;
  }
  try {
    const resolved = new URL(rawNext, origin);
    if (resolved.origin !== origin) return fallback;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return fallback;
  }
}

// Best-effort trial credit grant after any successful auth exchange.
// Silently swallows errors so a credit-system hiccup never blocks login.
//
// Takes the SAME client that performed the exchange: its in-memory session is
// valid immediately, whereas a fresh client (e.g. via getSessionContext) only
// sees the incoming request cookies — the just-issued session cookies are on
// the outgoing response and not visible to it yet.
async function maybeGrantTrial(
  supabase: ReturnType<typeof createServerClient>,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    // Membership lookup via the service client — the new session's RLS grants
    // may not be attached to this request either.
    const { data: membership } = await createServiceClient()
      .from("organization_members")
      .select("organization_id")
      .eq("principal_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!membership?.organization_id) return;
    await grantTrialCreditsIfEligible(membership.organization_id);
  } catch (err) {
    console.error("[auth-callback] maybeGrantTrial failed:", err);
  }
}
