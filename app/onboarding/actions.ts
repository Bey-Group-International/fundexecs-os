"use server";

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

// Creates the organization and its firm profile. The DB trigger
// handle_new_organization adds the creating principal as owner, so the new org
// is immediately accessible. Returns a result instead of redirecting — the
// client wizard navigates on success, so a redirect can't be swallowed by its
// try/catch.
export async function createOrganization(
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Not authenticated" };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Organization name is required" };

  const supabase = createServerClient();
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;

  const { error } = await supabase.from("organizations").insert({
    name,
    slug,
    entity_type: String(formData.get("entity_type") ?? "") || null,
    hq_location: String(formData.get("hq_location") ?? "") || null,
    operator_role: String(formData.get("role") ?? "") || null,
    aum_range: String(formData.get("aum_range") ?? "") || null,
    fund_count: Number(formData.get("fund_count")) || null,
    primary_strategy: String(formData.get("strategy") ?? "") || null,
    first_hub: String(formData.get("first_hub") ?? "") || null,
    created_by: ctx.userId,
  });

  if (error) return { error: error.message };
  return {};
}
