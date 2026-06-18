"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "org"
  );
}

// Creates the organization. The DB trigger handle_new_organization adds the
// creating principal as owner, so the new org is immediately accessible.
export async function createOrganization(formData: FormData) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/onboarding?error=Name+is+required");

  const supabase = createServerClient();
  // Disambiguate the slug with a short suffix to avoid unique collisions.
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("organizations") as any).insert({
    name,
    slug,
    entity_type: String(formData.get("entity_type") ?? "") || null,
    hq_location: String(formData.get("hq_location") ?? "") || null,
    operator_role: String(formData.get("role") ?? "") || null,
    aum_range: String(formData.get("aum_range") ?? "") || null,
    fund_count: Number(formData.get("fund_count")) || null,
    primary_strategy: String(formData.get("strategy") ?? "") || null,
    first_hub: String(formData.get("first_hub") ?? "") || null,
    created_by: ctx!.userId,
  });

  if (error) {
    redirect(`/onboarding?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/workspace");
}
