"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";

// Update the active organization's Build › Profile fields. RLS restricts this
// to org admins/owners.
export async function updateProfile(formData: FormData) {
  const auth = await requireOrgContext();
  if (!auth.ok) return;

  const supabase = createServerClient();
  await supabase
    .from("organizations")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      legal_name: String(formData.get("legal_name") ?? "") || null,
      entity_type: String(formData.get("entity_type") ?? "") || null,
      jurisdiction: String(formData.get("jurisdiction") ?? "") || null,
      website: String(formData.get("website") ?? "") || null,
      description: String(formData.get("description") ?? "") || null,
    })
    .eq("id", auth.ctx.orgId);

  revalidatePath("/build/profile");
}
