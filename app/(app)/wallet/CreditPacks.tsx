"use client";

import { useState, useTransition } from "react";
import { CREDIT_PACKS, formatCredits, formatUsd } from "@/lib/billing";
import { StripeCheckoutModal } from "@/components/StripeCheckoutModal";
import { purchasePackAction } from "./actions";

// One-off credit packs (no subscription). With Stripe configured, buying opens
// an in-app embedded Checkout; otherwise it mock-grants the pack's credits so
// the flow is real end-to-end.
export function CreditPacks({
  live = false,
  publishableKey = "",
}: {
  live?: boolean;
  publishableKey?: string;
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function buy(packKey: string) {
    setError(null);
    setPendingKey(packKey);
    const fd = new FormData();
    fd.set("pack_key", packKey);
    startTransition(async () => {
      const res = await purchasePackAction(fd);
      if (res?.clientSecret) {
        setClientSecret(res.clientSecret); // open in-app embedded checkout
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
      <div className="grid gap-3 sm:grid-cols-3">
        {CREDIT_PACKS.map((pack) => {
          const busy = pending && pendingKey === pack.key;
          return (
            <div key={pack.key} className="fx-neural-card group flex items-center justify-between gap-3 p-4">
              <div className="relative z-10">
                <p className="font-display text-lg font-semibold text-fg-primary">
                  {formatCredits(pack.credits)}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-neural-300">
                  burst credits
                </p>
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
          : "Stripe isn’t configured here — packs are granted in mock mode (no charge)."}
      </p>
    </div>
  );
}
