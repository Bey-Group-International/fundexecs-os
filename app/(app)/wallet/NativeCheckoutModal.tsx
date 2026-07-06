"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCredits, formatUsd, type PurchaseSummary } from "@/lib/billing";
import { confirmNativePurchaseAction } from "./actions";

// Native (Stripe-free) in-app checkout. Shown when no external processor is
// configured: it summarizes exactly what the purchase grants, then completes it
// server-side (activate plan / add credits) and refreshes the Wallet so the new
// balance/plan appear immediately. The same visual shell as StripeCheckoutModal.
export function NativeCheckoutModal({
  summary,
  onClose,
}: {
  summary: PurchaseSummary;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [grantedCredits, setGrantedCredits] = useState<number | null>(null);

  function confirm() {
    setError(null);
    const fd = new FormData();
    fd.set("kind", summary.kind);
    if (summary.planKey) fd.set("plan_key", summary.planKey);
    if (summary.interval) fd.set("interval", summary.interval);
    if (summary.packKey) fd.set("pack_key", summary.packKey);
    startTransition(async () => {
      const res = await confirmNativePurchaseAction(fd);
      if (res?.ok) {
        setGrantedCredits(res.credits ?? summary.credits);
        router.refresh(); // update wallet balance/plan behind the modal
      } else {
        setError(res?.error ?? "Could not complete the purchase.");
      }
    });
  }

  const done = grantedCredits !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative my-8 w-full max-w-md rounded-2xl border border-line bg-surface-1 p-2 shadow-2xl">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
            In-app checkout
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checkout"
            className="rounded-md px-2 py-1 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
          >
            ✕
          </button>
        </div>

        <div className="px-4 pb-4 pt-2">
          {done ? (
            <div className="text-center">
              <p className="font-display text-2xl font-semibold text-status-success">Purchase complete</p>
              <p className="mt-2 text-sm text-fg-secondary">
                {formatCredits(grantedCredits ?? 0)} credits added
                {summary.kind === "plan" ? " and your plan is active." : "."}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 w-full rounded-lg border border-neural-400/30 bg-neural-400/10 px-4 py-2.5 text-sm font-medium text-fg-primary transition hover:bg-neural-400/20"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-fg-secondary">You&apos;re about to get</p>
              <p className="mt-1 font-display text-xl font-semibold text-fg-primary">{summary.label}</p>

              <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-surface-0 px-4 py-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-muted">Credits</p>
                  <p className="mt-0.5 font-display text-lg font-semibold text-gold-300">
                    {formatCredits(summary.credits)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-muted">Price</p>
                  <p className="mt-0.5 font-display text-lg font-semibold text-fg-primary">
                    {formatUsd(summary.priceUsd)}
                    {summary.kind === "plan" ? (
                      <span className="text-xs font-normal text-fg-muted">
                        /{summary.interval === "annual" ? "yr" : "mo"}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                aria-busy={pending}
                className="mt-4 w-full rounded-lg bg-neural-400 px-4 py-2.5 text-sm font-semibold text-black shadow-[0_0_22px_rgba(118,185,0,0.28)] transition hover:bg-neural-300 disabled:opacity-60"
              >
                {pending ? "Completing…" : "Complete purchase"}
              </button>

              {error ? <p className="mt-3 text-center text-xs text-status-danger">{error}</p> : null}
              <p className="mt-3 text-center text-[11px] text-fg-muted">
                Stripe isn&apos;t configured here, so no card is charged — this activates your
                purchase in-app and records it to your credit history.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
