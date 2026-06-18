import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getWalletBalance } from "@/lib/wallet";
import { PLANS, CREDIT_PACKS, formatUsd, formatCredits } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function WalletPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const balance = await getWalletBalance(ctx.orgId);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">Wallet</span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Credits & plans
        </h1>
      </header>

      <div className="rounded-xl border border-line bg-surface-1 p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Balance</p>
        <p className="mt-1 font-display text-4xl font-semibold text-fg-primary">
          <span className="text-gold-400">◇</span> {formatCredits(balance)}
          <span className="ml-2 text-base font-normal text-fg-muted">credits</span>
        </p>
        {balance === 0 ? (
          <p className="mt-2 text-sm text-fg-secondary">
            You&rsquo;re out of credits. Choose a plan or buy a pack below to keep the agents
            working.
          </p>
        ) : null}
      </div>

      <h2 className="mb-3 mt-8 font-mono text-xs uppercase tracking-wider text-fg-muted">Plans</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.key} className="flex flex-col rounded-xl border border-line bg-surface-1 p-5">
            <p className="font-display text-lg font-semibold text-fg-primary">{p.name}</p>
            <p className="mt-0.5 text-xs text-fg-secondary">{p.blurb}</p>
            <p className="mt-3 font-display text-2xl font-semibold text-fg-primary">
              {formatUsd(p.monthly)}
              <span className="text-sm font-normal text-fg-muted">/mo</span>
            </p>
            <p className="font-mono text-[11px] text-fg-muted">
              or {formatUsd(p.annual)}/yr · {formatCredits(p.creditsPerMonth)} credits/mo
            </p>
            <ul className="mt-3 flex flex-1 flex-col gap-1.5 text-xs text-fg-secondary">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <span className="text-gold-400">→</span>
                  {f}
                </li>
              ))}
            </ul>
            <button
              title="Checkout coming soon"
              className="mt-4 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300"
            >
              Choose {p.name}
            </button>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 font-mono text-xs uppercase tracking-wider text-fg-muted">
        One-off credit packs
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {CREDIT_PACKS.map((pack) => (
          <div
            key={pack.key}
            className="flex items-center justify-between rounded-xl border border-line bg-surface-1 p-4"
          >
            <div>
              <p className="font-display text-lg font-semibold text-fg-primary">
                {formatCredits(pack.credits)}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">credits</p>
            </div>
            <button
              title="Checkout coming soon"
              className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
            >
              {formatUsd(pack.price)}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-fg-muted">
        Checkout isn&rsquo;t wired yet — connect a payment provider to enable purchases.
      </p>
    </div>
  );
}
