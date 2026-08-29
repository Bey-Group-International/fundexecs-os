"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { notifyNewSignupOnce } from "@/lib/admin/signup-alert";
import { getAppUrlFromHeaders } from "@/lib/integrations/adapters/app-url";
import { DEFAULT_POST_AUTH_PATH, safeNextPathOrNull } from "@/lib/safe-next-path";

const SUPABASE_CONFIG_ERROR =
  "Authentication is not configured for this environment. Add Supabase URL and anon key, then try again.";

// Google OAuth. The Google provider's Client ID/Secret live in Supabase Auth
// (Authentication → Providers → Google), never in this repo. We only kick off
// the redirect; /auth/callback exchanges the returned code for a session.
//
// The callback URL comes from the SAME allow-listed resolver every other OAuth
// route uses, not from the raw `Origin` header. Origin is whatever host the
// browser happens to be on, and an installed PWA carries the host it was
// installed from for the life of the install — so a launch from a preview
// domain, a `www.` alias, or any other non-canonical host used to mint a
// redirectTo that the provider's allow-list has never seen, and the sign-in
// died at the provider. The old fallback chain ended at http://localhost:3000,
// which is the production incident lib/integrations/adapters/app-url.ts was
// written to prevent.
export async function signInWithGoogle(formData?: FormData) {
  if (!hasSupabaseServerEnv()) {
    redirect(`/login?error=${encodeURIComponent(SUPABASE_CONFIG_ERROR)}`);
  }

  const supabase = await createServerClient();
  const base = getAppUrlFromHeaders(await headers());

  // Carry the operator's intended destination across the round trip. Without
  // it every sign-in lands on /workspace — including one that started from a
  // deep link or an installed-app shortcut.
  const next = safeNextPathOrNull(asPath(formData?.get("next")), base);
  const callback = new URL("/auth/callback", base);
  if (next) callback.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString() },
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  if (data?.url) redirect(data.url);
}

/** FormData entries are string | File; only a string can be a path. */
function asPath(value: FormDataEntryValue | null | undefined): string | null {
  return typeof value === "string" ? value : null;
}

// Email/password auth for pre-alpha. Local Supabase has email confirmations
// disabled (see supabase/config.toml), so sign-up yields an immediate session.
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!hasSupabaseServerEnv()) {
    redirect(`/login?error=${encodeURIComponent(SUPABASE_CONFIG_ERROR)}`);
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  // Same deep-link courtesy as the Google path: honor where they were headed.
  const base = getAppUrlFromHeaders(await headers());
  redirect(safeNextPathOrNull(asPath(formData.get("next")), base) ?? DEFAULT_POST_AUTH_PATH);
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "");

  if (!hasSupabaseServerEnv()) {
    redirect(`/login?mode=signup&error=${encodeURIComponent(SUPABASE_CONFIG_ERROR)}`);
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) {
    // Keep the user on the sign-up form so they can correct and retry.
    redirect(`/login?mode=signup&error=${encodeURIComponent(error.message)}`);
  }

  // Alert the internal team about the new signup. Fire-and-forget with an
  // await'd best-effort call (it never throws) so it runs before the redirect
  // unwinds the request; the DB claim in the helper makes it exactly-once even
  // if the OAuth path also fires.
  if (data.user?.id) {
    await notifyNewSignupOnce(data.user.id);
  }

  // When email confirmation is required, signUp returns no session. Attempt an
  // immediate sign-in (this succeeds when confirmations are disabled — see
  // supabase/config.toml). Only if that fails do we ask the user to confirm,
  // rather than silently bouncing them back through onboarding → login.
  if (!data.session) {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      redirect(
        `/login?message=${encodeURIComponent(
          "Account created. Check your email to confirm, then sign in.",
        )}`,
      );
    }
  }

  // New principals have no org yet — onboarding handles creation.
  redirect("/onboarding");
}

export async function signOut() {
  if (!hasSupabaseServerEnv()) redirect("/login");

  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
