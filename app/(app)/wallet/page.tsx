import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";
import { recentSpend } from "@/lib/credits";
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
import { PlanSelector, type PlanView } from "./PlanSelector";
import { CreditPacks } from "./CreditPacks";
import { CheckoutBanner } from "./CheckoutBanner";
import { CreditHistory } from "./CreditHistory";

export const dynamic = "force-dynamic";

// Recommend the cheapest plan whose monthly credit allotment covers the org's
// recent 30-day spend (with headroom). With no usage history yet, suggest Pro as
// the balanced default.
function recommendPlan(spend30d: number): string {
  if (spend30d <= 0) return "pro";
  const need = spend30d * 1.2;
  const fit = PLANS.find((p) => p.creditsPerMonth >= need);
  return fit?.key ?? PLANS[PLANS.length - 1].key;
}

// How each reputation tier presents on the Wallet "Standing" card.
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

export default async function WalletPage({
  searchParams,
}: {
  searchParams: { checkout?: string };
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const live = stripeConfigured();
  // Publishable key is client-safe; passed to the embedded checkout so Stripe.js
  // can mount the in-app form without exposing it via NEXT_PUBLIC_.
  const publishableKey = stripePublishableKeyValue();

  const [wallet, spend30d, profile] = await Promise.all([
    getWallet(ctx.orgId),
    recentSpend(ctx.orgId),
    compoundingProfile(ctx.orgId),
  ]);

  const balance = wallet?.credits ?? 0;
  const currentPlan = wallet?.plan ?? null;
  const recommendedKey = recommendPlan(spend30d);

  // Loyalty tenure runs from when the current plan was last set (wallet.updated_at).
  const months = currentPlan ? tenureMonths(wallet?.updated_at) : 0;
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
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.32em] text-neural-300">
            FundExecs wallet core
          </span>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary sm:text-4xl">
            Credits & plans
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-secondary">
            A high-control credit console for keeping the operating agents funded,
            routed, and ready for institutional workflows.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-neural-400/35 bg-neural-400/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.24em] text-neural-300">
          <span className="h-1.5 w-1.5 rounded-full bg-neural-400 shadow-[0_0_14px_rgba(118,185,0,0.9)]" />
          Compute credit ledger online
        </div>
      </header>

      <CheckoutBanner status={searchParams.checkout} />

      {/* Balance + loyalty */}
      <section className="fx-neural-panel p-5 sm:p-6">
        <div className="relative z-10 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
          <div className="rounded-2xl border border-neural-400/20 bg-black/45 p-5 shadow-[inset_0_1px_0_rgba(199,255,107,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-neural-300">
                  Available balance
                </p>
                <p className="mt-2 font-display text-5xl font-semibold tracking-tight text-fg-primary">
                  <span className="text-neural-400 drop-shadow-[0_0_18px_rgba(118,185,0,0.45)]">
                    ◇
                  </span>{" "}
                  {formatCredits(balance)}
                </p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
                  live compute credits
                </p>
              </div>
              <div className="rounded-xl border border-neural-400/25 bg-neural-400/[0.07] px-3 py-2 text-right">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-neural-300">
                  Active tier
                </p>
                <p className="mt-1 font-display text-lg font-semibold text-fg-primary">
                  {planName ?? "Unassigned"}
                </p>
              </div>
            </div>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-fg-secondary">
              {planName ? (
                <>
                  You're on <span className="text-fg-primary">{planName}</span>. Unused credits
                  roll over while your plan is active, keeping agent throughput reserved for
                  sourcing, diligence, reporting, and ops runs.
                </>
              ) : balance === 0 ? (
                "You're out of credits. Choose a plan or purchase a credit pack below to restore your AI workspace."
              ) : (
                "Choose a plan below to unlock monthly credits, rollover, and a growing loyalty bonus."
              )}
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-line/40 bg-surface-2/30 p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-fg-muted">
                  30d burn
                </p>
                <p className="mt-1 font-display text-xl font-semibold text-fg-primary">
                  {formatCredits(spend30d)}
                </p>
              </div>
              <div className="rounded-xl border border-line/40 bg-surface-2/30 p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-fg-muted">
                  Suggested
                </p>
                <p className="mt-1 font-display text-xl font-semibold text-neural-300">
                  {recommendedPlan?.name}
                </p>
              </div>
              <div className="rounded-xl border border-line/40 bg-surface-2/30 p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-fg-muted">
                  Entry price
                </p>
                <p className="mt-1 font-display text-xl font-semibold text-fg-primary">
                  {recommendedPlan ? formatUsd(recommendedPlan.monthly) : "—"}
                  <span className="text-xs font-normal text-fg-muted">/mo</span>
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-2xl border border-neural-400/20 bg-black/45 p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-neural-300">
                Loyalty accelerator
              </p>
              <p className="mt-2 font-display text-3xl font-semibold text-fg-primary">
                +{formatCredits(loyalty)}
                <span className="ml-1 text-sm font-normal text-fg-muted">/mo</span>
              </p>
              <p className="mt-3 text-xs leading-5 text-fg-secondary">
                {currentPlan
                  ? `${months} month${months === 1 ? "" : "s"} on plan. Grows +${LOYALTY_STEP} credits each month, up to ${formatCredits(LOYALTY_CAP)}/mo.`
                  : `Stay subscribed and earn +${LOYALTY_STEP} bonus credits per month of tenure, up to ${formatCredits(LOYALTY_CAP)}/mo.`}
              </p>
            </div>

            <div className="rounded-2xl border border-neural-400/20 bg-neural-400/[0.06] p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-neural-300">
                Recommended routing
              </p>
              <p className="mt-2 text-sm leading-6 text-fg-secondary">
                {spend30d > 0 ? (
                  <>
                    Based on {formatCredits(spend30d)} credits used in the last 30 days,{" "}
                    <span className="text-fg-primary">{recommendedPlan?.name}</span> fits
                    current operating load.
                  </>
                ) : (
                  <>
                    Most fund managers start on <span className="text-fg-primary">{recommendedPlan?.name}</span>{" "}
                    for balanced monthly capacity.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Standing — the compounding profile, made visible. Reputation earned from
          closed deals and verified records discounts every action and lifts a
          firm's listings in the marketplace. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-neural-400/20 bg-black/45 px-4 py-3 text-sm">
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-neural-300">
          Standing
        </span>
        <span className="text-fg-primary">{TIER_META[profile.tier].label}</span>
        {profile.discountPct > 0 && (
          <span className="rounded-full border border-neural-400/40 bg-neural-400/10 px-2 py-0.5 font-mono text-[11px] text-neural-300">
            −{profile.discountPct}% on every action
          </span>
        )}
        <span className="text-fg-secondary">{TIER_META[profile.tier].blurb}</span>
      </div>

      <h2 className="mb-3 mt-8 font-mono text-xs uppercase tracking-[0.24em] text-neural-300">
        Plan compute tiers
      </h2>
      <PlanSelector
        plans={plans}
        currentPlan={currentPlan}
        recommendedKey={recommendedKey}
        live={live}
        publishableKey={publishableKey}
      />

      <h2 className="mb-3 mt-8 font-mono text-xs uppercase tracking-[0.24em] text-neural-300">
        One-off credit packs
      </h2>
      <CreditPacks live={live} publishableKey={publishableKey} />

      {/* Gift Earn cross-sell */}
      <Link
        href="/gift"
        className="fx-neural-card group mt-8 flex items-center gap-3 p-5"
      >
        <div className="absolute left-0 top-0 h-full w-1 bg-neural-400/60 opacity-0 shadow-[0_0_18px_rgba(118,185,0,0.8)] transition group-hover:opacity-100" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-neural-300">
            Earn credit flywheel
          </p>
          <p className="mt-1 text-sm font-medium text-fg-primary">Earn credits instead of buying them</p>
          <p className="mt-0.5 text-xs text-fg-secondary">
            Introduce other firms and build a partner network — escalating rewards three levels
            deep, plus milestone bonuses. Or gift credits to a colleague or portfolio company.
          </p>
        </div>
        <span className="font-mono text-fg-muted transition group-hover:text-neural-300">→</span>
      </Link>

      {/* Transaction history — ledger entries newest-first */}
      <CreditHistory />

      <p className="mt-6 text-center text-xs text-fg-muted">
        {live
          ? "Payments are processed securely by Stripe. Plans renew automatically; cancel anytime."
          : "Stripe isn't configured in this environment — choices activate in mock mode (no charge). Set STRIPE_SECRET_KEY to enable real checkout."}
      </p>
    </div>
  );
}
