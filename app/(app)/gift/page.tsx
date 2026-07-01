import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getWalletBalance } from "@/lib/wallet";
import { formatCredits } from "@/lib/billing";
import {
  getOrCreateReferralCode,
  getReferralSummary,
  getSentGifts,
} from "@/lib/gift-earn";
import {
  DIRECT_TIERS,
  LEVEL_OVERRIDES,
  MILESTONES,
  REFERRAL_WELCOME_BONUS,
  rankFor,
} from "@/lib/referrals";
import { stripeConfigured, stripePublishableKeyValue } from "@/lib/stripe";
import { CheckoutBanner } from "../wallet/CheckoutBanner";
import { ReferralLink } from "./ReferralLink";
import { GiftForm } from "./GiftForm";
import { RedeemBox } from "./RedeemBox";
import { CopyText } from "./CopyText";

export const dynamic = "force-dynamic";

const LEVEL_LABEL: Record<number, string> = { 1: "Direct", 2: "2nd level", 3: "3rd level" };

export default async function GiftEarnPage({
  searchParams,
}: {
  searchParams: { checkout?: string };
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const live = stripeConfigured();
  const publishableKey = stripePublishableKeyValue();

  const [code, summary, gifts, balance] = await Promise.all([
    getOrCreateReferralCode(ctx.orgId, ctx.userId),
    getReferralSummary(ctx.orgId),
    getSentGifts(ctx.orgId),
    getWalletBalance(ctx.orgId),
  ]);

  const { rank, next, progress } = rankFor(summary.directCount);

  const stats = [
    { label: "Referral credits earned", value: formatCredits(summary.earnedTotal), accent: true },
    { label: "Direct referrals", value: formatCredits(summary.directCount) },
    { label: "Total network", value: formatCredits(summary.totalDownline) },
    { label: "Wallet balance", value: formatCredits(balance) },
  ];

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Network & Gifting
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Build your partner network
        </h1>
        <p className="mt-2 max-w-prose text-sm text-fg-secondary">
          Introduce other firms to FundExecs. You earn escalating credits on every firm you bring
          in — and keep earning when they introduce others, up to three levels deep. Rewards
          accrue and compound as your network grows.
        </p>
      </header>

      <CheckoutBanner status={searchParams.checkout} />

      {/* KPI stat strip — institutional tile row */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line/70 bg-line/70 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`flex flex-col gap-1 bg-surface-1 px-5 py-4 ${
              s.accent ? "border-t-2 border-t-gold-400/70" : "border-t-2 border-t-transparent"
            }`}
          >
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-fg-muted">
              {s.label}
            </p>
            <p
              className={`font-display text-3xl font-semibold tracking-tight ${
                s.accent
                  ? "text-gold-300 drop-shadow-[0_0_16px_rgb(var(--fx-gold-rgb)/0.35)]"
                  : "text-fg-primary"
              }`}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Rank + progress */}
      <div className="mt-2 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-gold-400/20 bg-gold-400/[0.04] px-5 py-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-fg-muted">Current rank</p>
          <p className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-gold-300">{rank}</p>
        </div>
        <div className="min-w-[200px] flex-1">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            <span>{next ? `Next: ${next.rank}` : "Top rank reached"}</span>
            {next ? (
              <span>
                {summary.directCount}/{next.count} firms · +{formatCredits(next.bonus)} bonus
              </span>
            ) : null}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-gold-400 shadow-[0_0_8px_rgb(var(--fx-gold-rgb)/0.6)] transition-all duration-500"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
        {/* Left: invite + how it works */}
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">
              Your invite link
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Share this with another firm. When they redeem it, they get{" "}
              {formatCredits(REFERRAL_WELCOME_BONUS)} credits to start — and your rewards begin.
            </p>
          </div>
          <div className="fx-card p-4">
            {code ? (
              <ReferralLink code={code} />
            ) : (
              <p className="text-sm text-fg-muted">
                Your invite link is being set up — check back in a moment.
              </p>
            )}
          </div>

          <div className="fx-card p-5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400/80">
              How rewards compound
            </p>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-fg-secondary">
              <li className="flex items-start gap-2">
                <span className="text-gold-400">→</span>
                <span>
                  <span className="text-fg-primary">Escalating direct rewards.</span> Each org you
                  refer pays more than the last —{" "}
                  {DIRECT_TIERS.filter((t) => Number.isFinite(t.upTo))
                    .map((t) => formatCredits(t.reward))
                    .join(" → ")}{" "}
                  → {formatCredits(DIRECT_TIERS[DIRECT_TIERS.length - 1].reward)} credits.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gold-400">→</span>
                <span>
                  <span className="text-fg-primary">Network overrides.</span> Earn{" "}
                  {formatCredits(LEVEL_OVERRIDES[2])} when your referrals refer someone, and{" "}
                  {formatCredits(LEVEL_OVERRIDES[3])} a level deeper.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gold-400">→</span>
                <span>
                  <span className="text-fg-primary">Milestone bonuses.</span>{" "}
                  {MILESTONES.map((m) => `${m.count}→+${formatCredits(m.bonus)}`).join(" · ")}.
                </span>
              </li>
            </ul>
          </div>

          <div className="fx-card p-5">
            <h3 className="text-sm font-medium text-fg-primary">Redeem</h3>
            <p className="mb-3 mt-0.5 text-xs text-fg-secondary">
              Got a referral code or a gift? Apply it here.
            </p>
            <RedeemBox />
          </div>
        </section>

        {/* Right: downline + gifting */}
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">
              Your network
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Every firm you’ve brought in, and everyone they’ve brought in.
            </p>
          </div>
          {summary.downline.length === 0 ? (
            <p className="fx-card border-dashed p-6 text-center text-sm text-fg-muted">
              No introductions yet. Share your link above to start your network.
            </p>
          ) : (
            <div className="fx-card divide-y divide-line">
              {summary.downline.map((row) => (
                <div key={row.orgId} className="flex items-center gap-3 p-3">
                  <span
                    className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                      row.level === 1
                        ? "border-gold-400/50 bg-gold-400/10 text-gold-300 shadow-[0_0_8px_rgb(var(--fx-gold-rgb)/0.2)]"
                        : "border-line/60 bg-surface-2/40 text-fg-muted"
                    }`}
                  >
                    {LEVEL_LABEL[row.level] ?? `L${row.level}`}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                    {row.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {row.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2">
            <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">
              Gift credits
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Buy a pack of credits for a colleague or portfolio company. They redeem it into their
              own wallet.
            </p>
          </div>
          <div className="fx-card p-5">
            <GiftForm live={live} publishableKey={publishableKey} />
          </div>

          {gifts.length > 0 ? (
            <div className="fx-card p-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
                Gifts you’ve sent
              </p>
              <div className="flex flex-col divide-y divide-line">
                {gifts.map((g) => (
                  <div key={g.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg-primary">
                        {formatCredits(g.credits)} credits → {g.recipient_email}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        {g.status}
                      </p>
                    </div>
                    {g.status === "pending" ? (
                      <CopyText value={g.redeem_token} label="Copy gift code" />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
