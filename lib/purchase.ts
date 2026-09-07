// lib/purchase.ts
// The EFFECT of a completed ONE-OFF purchase — crediting a pack — factored out
// of Stripe fulfillment (lib/stripe) so the Stripe path and the native in-app
// checkout (app/(app)/wallet/actions) apply value identically. Verification and
// idempotency belong to the caller; this is the "grant + record" effect against
// the service-role client. Everything routes through grantCredits, so the
// credit_ledger — the Credit History surface — records every purchase
// regardless of which path completed it.
//
// Plans do NOT live here. A plan is a subscription with a billing period, a
// renewal and a cancellation, so it is started through lib/subscriptions.server
// instead; a plan granted here would be entitlement with nothing to renew or
// cancel it, which is precisely the state this codebase used to get stuck in.
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";
import { CREDIT_PACKS, packPurchaseSummary } from "@/lib/billing";

type ServiceClient = ReturnType<typeof createServiceClient>;

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

// A native (Stripe-free) pack purchase to complete in-app: what to grant.
export interface NativePurchaseInput {
  orgId: string;
  createdBy: string | null;
  kind: "pack";
  packKey?: string;
}

// Complete a pack purchase natively — no external processor. Applies the same
// effect the Stripe path does (addPack) and writes a `fulfilled`
// stripe_checkouts audit row (with a `native_…` session id and native=true
// metadata) so the purchase is auditable alongside Stripe ones. Callers MUST
// gate this on Stripe NOT being configured, so it can never hand out paid value
// when a real processor is active. Returns the credits granted.
export async function completeNativePurchase(
  input: NativePurchaseInput,
): Promise<{ ok: boolean; credits?: number; error?: string }> {
  const summary = input.packKey ? packPurchaseSummary(input.packKey) : null;
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
        ...(input.packKey ? { pack_key: input.packKey } : {}),
      },
      created_by: input.createdBy,
      fulfilled_at: new Date().toISOString(),
    });
  } catch (err) {
    // Non-fatal: the grant (and its ledger row) is the source of truth.
    console.error("[native-purchase] audit insert failed:", err);
  }

  if (input.packKey) {
    await addPack(service, input.orgId, input.packKey, { note: `${summary.label} — in-app` });
  }

  return { ok: true, credits: summary.credits };
}
