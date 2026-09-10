import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { getWalletBalance } from "@/lib/wallet";
import { formatCredits } from "@/lib/billing";
import { getSentGifts } from "@/lib/gift-earn";
import { stripeConfigured, stripePublishableKeyValue } from "@/lib/stripe";
import { CheckoutBanner } from "../wallet/CheckoutBanner";
import { GiftForm } from "./GiftForm";
import { RedeemBox } from "./RedeemBox";
import { CopyText } from "./CopyText";

export const dynamic = "force-dynamic";

// Gifting only: buy a credit pack for someone else, see what you've sent, and
// redeem a code you were given. The referral program — invite link, rewards and
// network — lives on its own page at /invite.
export default async function GiftPage(
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

  const [gifts, balance] = await Promise.all([
    getSentGifts(ctx.orgId),
    getWalletBalance(ctx.orgId),
  ]);

  return (
    <div className="fx-neural-ambient mx-auto max-w-5xl">
      {/* Page header — mirrors wallet page structure */}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-neural-300">
            Gifting
          </span>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary sm:text-4xl">
            Gift credits
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-secondary">
            Buy a credit pack for a colleague or portfolio company — they redeem it into their own
            wallet. Got a code yourself? Apply it below.
          </p>
        </div>
        <div className="inline-flex w-fit flex-col items-end gap-0.5 rounded-xl border border-gold-400/25 bg-gold-400/[0.06] px-4 py-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
            Wallet balance
          </span>
          <span className="font-display text-2xl font-semibold tracking-tight text-gold-300 drop-shadow-[0_0_14px_rgb(var(--fx-gold-rgb)/0.4)]">
            <span className="mr-1">◇</span>
            {formatCredits(balance)}
          </span>
        </div>
      </header>

      <CheckoutBanner status={searchParams.checkout} />

      {/* Pointer to the referral program, which now has its own page */}
      <Link
        href="/invite"
        className="group mb-6 flex items-center justify-between gap-3 rounded-2xl border border-gold-400/25 bg-gold-400/[0.05] px-5 py-4 transition hover:border-gold-400/50"
      >
        <div>
          <p className="text-sm font-medium text-fg-primary">Earn credits by inviting firms</p>
          <p className="mt-0.5 text-xs text-fg-secondary">
            Your invite link, rewards and partner network moved to their own page.
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs text-gold-300 transition group-hover:translate-x-0.5">
          →
        </span>
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: send a gift */}
        <section className="flex flex-col gap-4">
          <div className="fx-neural-card p-5">
            <div className="absolute left-0 top-0 h-full w-1 rounded-l-2xl bg-neural-400/60 shadow-[0_0_18px_rgb(var(--fx-accent-rgb)/0.6)]" />
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300/80">
              Send a credit pack
            </p>
            <p className="mb-4 mt-1 text-sm text-fg-secondary">
              Buy credits for a colleague or portfolio company — they redeem into their own wallet.
            </p>
            <GiftForm live={live} publishableKey={publishableKey} />
          </div>

          {/* Redeem */}
          <div className="rounded-2xl border border-line/80 bg-gradient-to-b from-surface-1 to-surface-1/40 p-5 shadow-[0_1px_2px_rgb(15_23_42/0.10)]">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-neural-300">
              Redeem a code
            </p>
            <p className="mb-4 mt-1 text-sm text-fg-secondary">
              Got a referral code or a gift? Apply it here.
            </p>
            <RedeemBox />
          </div>
        </section>

        {/* Right: sent gifts */}
        <section className="flex flex-col gap-4">
          <p className="mb-0 font-mono text-xs uppercase tracking-[0.16em] text-gold-300/70">
            Gifts you&apos;ve sent
          </p>
          {gifts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line/60 bg-surface-1/30 px-6 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gold-400/25 bg-gold-400/[0.06]">
                <span className="text-xl text-gold-300/60">◇</span>
              </div>
              <p className="text-sm text-fg-secondary">No gifts sent yet.</p>
              <p className="text-xs text-fg-muted">
                Credit packs you send will appear here with their redemption status.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line/80 bg-gradient-to-b from-surface-1 to-surface-1/40 shadow-[0_1px_2px_rgb(15_23_42/0.10)]">
              <div className="divide-y divide-line/60">
                {gifts.map((g) => (
                  <div key={g.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg-primary">
                        <span className="text-gold-300">{formatCredits(g.credits)} cr</span>
                        {" → "}
                        {g.recipient_email}
                      </p>
                      <p
                        className={`mt-0.5 font-mono text-[11px] uppercase tracking-wider ${
                          g.status === "redeemed" ? "text-status-success" : "text-fg-muted"
                        }`}
                      >
                        {g.status}
                      </p>
                    </div>
                    {g.status === "pending" && (
                      <CopyText value={g.redeem_token} label="Copy gift code" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
