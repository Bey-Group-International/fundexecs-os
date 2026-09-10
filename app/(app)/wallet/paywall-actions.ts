"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { commitToPlan, settlementOptionsFor } from "@/lib/paywall.server";
import { PLAN_BY_KEY, type PlanInterval, type PlanKey } from "@/lib/billing";
import type { PayableRoute, RouteFacts } from "@/lib/native-payments";

export interface CommitActionResult {
  ok?: boolean;
  error?: string;
  /** Balance immediately after the unlock, so the caller can retry at once. */
  balance?: number;
  credits?: number;
  invoiceNumber?: string;
  planName?: string;
  /** The invoice is already being pulled from a linked bank account. */
  collecting?: boolean;
  /** The rail the period was actually put on. */
  route?: PayableRoute | null;
}

/**
 * How this org could pay, for the chooser at the wall.
 *
 * Read at render time rather than baked into the paywall payload: the payload
 * is produced by a blocked API route on the hot path, and an operator who links
 * a bank account in another tab should see that rail appear without the 402
 * having to be re-issued.
 */
export async function settlementOptionsAction(): Promise<{
  options: RouteFacts[];
  current: PayableRoute | null;
}> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { options: [], current: null };
    return await settlementOptionsFor(ctx.orgId);
  } catch (err) {
    // The chooser is an enhancement over "we pick for you". Losing it must not
    // take the wall down with it.
    console.error("[paywall] could not resolve settlement options:", err);
    return { options: [], current: null };
  }
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

    // Only a rail the pure layer recognises. Anything else is treated as no
    // choice at all rather than written through to the wallet.
    const raw = String(formData.get("route") ?? "");
    const route: PayableRoute | null =
      raw === "ach_debit" || raw === "card" || raw === "transfer" ? raw : null;

    const result = await commitToPlan(ctx.orgId, planKey, interval, ctx.userId, undefined, route);
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
      collecting: result.collecting,
      route,
    };
  } catch (err) {
    console.error("[paywall] commitToPlanAction failed:", err);
    return { error: "Something went wrong starting your plan. Please try again." };
  }
}
