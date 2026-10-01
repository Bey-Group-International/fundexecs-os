// lib/document-upload-allowance.server.ts
//
// Resolve an org's upload allowance from its FundExecs plan. "Paid" here is
// exactly lib/feature-access's `unlocked`: an active paid plan, an org that
// predates the paywall, a platform admin, or a deployment where no plan can be
// bought (gating a purchase that cannot happen locks people out for nothing).
import "server-only";
import type { SessionContext } from "@/lib/auth";
import { featureAccessFor } from "@/lib/feature-access.server";
import { uploadAllowance, type UploadAllowance } from "@/lib/document-files";

export async function uploadAllowanceFor(ctx: SessionContext): Promise<UploadAllowance> {
  try {
    const access = await featureAccessFor(ctx);
    return uploadAllowance(access.unlocked);
  } catch {
    // A failed plan read must not hand out the paid limit.
    return uploadAllowance(false);
  }
}
