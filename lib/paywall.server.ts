// lib/paywall.server.ts
// Resolving an org's actual position against the credit wall, and clearing it.
//
// The wall itself is decided by lib/paywall (pure); this fetches the facts it
// needs and owns the one action that clears it — committing to a plan, which
// grants the period's credits immediately and leaves the invoice outstanding.
import { createServiceClient } from "@/lib/supabase/server";
import { settlementContext } from "@/lib/native-payments.server";
import { offeredRoutes, type PayableRoute, type RouteFacts } from "@/lib/native-payments";
import { recentSpend } from "@/lib/credits";
import { startSubscription } from "@/lib/subscriptions.server";
import type { PlanKey, PlanInterval } from "@/lib/billing";
import {
  evaluatePaywall,
  paywallPayload,
  type PaywallPayload,
  type PaywallState,
} from "@/lib/paywall";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Everything the wall decision needs about one org, in a single pass.
 *
 * Read on the service role: this runs inside API routes that have already
 * authenticated the caller and need the org's billing facts regardless of what
 * the caller's own RLS view would show.
 */
export async function paywallStateFor(
  orgId: string,
  required: number,
  client?: ServiceClient,
): Promise<PaywallState> {
  const service = client ?? createServiceClient();

  const [walletRes, orgRes, unpaidRes, burn] = await Promise.all([
    service.from("wallets").select("credits, plan").eq("organization_id", orgId).maybeSingle(),
    service.from("organizations").select("created_at").eq("id", orgId).maybeSingle(),
    // A period that was never settled. One is enough: this is about whether the
    // org has already taken a period on credit and not paid for it.
    service
      .from("subscription_invoices")
      .select("id")
      .eq("organization_id", orgId)
      .eq("status", "written_off")
      .limit(1),
    recentSpend(orgId).catch(() => 0),
  ]);

  const wallet = walletRes.data as { credits?: number; plan?: string | null } | null;
  const org = orgRes.data as { created_at?: string | null } | null;

  return evaluatePaywall({
    balance: wallet?.credits ?? 0,
    required,
    orgCreatedAt: org?.created_at ?? null,
    // 'free' is the signup marker, not a paid plan — an org on it is a
    // first-time subscriber, not someone topping up.
    hasPlan: Boolean(wallet?.plan && wallet.plan !== "free"),
    hasUnpaidHistory: (unpaidRes.data ?? []).length > 0,
    recentSpend: burn,
  });
}

/**
 * The ways this org could settle, for the chooser at the wall.
 *
 * Resolved server-side because availability is a fact about the org and the
 * deployment (a linked account, configured remittance, a card on file), never
 * something the browser should assert.
 */
export async function settlementOptionsFor(
  orgId: string,
  client?: ServiceClient,
): Promise<{ options: RouteFacts[]; current: PayableRoute | null }> {
  const service = client ?? createServiceClient();
  const { cap, preference } = await settlementContext(service, orgId);
  return { options: offeredRoutes(cap), current: preference };
}

/** The payload a blocked route hands back so the client can render the wall. */
export async function paywallFor(
  orgId: string,
  required: number,
  client?: ServiceClient,
): Promise<PaywallPayload | null> {
  return paywallPayload(await paywallStateFor(orgId, required, client));
}

export interface CommitResult {
  ok: boolean;
  error?: string;
  /** Credits available immediately after committing. */
  balance?: number;
  credits?: number;
  /** The invoice now outstanding for the period just unlocked. */
  invoiceNumber?: string;
  /**
   * The invoice is already being collected from a linked bank account. When
   * false there is genuinely something left for the operator to do.
   */
  collecting?: boolean;
}

/**
 * Clear the wall by committing to a plan.
 *
 * The period's credits are granted NOW and the invoice goes out with normal
 * terms — the operator is unblocked in one click rather than waiting days for a
 * transfer to clear. That is a deliberate extension of credit: the exposure is
 * one period, and the ordinary dunning path closes a subscription that is never
 * paid for.
 *
 * Re-checked here rather than trusted from the caller: the browser can ask to
 * commit, but only this function decides whether an org is entitled to a period
 * on credit.
 */
export async function commitToPlan(
  orgId: string,
  planKey: PlanKey,
  interval: PlanInterval,
  createdBy: string | null,
  client?: ServiceClient,
  route?: PayableRoute | null,
): Promise<CommitResult> {
  const service = client ?? createServiceClient();

  // Record how they want to pay BEFORE starting the plan: startSubscription
  // reads the preference when it decides whether to debit the commit invoice on
  // the spot, so storing it afterwards would miss the very first collection —
  // the one the operator just chose a rail for.
  if (route) {
    const { error } = await service
      .from("wallets")
      .update({ preferred_route: route })
      .eq("organization_id", orgId);
    if (error) {
      // Not fatal. A stored preference is an optimisation over preferredRoute,
      // and refusing to start a paid plan because we could not write it down
      // would be a worse outcome than collecting on the default rail.
      console.error("[paywall] could not record the settlement choice:", error);
    }
  }

  const state = await paywallStateFor(orgId, 0, service);
  if (!state.canUnlockOnCommitment) {
    // Either they already hold a plan (this is a top-up, which goes through the
    // wallet) or they have an unpaid period behind them.
    return {
      ok: false,
      error:
        "This account can't start a new plan on credit. Settle the outstanding invoice, or add credits from the Wallet.",
    };
  }

  const started = await startSubscription(
    {
      orgId,
      planKey,
      interval,
      createdBy,
      // The whole point: hand over the period now, bill for it in the normal
      // way. startSubscription issues the invoice.
      grantBeforeSettlement: true,
    },
    service,
  );
  if (!started.ok && !started.invoiced) {
    return { ok: false, error: started.error ?? "Could not start the plan." };
  }

  const { data: wallet } = await service
    .from("wallets")
    .select("credits")
    .eq("organization_id", orgId)
    .maybeSingle();

  return {
    ok: true,
    balance: (wallet as { credits?: number } | null)?.credits ?? 0,
    credits: started.credits,
    invoiceNumber: started.invoice?.number,
    collecting: started.collecting ?? false,
  };
}
