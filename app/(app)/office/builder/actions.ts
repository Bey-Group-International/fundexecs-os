"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeAvatarConfig, type AvatarConfig } from "@/lib/office/avatarConfig";

// Persist the member's Virtual Office character onto their own
// `office_member_prefs` row (avatar jsonb column, reserved for exactly this by
// migration 20260720140000). The input is always re-normalized server-side, so
// a tampered client payload can never store an out-of-catalog value. RLS scopes
// the write to `principal_id = auth.uid()` within an org the caller belongs to,
// so a member can only ever write their own character.
export async function saveAvatarConfig(
  input: AvatarConfig,
): Promise<{ error?: string; config?: AvatarConfig }> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Not authenticated" };
  if (!ctx.orgId) return { error: "No active organization" };

  const config = normalizeAvatarConfig(input);
  const supabase = await createServerClient();

  const { error } = await supabase
    .from("office_member_prefs")
    .upsert(
      {
        organization_id: ctx.orgId,
        principal_id: ctx.userId,
        avatar: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,principal_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/office/builder");
  revalidatePath("/office");
  return { config };
}
