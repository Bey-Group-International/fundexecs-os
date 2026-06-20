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
import { PlanSelector, type PlanView } from "./PlanSelector";
import { CreditPacks } from "./CreditPacks";

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

export default async function WalletPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const [wallet, spend30d] = await Promise.all([
    getWallet(ctx.orgId),
    recentSpend(ctx.orgId),
  ]);

  const balance = wallet?.credits ?? 0;
  const currentPlan = wallet?.plan ?? null;
  const recommendedKey = recommendPlan(spend30d);

  // Loyalty tenure runs from when the current plan was last set (wallet.updated_at).
  const months = currentPlan ? tenureMonths(wallet?.updated_at) : 0;
  const loyalty = loyaltyBonus(months);
  const planName = currentPlan ? PLAN_BY_KEY[currentPlan as keyof typeof PLAN_BY_KEY]?.name : null;

  const plans: PlanView[] = PLANS.map((p) => ({
    ...p,
    annualSavingsUsd: annualSavingsUsd(p),
    annualSavingsPct: annualSavingsPct(p),
  }));

  return (
    <div className="fx-ambient mx-auto max-w-4xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Wallet
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Credits & plans
        </h1>
      </header>

      {/* Balance + loyalty */}
      <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr]">
        <div className="fx-card p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Balance</p>
          <p className="mt-1 font-display text-4xl font-semibold text-fg-primary">
            <span className="text-gold-400">◇</span> {formatCredits(balance)}
            <span className="ml-2 text-base font-normal text-fg-muted">credits</span>
          </p>
          <p className="mt-2 text-sm text-fg-secondary">
            {planName ? (
              <>
                You’re on <span className="text-fg-primary">{planName}</span>. Unused credits roll
                over while your plan is active.
              </>
            ) : balance === 0 ? (
              "You’re out of credits. Choose a plan or buy a pack below to keep the agents working."
            ) : (
              "Choose a plan below to get monthly credits — and unlock rollover and a growing loyalty bonus."
            )}
          </p>
        </div>

        <div className="fx-glass p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400/80">
            Loyalty bonus
          </p>
          <p className="mt-1 font-display text-2xl font-semibold text-fg-primary">
            +{formatCredits(loyalty)}
            <span className="ml-1 text-sm font-normal text-fg-muted">/mo</span>
          </p>
          <p className="mt-1 text-xs leading-snug text-fg-secondary">
            {currentPlan
              ? `${months} month${months === 1 ? "" : "s"} on plan. Grows +${LOYALTY_STEP} credits each month, up to ${formatCredits(LOYALTY_CAP)}/mo.`
              : `Stay subscribed and earn +${LOYALTY_STEP} bonus credits per month of tenure, up to ${formatCredits(LOYALTY_CAP)}/mo.`}
          </p>
        </div>
      </div>

      {/* Recommendation */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-gold-500/30 bg-gold-500/[0.06] px-4 py-3 text-sm">
        <span className="font-mono text-[10px] uppercase tracking-wider text-gold-300">
          Recommended
        </span>
        <span className="text-fg-secondary">
          {spend30d > 0 ? (
            <>
              Based on {formatCredits(spend30d)} credits used in the last 30 days,{" "}
              <span className="text-fg-primary">
                {PLAN_BY_KEY[recommendedKey as keyof typeof PLAN_BY_KEY]?.name}
              </span>{" "}
              fits your usage best.
            </>
          ) : (
            <>
              Most teams start on{" "}
              <span className="text-fg-primary">
                {PLAN_BY_KEY[recommendedKey as keyof typeof PLAN_BY_KEY]?.name}
              </span>{" "}
              — a balanced amount of monthly credits.
            </>
          )}
        </span>
      </div>

      <h2 className="mb-3 mt-8 font-mono text-xs uppercase tracking-wider text-fg-muted">Plans</h2>
      <PlanSelector plans={plans} currentPlan={currentPlan} recommendedKey={recommendedKey} />

      <h2 className="mb-3 mt-8 font-mono text-xs uppercase tracking-wider text-fg-muted">
        One-off credit packs
      </h2>
      <CreditPacks />

      {/* Gift Earn cross-sell */}
      <Link
        href="/gift"
        className="fx-card fx-card-hover group mt-8 flex items-center gap-3 p-5"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg-primary">Earn credits instead of buying them</p>
          <p className="mt-0.5 text-xs text-fg-secondary">
            Invite other firms and build a downline — escalating rewards three levels deep, plus
            milestone bonuses. Or gift credits to a colleague.
          </p>
        </div>
        <span className="font-mono text-fg-muted transition group-hover:text-gold-400">→</span>
      </Link>

      <p className="mt-6 text-center text-xs text-fg-muted">
        Checkout isn’t wired yet — choices activate in mock mode (no charge) so the value flow is
        visible. Connect a payment provider to enable real purchases.
      </p>
    </div>
  );
}
