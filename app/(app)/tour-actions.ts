"use server";

import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export async function setTourHidden(hidden: boolean): Promise<void> {
  const auth = await requireOrgContext();
  if (!auth.ok) return;
  const supabase = createServerClient();
  const { error } = await supabase
    .from("organizations")
    .update({ setup_hidden: hidden })
    .eq("id", auth.ctx.orgId);
  if (error) console.error("[tour] failed to persist setup_hidden", error.message);
}
