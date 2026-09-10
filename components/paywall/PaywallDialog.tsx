"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PLANS, PLAN_BY_KEY, formatCredits, formatUsd, type PlanInterval, type PlanKey } from "@/lib/billing";
import type { PaywallPayload } from "@/lib/paywall";
import { commitToPlanAction } from "@/app/(app)/wallet/paywall-actions";

/**
 * The credit wall, rendered where the action was blocked.
 *
 * Deliberately not a page and not a redirect: an operator who hits this is in
 * the middle of something, and sending them to /wallet to pay means losing that
 * context and finding their way back. Choosing a plan here unlocks in place and
 * hands control straight back — `onUnlocked` is what lets the caller retry the
 * very action that was refused.
 */
export function PaywallDialog({
  paywall,
  onUnlocked,
  onDismiss,
}: {
  paywall: PaywallPayload;
  /** Called once credits are available — retry the blocked action here. */
  onUnlocked: (balance: number) => void;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const [interval, setInterval] = useState<PlanInterval>("monthly");
  const [choice, setChoice] = useState<PlanKey>(paywall.recommendedPlan ?? "pro");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    credits: number;
    invoice?: string;
    collecting?: boolean;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function commit() {
    setError(null);
    const fd = new FormData();
    fd.set("plan_key", choice);
    fd.set("interval", interval);
    startTransition(async () => {
      const res = await commitToPlanAction(fd);
      if (res?.ok) {
        setDone({
          credits: res.credits ?? 0,
          invoice: res.invoiceNumber,
          collecting: res.collecting,
        });
        router.refresh();
        // Straight back to what they were doing.
        onUnlocked(res.balance ?? 0);
      } else {
        setError(res?.error ?? "Could not start your plan.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Credits needed"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface-1 p-6 shadow-2xl">
        {done ? (
          <div className="text-center">
            <p className="font-display text-xl font-semibold text-fg-primary">
              You&apos;re back in.
            </p>
            <p className="mt-2 text-sm text-fg-secondary">
              {formatCredits(done.credits)} credits added.
              {done.invoice ? (
                done.collecting ? (
                  // The debit is already in flight, so "nothing to do" is
                  // literally true rather than a way of saying "later".
                  <> Invoice {done.invoice} is being collected from your linked account.</>
                ) : (
                  <> Invoice {done.invoice} is on its way — normal terms.</>
                )
              ) : null}
            </p>
            {done.invoice && !done.collecting ? (
              // Encouraged, never required: the plan already started. Linking is
              // what turns every future invoice into something that settles
              // itself instead of something someone has to remember to send.
              <p className="mt-2 text-xs text-fg-muted">
                <Link href="/wallet" className="text-neural-300 underline hover:text-neural-200">
                  Link a bank account
                </Link>{" "}
                and invoices collect themselves — no transfers to remember.
              </p>
            ) : null}
            <button
              type="button"
              onClick={onDismiss}
              className="mt-5 rounded-lg bg-neural-400 px-4 py-2 text-sm font-medium text-white transition hover:bg-neural-300"
            >
              Continue
            </button>
          </div>
        ) : (
          <>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300/70">
              Credits needed
            </p>
            <p className="mt-2 font-display text-xl font-semibold text-fg-primary">
              {paywall.required} credits to continue — you have {paywall.balance}.
            </p>

            {paywall.canUnlockOnCommitment ? (
              <>
                <p className="mt-2 text-sm text-fg-secondary">
                  Start a plan and keep going. Credits are available immediately; we invoice you
                  on normal terms.
                </p>

                <div className="mt-4 inline-flex rounded-xl border border-neural-400/25 bg-surface-0 p-0.5">
                  {(["monthly", "annual"] as PlanInterval[]).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setInterval(opt)}
                      aria-pressed={interval === opt}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
                        interval === opt
                          ? "bg-neural-400 text-white"
                          : "text-fg-secondary hover:text-fg-primary"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>

                <div className="mt-3 grid gap-2">
                  {PLANS.map((p) => {
                    const selected = choice === p.key;
                    const recommended = paywall.recommendedPlan === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setChoice(p.key)}
                        aria-pressed={selected}
                        className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                          selected
                            ? "border-neural-400/60 bg-neural-400/[0.06]"
                            : "border-line/60 hover:border-neural-400/40"
                        }`}
                      >
                        <span>
                          <span className="text-sm font-medium text-fg-primary">{p.name}</span>
                          {recommended ? (
                            <span className="ml-2 rounded-md border border-neural-400/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-neural-300">
                              Fits your usage
                            </span>
                          ) : null}
                          <span className="mt-0.5 block font-mono text-[11px] text-fg-muted">
                            {formatCredits(
                              interval === "annual" ? p.creditsPerMonth * 12 : p.creditsPerMonth,
                            )}{" "}
                            credits
                          </span>
                        </span>
                        <span className="font-display text-lg font-semibold text-fg-primary">
                          {formatUsd(interval === "annual" ? p.annual : p.monthly)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={commit}
                    className="rounded-lg bg-neural-400 px-4 py-2 text-sm font-medium text-white transition hover:bg-neural-300 disabled:opacity-60"
                  >
                    {pending
                      ? "Starting…"
                      : `Start ${PLAN_BY_KEY[choice]?.name ?? ""} and continue`}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={onDismiss}
                    className="text-sm text-fg-muted transition hover:text-fg-primary"
                  >
                    Not now
                  </button>
                </div>
              </>
            ) : (
              // No credit extended: an existing plan-holder topping up, or an
              // account with an unpaid period behind it.
              <>
                <p className="mt-2 text-sm text-fg-secondary">{paywall.message}</p>
                <div className="mt-5 flex items-center gap-3">
                  <a
                    href="/wallet"
                    className="rounded-lg bg-neural-400 px-4 py-2 text-sm font-medium text-white transition hover:bg-neural-300"
                  >
                    Open Wallet
                  </a>
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="text-sm text-fg-muted transition hover:text-fg-primary"
                  >
                    Not now
                  </button>
                </div>
              </>
            )}

            {error ? <p className="mt-3 text-xs text-status-danger">{error}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
