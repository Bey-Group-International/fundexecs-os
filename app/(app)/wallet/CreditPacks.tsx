"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { CREDIT_PACKS, formatCredits, formatUsd, type PurchaseSummary } from "@/lib/billing";
import { purchasePackAction } from "./actions";
// Checkout UI is only ever needed after a click, so it loads on demand — this
// keeps Stripe.js and @stripe/react-stripe-js out of the Wallet route's initial
// JS for the (common) visit that never opens checkout.
const StripeCheckoutModal = dynamic(
  () => import("@/components/StripeCheckoutModal").then((m) => m.StripeCheckoutModal),
  { ssr: false },
);
const NativeCheckoutModal = dynamic(
  () => import("./NativeCheckoutModal").then((m) => m.NativeCheckoutModal),
  { ssr: false },
);

// One-off credit packs (no subscription). With Stripe configured, buying opens
// an in-app embedded Stripe Checkout; otherwise a native in-app checkout grants
// the credits directly and records the transaction.
export function CreditPacks({
  live = false,
  publishableKey = "",
  recommendedKey = null,
}: {
  live?: boolean;
  publishableKey?: string;
  /** Pack sized to bridge the balance to ~a month of burn (see wallet-insights). */
  recommendedKey?: string | null;
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [native, setNative] = useState<PurchaseSummary | null>(null);
  const [pending, startTransition] = useTransition();

  function buy(packKey: string) {
    setError(null);
    setPendingKey(packKey);
    const fd = new FormData();
    fd.set("pack_key", packKey);
    startTransition(async () => {
      const res = await purchasePackAction(fd);
      if (res?.clientSecret) {
        setClientSecret(res.clientSecret); // open in-app embedded (Stripe) checkout
      } else if (res?.native) {
        setNative(res.native); // open native in-app checkout (no Stripe configured)
      } else if (res?.error) {
        setError(res.error);
      }
      setPendingKey(null);
    });
  }

  return (
    <div>
      {clientSecret ? (
        <StripeCheckoutModal
          clientSecret={clientSecret}
          publishableKey={publishableKey}
          onClose={() => setClientSecret(null)}
        />
      ) : null}
      {native ? (
        <NativeCheckoutModal summary={native} onClose={() => setNative(null)} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {CREDIT_PACKS.map((pack) => {
          const busy = pending && pendingKey === pack.key;
          const isRecommended = recommendedKey === pack.key;
          return (
            <div
              key={pack.key}
              data-active={isRecommended ? "true" : undefined}
              className={`fx-neural-card group flex items-center justify-between gap-3 p-4 ${
                isRecommended
                  ? "border-neural-400/60 shadow-[0_18px_60px_-34px_rgb(var(--fx-accent-rgb)/0.378)]"
                  : ""
              }`}
            >
              <div className="relative z-10">
                <p className="font-display text-lg font-semibold text-fg-primary">
                  {formatCredits(pack.credits)}
                </p>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-neural-300">
                  burst credits
                </p>
                {/* In-flow rather than an absolute badge: fx-neural-card is
                    overflow-hidden, which would clip a pill hung off the top. */}
                {isRecommended && (
                  <span className="mt-1.5 inline-block rounded-full border border-neural-400/50 bg-neural-400/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.16em] text-neural-300">
                    Recommended
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => buy(pack.key)}
                aria-busy={busy}
                className="relative z-10 overflow-hidden rounded-lg border border-neural-400/25 px-3 py-1.5 text-sm text-fg-secondary transition hover:border-neural-400/50 hover:bg-neural-400/10 hover:text-fg-primary disabled:opacity-60"
              >
                {busy ? "Adding…" : formatUsd(pack.price)}
                {busy ? <span className="fx-data-stream" aria-hidden /> : null}
              </button>
            </div>
          );
        })}
      </div>
      {error ? <p className="mt-3 text-xs text-status-danger">{error}</p> : null}
      <p className="mt-3 text-xs text-fg-muted">
        {live
          ? "Secure one-time checkout by Stripe. Credits land in your wallet as soon as payment completes."
          : "Stripe isn’t configured here — no card is charged. Buying a pack adds its credits in-app instantly and records the purchase to your credit history."}
      </p>
    </div>
  );
}
