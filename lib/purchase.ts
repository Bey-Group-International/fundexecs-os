// lib/purchase.ts
// The EFFECT of a completed purchase — activating a plan or crediting a pack —
// factored out of Stripe fulfillment (lib/stripe) so the Stripe path and the
// native in-app checkout (app/(app)/wallet/actions) apply value identically.
// Verification/idempotency belong to the caller; this is the "grant + record"
// effect against the service-role client. Everything routes through
// grantCredits, so the credit_ledger — the Credit History surface — records
// every purchase regardless of which path completed it.
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";
import { awardReferralOnSubscription } from "@/lib/gift-earn";
import {
  PLAN_BY_KEY,
  CREDIT_PACKS,
  planGrantCredits,
  planPurchaseSummary,
  packPurchaseSummary,
  type PlanKey,
  type PlanInterval,
} from "@/lib/billing";

type ServiceClient = ReturnType<typeof createServiceClient>;

// Activate a plan for an org: set the wallet's plan fields (preserving the
// original plan_started_at so tenure accrues from the first activation), grant
// the interval's credit allotment, and settle any pending referral chain. Used
// by Stripe fulfillment (with the Stripe customer id) and by the native path.
export async function activatePlan(
  service: ServiceClient,
  orgId: string,
  planKey: PlanKey,
  interval: PlanInterval,
  opts: { stripeCustomerId?: string | null; note?: string } = {},
): Promise<void> {
  const plan = PLAN_BY_KEY[planKey];
  if (!plan) return;

  const { data: existing } = await service
    .from("wallets")
    .select("plan_started_at")
    .eq("organization_id", orgId)
    .maybeSingle();
  const planStartedAt = existing?.plan_started_at ?? new Date().toISOString();

  await service.from("wallets").upsert(
    {
      organization_id: orgId,
      plan: plan.key,
      plan_interval: interval,
      plan_started_at: planStartedAt,
      ...(opts.stripeCustomerId ? { stripe_customer_id: opts.stripeCustomerId } : {}),
    },
    { onConflict: "organization_id" },
  );

  await grantCredits(service, orgId, planGrantCredits(plan, interval), "plan_grant", {
    note: opts.note ?? `${plan.name} plan (${interval})`,
  });

  // Pay any pending referral chain now that this org has an active plan.
  try {
    await awardReferralOnSubscription(orgId, service);
  } catch (err) {
    console.error("[referral] awardReferralOnSubscription failed:", err);
  }
}

// Credit an org for a one-off pack purchase. Ledger row (via grantCredits) is the
// transaction record shown in Credit History.
export async function addPack(
  service: ServiceClient,
  orgId: string,
  packKey: string,
  opts: { note?: string } = {},
): Promise<void> {
  const pack = CREDIT_PACKS.find((p) => p.key === packKey);
  if (!pack) return;
  await grantCredits(service, orgId, pack.credits, "pack_purchase", {
    note: opts.note ?? `${pack.credits} credit pack`,
  });
}

// A native (Stripe-free) purchase to complete in-app: what to grant.
export interface NativePurchaseInput {
  orgId: string;
  createdBy: string | null;
  kind: "plan" | "pack";
  planKey?: PlanKey;
  interval?: PlanInterval;
  packKey?: string;
}

// Complete a purchase natively — no external processor. Applies the same effect
// the Stripe path does (activatePlan / addPack) and writes a `fulfilled`
// stripe_checkouts audit row (with a `native_…` session id and native=true
// metadata) so the purchase is auditable alongside Stripe ones. Callers MUST
// gate this on Stripe NOT being configured, so it can never hand out paid value
// when a real processor is active. Returns the credits granted.
export async function completeNativePurchase(
  input: NativePurchaseInput,
): Promise<{ ok: boolean; credits?: number; error?: string }> {
  const summary =
    input.kind === "plan"
      ? input.planKey
        ? planPurchaseSummary(input.planKey, input.interval ?? "monthly")
        : null
      : input.packKey
        ? packPurchaseSummary(input.packKey)
        : null;
  if (!summary) return { ok: false, error: "Unknown purchase." };

  const service = createServiceClient();

  // Audit row mirroring the Stripe path (stripe_checkouts), marked native.
  try {
    await service.from("stripe_checkouts").insert({
      organization_id: input.orgId,
      session_id: `native_${randomUUID()}`,
      kind: input.kind,
      amount_usd: summary.priceUsd,
      status: "fulfilled",
      metadata: {
        native: "true",
        ...(input.planKey ? { plan_key: input.planKey, interval: input.interval ?? "monthly" } : {}),
        ...(input.packKey ? { pack_key: input.packKey } : {}),
      },
      created_by: input.createdBy,
      fulfilled_at: new Date().toISOString(),
    });
  } catch (err) {
    // Non-fatal: the grant (and its ledger row) is the source of truth.
    console.error("[native-purchase] audit insert failed:", err);
  }

  if (input.kind === "plan" && input.planKey) {
    await activatePlan(service, input.orgId, input.planKey, input.interval ?? "monthly", {
      note: `${summary.label} — in-app`,
    });
  } else if (input.kind === "pack" && input.packKey) {
    await addPack(service, input.orgId, input.packKey, { note: `${summary.label} — in-app` });
  }

  return { ok: true, credits: summary.credits };
}
