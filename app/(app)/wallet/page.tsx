import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";
import { recentSpend } from "@/lib/credits";
import { createServerClient } from "@/lib/supabase/server";
import { listLinkedAccounts } from "@/lib/treasury/linked-accounts";
import { listTransfers } from "@/lib/treasury/transfers";
import { TreasuryPanel } from "./TreasuryPanel";
import {
  PLANS,
  PLAN_BY_KEY,
  formatCredits,
  formatUsd,
  annualSavingsUsd,
  annualSavingsPct,
  loyaltyBonus,
  tenureMonths,
  LOYALTY_STEP,
  LOYALTY_CAP,
} from "@/lib/billing";
import { stripeConfigured, stripePublishableKeyValue } from "@/lib/stripe";
import { compoundingProfile, type ReputationTier } from "@/lib/compounding";
import {
  walletRunway,
  formatRunway,
  recommendPlan,
  recommendTopUpPack,
} from "@/lib/wallet-insights";
import { PlanSelector, type PlanView } from "./PlanSelector";
import { CreditPacks } from "./CreditPacks";
import { CheckoutBanner } from "./CheckoutBanner";
import { CreditHistory } from "./CreditHistory";
import { GamificationPanel } from "./GamificationPanel";
import { CouponRedemption } from "./CouponRedemption";
import { BillingPortalButton } from "./BillingPortalButton";
import { CREDIT_GRACE_BUFFER } from "@/lib/credits";

export const dynamic = "force-dynamic";

const TIER_META: Record<ReputationTier, { label: string; blurb: string }> = {
  unranked: {
    label: "New Member",
    blurb: "Complete verified transactions to build your standing — it reduces the cost of every AI action.",
  },
  verified: {
    label: "Verified Operator",
    blurb: "A proven track record. Your actions cost less and your listings surface higher.",
  },
  established: {
    label: "Established",
    blurb: "Priority queue, deeper discounts, and the ability to attest verified outcomes.",
  },
  principal: {
    label: "Principal",
    blurb: "Top standing — maximum discount, lowest stake, and the standing to vouch for others.",
  },
};

