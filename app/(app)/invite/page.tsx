import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getWalletBalance } from "@/lib/wallet";
import { formatCredits } from "@/lib/billing";
import { getOrCreateReferralCode, getReferralSummary } from "@/lib/gift-earn";
import {
  DIRECT_TIERS,
  LEVEL_OVERRIDES,
  MILESTONES,
  REFERRAL_WELCOME_BONUS,
  rankFor,
} from "@/lib/referrals";
import { ReferralLink } from "./ReferralLink";

export const dynamic = "force-dynamic";

const LEVEL_LABEL: Record<number, string> = { 1: "Direct", 2: "2nd level", 3: "3rd level" };

// The referral program lives on its own page: the invite link, what the org has
// earned from it, and the network it has built. Gifting credits is a separate
// flow and stays on /gift.
export default async function InvitePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const [code, summary, balance] = await Promise.all([
    getOrCreateReferralCode(ctx.orgId, ctx.userId),
    getReferralSummary(ctx.orgId),
    getWalletBalance(ctx.orgId),
  ]);

  const { rank, next, progress } = rankFor(summary.directCount);

  const stats = [
    { label: "Referral credits earned", value: formatCredits(summary.earnedTotal), accent: true },
    { label: "Direct referrals", value: String(summary.directCount) },
    { label: "Total network", value: String(summary.totalDownline) },
    { label: "Wallet balance", value: formatCredits(balance) },
  ];

  return (
    <div className="fx-neural-ambient mx-auto max-w-5xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-neural-300">
            Invite &amp; Earn
          </span>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary sm:text-4xl">
            Partner network
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-secondary">
            Introduce other firms to FundExecs and earn escalating credits — compounding three
            levels deep with milestone bonuses as your network scales.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-gold-400/35 bg-gold-400/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_14px_rgb(var(--fx-gold-rgb)/0.9)]" />
          Reward flywheel active
        </div>
      </header>

      {/* KPI stat strip inside neural panel */}
      <section className="fx-neural-panel p-5 sm:p-6">
        <div className="relative z-10">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-neural-400/15 bg-neural-400/10 sm:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className={`flex flex-col gap-1.5 bg-surface-0 px-5 py-4 ${
                  s.accent ? "border-t-2 border-t-gold-400/70" : "border-t-2 border-t-transparent"
                }`}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                  {s.label}
                </p>
                <p
                  className={`font-display text-3xl font-semibold tracking-tight ${
                    s.accent
                      ? "text-gold-300 drop-shadow-[0_0_20px_rgb(var(--fx-gold-rgb)/0.45)]"
                      : "text-fg-primary"
                  }`}
                >
                  {s.accent && (
                    <span className="mr-1 text-gold-300 drop-shadow-[0_0_14px_rgb(var(--fx-gold-rgb)/0.6)]">
                      ◇
                    </span>
                  )}
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          {/* Rank + progress */}
          <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-gold-400/20 bg-gold-400/[0.05] px-5 py-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                Current rank
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-gold-300 drop-shadow-[0_0_14px_rgb(var(--fx-gold-rgb)/0.4)]">
                {rank}
              </p>
            </div>
            <div className="min-w-[220px] flex-1">
              <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                <span>{next ? `Next: ${next.rank}` : "Top rank reached"}</span>
                {next && (
                  <span>
                    {summary.directCount}/{next.count} firms · +{formatCredits(next.bonus)} bonus
                  </span>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3/60">
                <div
                  className="h-full rounded-full bg-gold-400 shadow-[0_0_10px_rgb(var(--fx-gold-rgb)/0.7)] transition-all duration-700"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: invite link + how it works */}
        <section className="flex flex-col gap-4">
          {/* Invite link */}
          <div className="fx-neural-card p-5">
            <div className="absolute left-0 top-0 h-full w-1 rounded-l-2xl bg-gold-400/70 shadow-[0_0_18px_rgb(var(--fx-gold-rgb)/0.7)]" />
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300/80">
              Your invite link
            </p>
            <p className="mb-4 mt-1 text-sm text-fg-secondary">
              Share with another firm. They get{" "}
              <span className="text-fg-primary">{formatCredits(REFERRAL_WELCOME_BONUS)} credits</span>{" "}
              to start — your rewards begin immediately.
            </p>
            {code ? (
              <ReferralLink code={code} />
            ) : (
              <p className="text-sm text-fg-muted">
                Your invite link is being set up — check back in a moment.
              </p>
            )}
          </div>

          {/* How rewards compound */}
          <div className="rounded-2xl border border-neural-400/20 bg-surface-0/85 p-5 shadow-[0_1px_2px_rgb(15_23_42/0.10)]">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-neural-300">
              How rewards compound
            </p>
            <ul className="mt-4 flex flex-col gap-4">
              <li className="flex gap-3">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold-400/40 bg-gold-400/10 font-mono text-[11px] text-gold-300">
                  1
                </div>
                <div className="text-sm">
                  <p className="font-medium text-fg-primary">Escalating direct rewards</p>
                  <p className="mt-0.5 text-fg-secondary">
                    Each org you refer pays more than the last —{" "}
                    {DIRECT_TIERS.filter((t) => Number.isFinite(t.upTo))
                      .map((t) => formatCredits(t.reward))
                      .join(" → ")}{" "}
                    → {formatCredits(DIRECT_TIERS[DIRECT_TIERS.length - 1].reward)} credits.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-neural-400/40 bg-neural-400/10 font-mono text-[11px] text-neural-300">
                  2
                </div>
                <div className="text-sm">
                  <p className="font-medium text-fg-primary">Network overrides</p>
                  <p className="mt-0.5 text-fg-secondary">
                    Earn {formatCredits(LEVEL_OVERRIDES[2])} when your referrals refer someone, and{" "}
                    {formatCredits(LEVEL_OVERRIDES[3])} a level deeper.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold-400/40 bg-gold-400/10 font-mono text-[11px] text-gold-300">
                  3
                </div>
                <div className="text-sm">
                  <p className="font-medium text-fg-primary">Milestone bonuses</p>
                  <p className="mt-0.5 text-fg-secondary">
                    {MILESTONES.map((m) => `${m.count} firms → +${formatCredits(m.bonus)}`).join(" · ")}.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </section>

        {/* Right: network */}
        <section className="flex flex-col gap-4">
          <div>
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-gold-300/70">
              Your network
            </p>
            {summary.downline.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line/60 bg-surface-1/30 px-6 py-10 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gold-400/25 bg-gold-400/[0.06]">
                  <span className="text-xl text-gold-300/60">◇</span>
                </div>
                <p className="text-sm text-fg-secondary">No introductions yet.</p>
                <p className="text-xs text-fg-muted">
                  Share your invite link to start your partner network.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-neural-400/20 bg-surface-0/85 shadow-[0_1px_2px_rgb(15_23_42/0.10)]">
                <div className="flex items-center justify-between border-b border-neural-400/15 px-4 py-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-neural-300">
                    {summary.totalDownline} firm{summary.totalDownline !== 1 ? "s" : ""} in network
                  </p>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                    {summary.directCount} direct
                  </p>
                </div>
                <div className="divide-y divide-neural-400/10">
                  {summary.downline.map((row) => (
                    <div key={row.orgId} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-1/40">
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
                          row.level === 1
                            ? "border-gold-400/50 bg-gold-400/10 text-gold-300 shadow-[0_0_8px_rgb(var(--fx-gold-rgb)/0.25)]"
                            : row.level === 2
                            ? "border-neural-400/40 bg-neural-400/10 text-neural-300"
                            : "border-line/60 bg-surface-2/40 text-fg-muted"
                        }`}
                      >
                        {LEVEL_LABEL[row.level] ?? `L${row.level}`}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                        {row.name}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
                          row.status === "subscribed"
                            ? "bg-status-success/15 text-status-success"
                            : row.status === "joined"
                            ? "bg-neural-400/10 text-neural-300"
                            : "bg-surface-2/40 text-fg-muted"
                        }`}
                      >
                        {row.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </section>
      </div>
    </div>
  );
}
