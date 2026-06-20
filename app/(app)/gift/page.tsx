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
import { stripeConfigured } from "@/lib/stripe";
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
    { label: "Total downline", value: formatCredits(summary.totalDownline) },
    { label: "Wallet balance", value: formatCredits(balance) },
  ];

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Gift Earn
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Grow your downline
        </h1>
        <p className="mt-2 max-w-prose text-sm text-fg-secondary">
          Invite other firms to FundExecs. You earn escalating credits on every org you bring in —
          and keep earning when they invite others, up to three levels deep. It compounds.
        </p>
      </header>

      <CheckoutBanner status={searchParams.checkout} />

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="fx-card p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
              {s.label}
            </p>
            <p
              className={`mt-1 font-display text-2xl font-semibold ${
                s.accent ? "text-gold-400" : "text-fg-primary"
              }`}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Rank + progress */}
      <div className="fx-glass mt-2 flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Rank</p>
          <p className="mt-0.5 font-display text-xl font-semibold text-gold-300">{rank}</p>
        </div>
        <div className="min-w-[200px] flex-1">
          <div className="mb-1 flex items-center justify-between text-[11px] text-fg-muted">
            <span>{next ? `Next: ${next.rank}` : "Top rank reached"}</span>
            {next ? (
              <span>
                {summary.directCount}/{next.count} referrals · +{formatCredits(next.bonus)} bonus
              </span>
            ) : null}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-gold-400 transition-all"
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
            <ReferralLink code={code} />
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
                  <span className="text-fg-primary">Downline overrides.</span> Earn{" "}
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
              Your downline
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Everyone you’ve brought in, and everyone they’ve brought in.
            </p>
          </div>
          {summary.downline.length === 0 ? (
            <p className="fx-card border-dashed p-6 text-center text-sm text-fg-muted">
              No referrals yet. Share your link above to start your downline.
            </p>
          ) : (
            <div className="fx-card divide-y divide-line">
              {summary.downline.map((row) => (
                <div key={row.orgId} className="flex items-center gap-3 p-3">
                  <span
                    className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                      row.level === 1
                        ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
                        : "border-line bg-surface-0 text-fg-muted"
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
            <GiftForm live={live} />
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