export default async function WalletPage(
  props: {
    searchParams: Promise<{ checkout?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const live = stripeConfigured();
  const publishableKey = stripePublishableKeyValue();

  const [wallet, spend30d, profile] = await Promise.all([
    getWallet(ctx.orgId),
    recentSpend(ctx.orgId),
    compoundingProfile(ctx.orgId),
  ]);

  const supabase = await createServerClient();
  const [linkedAccounts, treasuryTransfers] = await Promise.all([
    listLinkedAccounts(supabase, ctx.orgId),
    listTransfers(supabase, ctx.orgId),
  ]);

  const balance = wallet?.credits ?? 0;
  const currentPlan = wallet?.plan ?? null;

  // Runway + grounded recommendations, derived from balance and 30-day burn.
  const runway = walletRunway(balance, spend30d, 30, CREDIT_GRACE_BUFFER);
  const recommendation = recommendPlan(spend30d, currentPlan);
  const recommendedKey = recommendation.key;
  const topUpPack = recommendTopUpPack(balance, spend30d);

  const months = currentPlan ? tenureMonths(wallet?.plan_started_at) : 0;
  const loyalty = loyaltyBonus(months);
  const planName = currentPlan ? PLAN_BY_KEY[currentPlan as keyof typeof PLAN_BY_KEY]?.name : null;
  const recommendedPlan = PLAN_BY_KEY[recommendedKey as keyof typeof PLAN_BY_KEY];

  const plans: PlanView[] = PLANS.map((p) => ({
    ...p,
    annualSavingsUsd: annualSavingsUsd(p),
    annualSavingsPct: annualSavingsPct(p),
  }));

  return (
    <div className="fx-neural-ambient mx-auto max-w-5xl">
      <header className="mb-6 flex flex-col gap-4 border-b border-line/50 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.32em] text-neural-300">
            FundExecs wallet core
          </span>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary sm:text-4xl">
            Credits &amp; plans
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-secondary">
            A high-control credit console for keeping the operating agents funded,
            routed, and ready for institutional workflows.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-line/60 bg-surface-2/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.24em] text-fg-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
          Compute credit ledger online
        </div>
      </header>

      <CheckoutBanner status={searchParams.checkout} />

      {runway.health !== "healthy" && (
        <div
          className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
            runway.health === "critical"
              ? "border-status-danger/40 bg-status-danger/[0.07]"
              : "border-amber-400/40 bg-amber-400/[0.07]"
          }`}
        >
          <span
            className={`mt-0.5 shrink-0 ${
              runway.health === "critical" ? "text-status-danger" : "text-amber-400"
            }`}
          >
            ⚠
          </span>
          <div>
            <span
              className={`font-medium ${
                runway.health === "critical" ? "text-status-danger" : "text-amber-300"
              }`}
            >
              {runway.health === "critical" ? "Credits critically low." : "Credits running low."}
            </span>{" "}
            <span className="text-fg-secondary">
              You have {formatCredits(balance)} credit{balance === 1 ? "" : "s"} remaining
              {runway.runwayDays !== null ? ` — about ${formatRunway(runway.runwayDays)} of runway at your recent pace` : ""}.
              {topUpPack
                ? ` Top up with the ${formatCredits(topUpPack.credits)}-credit pack (${formatUsd(topUpPack.price)})`
                : " Top up with a credit pack"}
              {recommendation.isUpgrade ? ` or upgrade to ${recommendedPlan?.name}` : ""} to keep agents funded.
            </span>
          </div>
        </div>
      )}

      <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.24em] text-gold-400/70">
        Account summary
      </h2>
      <section className="fx-neural-panel p-5 sm:p-6">
        <div className="relative z-10">
          {/* Balance ledger line — the account's headline figure. */}
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line/40 pb-5">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-fg-muted">
                Available balance
              </p>
              <p className="mt-2 flex items-baseline gap-2 font-display text-5xl font-semibold tracking-tight text-fg-primary">
                <span className="text-gold-400">◇</span>
                <span className="tabular-nums">{formatCredits(balance)}</span>
                <span className="font-mono text-[11px] font-normal uppercase tracking-[0.2em] text-fg-muted">
                  compute credits
                </span>
              </p>
              <p
                className={`mt-3 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${
                  runway.health === "critical"
                    ? "border-status-danger/40 bg-status-danger/[0.08] text-status-danger"
                    : runway.health === "low"
                      ? "border-amber-400/40 bg-amber-400/[0.08] text-amber-300"
                      : "border-line/60 bg-surface-2/40 text-fg-secondary"
                }`}
              >
                <span aria-hidden>◷</span>
                {runway.runwayDays !== null
                  ? `${formatRunway(runway.runwayDays)} runway`
                  : "no recent burn"}
              </p>
            </div>
            <div className="rounded-lg border border-line/60 bg-surface-2/40 px-4 py-2.5 text-right">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-fg-muted">
                Active plan
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-gold-300">
                {planName ?? "Unassigned"}
              </p>
            </div>
          </div>

          {/* Primary account metrics — balance, burn, loyalty accrual, plan economics. */}
          <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-line/50 bg-line/40 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-surface-1/40 p-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-fg-muted">
                30-day burn
              </p>
              <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-fg-primary">
                {formatCredits(spend30d)}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-fg-muted">credits / 30d</p>
            </div>
            <div className="bg-surface-1/40 p-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-fg-muted">
                Loyalty accrual
              </p>
              <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-gold-300">
                +{formatCredits(loyalty)}
                <span className="ml-1 font-mono text-[11px] font-normal text-fg-muted">/mo</span>
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
                {currentPlan
                  ? `${months} mo tenure · caps ${formatCredits(LOYALTY_CAP)}/mo`
                  : `+${LOYALTY_STEP}/mo per month subscribed`}
              </p>
            </div>
            <div className="bg-surface-1/40 p-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-fg-muted">
                Suggested plan
              </p>
              <p className="mt-1.5 font-display text-2xl font-semibold text-fg-primary">
                {recommendedPlan?.name}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-fg-muted">based on recent burn</p>
            </div>
            <div className="bg-surface-1/40 p-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-fg-muted">
                Entry price
              </p>
              <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-fg-primary">
                {recommendedPlan ? formatUsd(recommendedPlan.monthly) : "—"}
                <span className="ml-0.5 font-mono text-[11px] font-normal text-fg-muted">/mo</span>
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
                {recommendedPlan ? `${formatCredits(recommendedPlan.creditsPerMonth)} credits/mo` : "—"}
              </p>
            </div>
          </div>

          {/* Standing + routing guidance. */}
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-line/50 bg-surface-1/30 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-fg-muted">
                Standing
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-semibold text-fg-primary">
                  {TIER_META[profile.tier].label}
                </span>
                {profile.discountPct > 0 && (
                  <span className="rounded-md border border-gold-400/40 bg-gold-400/10 px-2 py-0.5 font-mono text-[10px] text-gold-300">
                    −{profile.discountPct}% on every action
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs leading-5 text-fg-secondary">
                {TIER_META[profile.tier].blurb}
              </p>
            </div>
            <div className="rounded-xl border border-line/50 bg-surface-1/30 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-fg-muted">
                Recommended routing
              </p>
              <p className="mt-2 text-xs leading-5 text-fg-secondary">
                {spend30d > 0 ? (
                  <>
                    Based on {formatCredits(spend30d)} credits used in the last 30 days,{" "}
                    <span className="text-fg-primary">{recommendedPlan?.name}</span> {recommendation.reason}
                  </>
                ) : (
                  <>
                    Most fund managers start on <span className="text-fg-primary">{recommendedPlan?.name}</span>{" "}
                    for balanced monthly capacity.
                  </>
                )}
                {topUpPack ? (
                  <>
                    {" "}
                    Need credits now? The{" "}
                    <span className="text-fg-primary">{formatCredits(topUpPack.credits)}-credit pack</span>{" "}
                    ({formatUsd(topUpPack.price)}) bridges you to next cycle.
                  </>
                ) : null}
              </p>
            </div>
          </div>

          <p className="mt-5 text-xs leading-5 text-fg-muted">
            {planName ? (
              <>
                You&apos;re on <span className="text-fg-secondary">{planName}</span>. Unused credits
                roll over while your plan is active, keeping agent throughput reserved for
                sourcing, diligence, reporting, and ops runs.
              </>
            ) : balance === 0 ? (
              "You're out of credits. Choose a plan or purchase a credit pack below to restore your AI workspace."
            ) : (
              "Choose a plan below to unlock monthly credits, rollover, and a growing loyalty accrual."
            )}
          </p>
        </div>
      </section>

      <h2 className="mb-3 mt-10 font-mono text-xs uppercase tracking-[0.24em] text-gold-400/70">
        Plan compute tiers
      </h2>
      <PlanSelector
        plans={plans}
        currentPlan={currentPlan}
        recommendedKey={recommendedKey}
        live={live}
        publishableKey={publishableKey}
      />

      <h2 className="mb-3 mt-8 font-mono text-xs uppercase tracking-[0.24em] text-gold-400/70">
        One-off credit packs
      </h2>
      <CreditPacks live={live} publishableKey={publishableKey} />

      <h2 className="mb-3 mt-8 font-mono text-xs uppercase tracking-[0.24em] text-gold-400/70">
        Promo code
      </h2>
      <CouponRedemption />

      <Link
        href="/gift"
        className="group relative mt-8 flex items-center gap-3 overflow-hidden rounded-2xl border border-line/60 bg-surface-1/30 p-5 transition hover:border-neural-400/40 hover:bg-surface-1/50"
      >
        <span className="absolute left-0 top-0 h-full w-0.5 rounded-l-2xl bg-neural-400/50 opacity-0 transition group-hover:opacity-100" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-fg-muted">
            Earn credits
          </p>
          <p className="mt-1 text-sm font-medium text-fg-primary">Earn credits instead of buying them</p>
          <p className="mt-0.5 text-xs text-fg-secondary">
            Introduce other firms and build a partner network — escalating rewards three levels
            deep, plus milestone bonuses. Or gift credits to a colleague or portfolio company.
          </p>
        </div>
        <span className="font-mono text-fg-muted transition group-hover:text-neural-300">→</span>
      </Link>

      <h2 className="mb-3 mt-8 font-mono text-xs uppercase tracking-[0.24em] text-gold-400/70">
        Execution rewards
      </h2>
      <GamificationPanel />

      <CreditHistory />

      <TreasuryPanel
        accounts={linkedAccounts}
        transfers={treasuryTransfers}
        publishableKey={publishableKey}
        stripeLive={live}
      />

      {live && currentPlan && (
        <div className="mt-6 flex justify-center">
          <BillingPortalButton />
        </div>
      )}

      <p className="mt-6 text-center text-xs text-fg-muted">
        {live
          ? "Payments are processed securely by Stripe. Plans renew automatically; cancel anytime."
          : "Billing is being configured for this organization. Contact support to activate plans and credit purchases."}
      </p>
    </div>
  );
}
