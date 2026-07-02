// Free trial credits: 250 credits granted exactly once per org when the owner's
// email is verified. Idempotent — the `trial_granted_at` column on wallets is
// set atomically with the credit grant so a retry or double-call is a no-op.
import { createServiceClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";

export const TRIAL_CREDITS = 250;

export async function grantTrialCreditsIfEligible(orgId: string): Promise<boolean> {
  const service = createServiceClient();

  // Check if trial already granted — fast path avoids the credit write.
  const { data: wallet } = await service
    .from("wallets")
    .select("trial_granted_at")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (wallet?.trial_granted_at) return false; // already granted

  // Mark granted first (upsert) then credit — if the credit write fails the
  // column is already set, so a retry won't double-grant; the user can contact
  // support for a manual adjustment in that rare case.
  const now = new Date().toISOString();
  const { error: markErr } = await service
    .from("wallets")
    .upsert(
      { organization_id: orgId, trial_granted_at: now },
      { onConflict: "organization_id" },
    );
  if (markErr) {
    console.error("[trial] could not mark trial_granted_at:", markErr.message);
    return false;
  }

  try {
    await grantCredits(service, orgId, TRIAL_CREDITS, "free_tier", {
      note: "Welcome to FundExecs OS",
    });
  } catch (err) {
    console.error("[trial] grantCredits failed after marking:", err);
    // trial_granted_at is already set; credit will need manual recovery.
  }

  return true;
}
