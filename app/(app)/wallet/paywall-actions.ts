"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { commitToPlan } from "@/lib/paywall.server";
import { PLAN_BY_KEY, type PlanInterval, type PlanKey } from "@/lib/billing";

export interface CommitActionResult {
  ok?: boolean;
  error?: string;
  /** Balance immediately after the unlock, so the caller can retry at once. */
  balance?: number;
  credits?: number;
  invoiceNumber?: string;
  planName?: string;
}

/**
 * Clear the credit wall by starting a plan.
 *
 * The credits are available the moment this returns — the invoice follows on
 * normal terms. That is what makes the wall a one-click interruption rather
 * than a multi-day stop, and it is why the entitlement decision is re-made
 * server-side in commitToPlan: the browser may ask, but it does not get to say
 * whether this org is owed a period on credit.
 */
export async function commitToPlanAction(formData: FormData): Promise<CommitActionResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };

    const planKey = String(formData.get("plan_key") ?? "") as PlanKey;
    const interval: PlanInterval =
      String(formData.get("interval") ?? "monthly") === "annual" ? "annual" : "monthly";
    const plan = PLAN_BY_KEY[planKey];
    if (!plan) return { error: "Unknown plan" };

    const result = await commitToPlan(ctx.orgId, planKey, interval, ctx.userId);
    if (!result.ok) return { error: result.error };

    // The balance in the top bar and the wallet are both stale now.
    revalidatePath("/wallet");
    revalidatePath("/", "layout");
    return {
      ok: true,
      balance: result.balance,
      credits: result.credits,
      invoiceNumber: result.invoiceNumber,
      planName: plan.name,
    };
  } catch (err) {
    console.error("[paywall] commitToPlanAction failed:", err);
    return { error: "Something went wrong starting your plan. Please try again." };
  }
}
