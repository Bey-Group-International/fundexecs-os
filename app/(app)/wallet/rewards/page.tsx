import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";
import { compoundingProfile } from "@/lib/compounding";
import {
  PLAN_BY_KEY,
  formatCredits,
  loyaltyBonus,
  tenureMonths,
  LOYALTY_STEP,
  LOYALTY_CAP,
} from "@/lib/billing";
import { GamificationPanel } from "../GamificationPanel";
import { TIER_META } from "../standing";

export const dynamic = "force-dynamic";

// Standing & rewards — the single home for the three progression mechanics that
// used to be scattered across the wallet: reputation standing (compounding tier
// + per-action discount), loyalty accrual (billing tenure), and execution
// rewards (streaks, ranks, milestones, hub achievements). The wallet itself now
// carries only a slim standing summary that links here.
export default async function WalletRewardsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const [wallet, profile] = await Promise.all([
    getWallet(ctx.orgId),
    compoundingProfile(ctx.orgId),
  ]);

  const currentPlan = wallet?.plan ?? null;
  const months = currentPlan ? tenureMonths(wallet?.plan_started_at) : 0;
  const loyalty = loyaltyBonus(months);
  const planName = currentPlan ? PLAN_BY_KEY[currentPlan as keyof typeof PLAN_BY_KEY]?.name : null;
  const standing = TIER_META[profile.tier];

  return (
    <div className="fx-neural-ambient mx-auto max-w-5xl">
      <header className="mb-6 flex flex-col gap-4 border-b border-line/50 pb-6">
        <div>
          <Link
            href="/wallet"
            className="font-mono text-[11px] uppercase tracking-[0.28em] text-fg-muted transition hover:text-gold-300"
          >
            ← Wallet
          </Link>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary sm:text-4xl">
            Standing &amp; rewards
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-secondary">
            How your standing, tenure, and execution combine to lower the cost of every
            AI action and earn credits back.
          </p>
        </div>
      </header>

      {/* Standing + loyalty — the two rate-setting mechanics, side by side. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line/60 bg-surface-1/30 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-fg-muted">
            Standing
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-display text-xl font-semibold text-fg-primary">
              {standing.label}
            </span>
            {profile.discountPct > 0 && (
              <span className="rounded-md border border-gold-400/40 bg-gold-400/10 px-2 py-0.5 font-mono text-[10px] text-gold-300">
                −{profile.discountPct}% on every action
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-5 text-fg-secondary">{standing.blurb}</p>
        </div>

        <div className="rounded-2xl border border-line/60 bg-surface-1/30 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-fg-muted">
            Loyalty accrual
          </p>
          <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-gold-300">
            +{formatCredits(loyalty)}
            <span className="ml-1 text-sm font-normal text-fg-muted">/mo</span>
          </p>
          <p className="mt-2 text-xs leading-5 text-fg-secondary">
            {currentPlan
              ? `${months} month${months === 1 ? "" : "s"} on ${planName ?? "plan"}. Grows +${LOYALTY_STEP} credits each month, up to ${formatCredits(LOYALTY_CAP)}/mo.`
              : `Stay subscribed and earn +${LOYALTY_STEP} bonus credits per month of tenure, up to ${formatCredits(LOYALTY_CAP)}/mo.`}
          </p>
        </div>
      </div>

      {/* Execution rewards — streaks, ranks, milestones, hub achievements. */}
      <h2 className="mb-4 mt-10 font-mono text-xs uppercase tracking-[0.24em] text-gold-400/70">
        Execution rewards
      </h2>
      <GamificationPanel />

      {/* Earn more — referral / gift flywheel, moved off the wallet. */}
      <Link
        href="/gift"
        className="group relative mt-10 flex items-center gap-3 overflow-hidden rounded-2xl border border-line/60 bg-surface-1/30 p-5 transition hover:border-neural-400/40 hover:bg-surface-1/50"
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
    </div>
  );
}
