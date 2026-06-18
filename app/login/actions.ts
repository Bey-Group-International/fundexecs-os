"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

// Email/password auth for pre-alpha. Local Supabase has email confirmations
// disabled (see supabase/config.toml), so sign-up yields an immediate session.
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/workspace");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "");

  const supabase = createServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  // New principals have no org yet — onboarding handles creation.
  redirect("/onboarding");
}

export async function signOut() {
  const supabase = createServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
