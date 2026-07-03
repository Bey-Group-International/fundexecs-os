// Free trial credits: 250 credits granted exactly once per org when the owner's
// email is verified. Idempotent AND race-safe — the claim flips
// `trial_granted_at` from NULL atomically, so of two concurrent callers only
// one proceeds to the credit grant.
import { createServiceClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";

export const TRIAL_CREDITS = 250;

export async function grantTrialCreditsIfEligible(orgId: string): Promise<boolean> {
  const service = createServiceClient();
  const now = new Date().toISOString();

  // Atomically claim the grant: only one caller can flip trial_granted_at from
  // NULL — a concurrent duplicate matches zero rows and skips the credit write.
  const { data: claimed, error: claimErr } = await service
    .from("wallets")
    .update({ trial_granted_at: now })
    .eq("organization_id", orgId)
    .is("trial_granted_at", null)
    .select("id");

  if (claimErr) {
    console.error("[trial] claim update failed:", claimErr.message);
    return false;
  }

  let won = (claimed?.length ?? 0) > 0;

  if (!won) {
    // Zero rows: either the trial was already granted, or the org has no wallet
    // row yet. Try to create one with the claim pre-stamped; ignoreDuplicates
    // means a concurrent creator wins cleanly (no row returned → we lost/skip;
    // an unclaimed pre-existing row is caught by the update path on the next call).
    const { data: created, error: insertErr } = await service
      .from("wallets")
      .upsert(
        { organization_id: orgId, trial_granted_at: now },
        { onConflict: "organization_id", ignoreDuplicates: true },
      )
      .select("id");
    if (insertErr) {
      console.error("[trial] claim insert failed:", insertErr.message);
      return false;
    }
    won = (created?.length ?? 0) > 0;
  }

  if (!won) return false; // already granted (or lost the race)

  try {
    await grantCredits(service, orgId, TRIAL_CREDITS, "free_tier", {
      note: "Welcome to FundExecs OS",
    });
  } catch (err) {
    console.error("[trial] grantCredits failed after claim:", err);
    // trial_granted_at is already set; credit will need manual recovery.
  }

  return true;
}
