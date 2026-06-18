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

interface OrgInsert {
  name: string;
  slug: string;
  entity_type: string | null;
  hq_location: string | null;
  operator_role: string | null;
  aum_range: string | null;
  fund_count: number | null;
  primary_strategy: string | null;
  first_hub: string | null;
  created_by: string;
}

// Creates the organization. The DB trigger handle_new_organization adds the
// creating principal as owner, so the new org is immediately accessible.
export async function createOrganization(formData: FormData) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/onboarding?error=Name+is+required");

  const supabase = createServerClient();
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;

  const payload: OrgInsert = {
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
  };

  // Extra onboarding fields are not yet in the generated types — insert via unknown cast
  // until the Supabase migration adding these columns is applied.
  const table = supabase.from("organizations") as unknown as {
    insert: (v: OrgInsert) => Promise<{ error: { message: string } | null }>;
  };
  const { error } = await table.insert(payload);

  if (error) {
    redirect(`/onboarding?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/workspace");
}
