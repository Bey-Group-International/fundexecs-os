"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

// Entity editing now lives on the unified Firm Identity page (#entity section).
const ENTITY = "/build/profile";

// Link a cap-table stakeholder to an existing identity — a team member
// (principal) or an investor/LP — so the firm cap table and people/LP records
// share identities. 'none' clears both links. Scoped to the caller's org.
export async function linkStakeholder(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;

  const stakeholderId = String(formData.get("stakeholderId") ?? "");
  if (!stakeholderId) return;

  const linkType = String(formData.get("link_type") ?? "none");
  const linkId = String(formData.get("link_id") ?? "").trim();

  let principal_id: string | null = null;
  let investor_id: string | null = null;
  if (linkType === "principal" && linkId) principal_id = linkId;
  else if (linkType === "investor" && linkId) investor_id = linkId;

  const supabase = await createServerClient();
  await supabase
    .from("stakeholders")
    .update({ principal_id, investor_id })
    .eq("id", stakeholderId)
    .eq("organization_id", ctx.orgId);

  revalidatePath(ENTITY);
}
