"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCredits, formatUsd, PLAN_BY_KEY, type PlanKey } from "@/lib/billing";
import {
  daysRemaining,
  formatBillingDate,
  isFinalAttempt,
  nextBillingSummary,
  renewalCredits,
  renewalPrice,
  subscriptionHealth,
  type Subscription,
} from "@/lib/subscriptions";
import { cancelSubscriptionAction, resumeSubscriptionAction } from "./actions";

// The subscription itself, as distinct from the credit balance above it: what
// plan is running, when it next bills, what it will cost, and the two controls
// that were previously only reachable through the payment processor's own portal
// (cancel, and undo that cancellation). Before this panel existed a cancellation
// left the app believing the plan was active forever, because nothing in the
// product ever asked.
export function SubscriptionPanel({
  subscription,
  canManagePayment,
}: {
  subscription: Subscription;
  canManagePayment: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const health = subscriptionHealth(subscription);
  const plan = PLAN_BY_KEY[subscription.plan as PlanKey];
  const pendingPlan = subscription.pending_plan
    ? PLAN_BY_KEY[subscription.pending_plan as PlanKey]
    : null;

  function run(action: () => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res?.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res?.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <section
      className={`fx-neural-panel p-5 sm:p-6 ${
        health === "past_due" ? "border-status-danger/40" : ""
      }`}
    >
      <div className="relative z-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
              Subscription
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 font-display text-2xl font-semibold text-fg-primary">
              {plan?.name ?? subscription.plan}
              <span className="font-mono text-[11px] font-normal uppercase tracking-[0.16em] text-fg-muted">
                {subscription.interval === "annual" ? "billed yearly" : "billed monthly"}
              </span>
            </p>
            <p className="mt-2 text-sm text-fg-secondary">
              {nextBillingSummary(subscription)}
            </p>
          </div>
          <StatusChip health={health} />
        </div>

        {/* What the next bill is, spelled out — the figure operators come here for. */}
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line/50 bg-line/40 text-center sm:grid-cols-3">
          <Figure label="Next charge" value={formatUsd(renewalPrice(subscription))} />
          <Figure
            label="Credits included"
            value={formatCredits(renewalCredits(subscription))}
            accent
          />
          <Figure
            label={subscription.cancel_at_period_end ? "Access until" : "Next billing date"}
            value={formatBillingDate(subscription.current_period_end)}
          />
        </div>

        {health === "past_due" && (
          <p className="mt-4 rounded-xl border border-status-danger/40 bg-status-danger/[0.07] px-4 py-3 text-sm text-status-danger">
            {subscription.last_payment_error ?? "We couldn't collect your last payment."}{" "}
            <span className="text-fg-secondary">
              {/* Every retry date is a real charge attempt, so a card added
                  now still saves the plan — the last attempt is the one worth
                  saying out loud, because after it there is no other. */}
              {isFinalAttempt(subscription)
                ? canManagePayment
                  ? "This is the last attempt before the plan ends — update your payment method now and the retry will go through."
                  : "This is the last attempt before the plan ends."
                : canManagePayment
                  ? "Update your payment method to keep this plan — we'll retry automatically."
                  : "We'll retry automatically."}
            </span>
          </p>
        )}

        {subscription.cancel_at_period_end && (
          <p className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-300">
            This plan ends on {formatBillingDate(subscription.current_period_end)} —{" "}
            {daysRemaining(subscription, new Date())} day(s) of access left. Credits already in
            your balance stay yours.
          </p>
        )}

        {pendingPlan && !subscription.cancel_at_period_end && (
          <p className="mt-4 rounded-xl border border-line/60 bg-surface-2/40 px-4 py-3 text-sm text-fg-secondary">
            Scheduled: switches to <span className="text-fg-primary">{pendingPlan.name}</span> on{" "}
            {formatBillingDate(subscription.current_period_end)}. Choose your current plan again to
            cancel the switch.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {subscription.cancel_at_period_end ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(resumeSubscriptionAction)}
              className="rounded-lg bg-neural-400 px-4 py-2 text-sm font-medium text-white transition hover:bg-neural-300 disabled:opacity-60"
            >
              {pending ? "Resuming…" : "Keep my plan"}
            </button>
          ) : confirming ? (
            // Cancelling is one click too consequential to do without asking.
            <>
              <span className="text-sm text-fg-secondary">
                Cancel at the end of this period?
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(cancelSubscriptionAction)}
                className="rounded-lg border border-status-danger/50 px-3 py-1.5 text-sm text-status-danger transition hover:bg-status-danger/10 disabled:opacity-60"
              >
                {pending ? "Cancelling…" : "Yes, cancel"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-fg-muted transition hover:text-fg-primary"
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-line/60 px-3 py-1.5 text-sm text-fg-secondary transition hover:border-status-danger/40 hover:text-status-danger"
            >
              Cancel subscription
            </button>
          )}
        </div>

        {error ? <p className="mt-3 text-xs text-status-danger">{error}</p> : null}
      </div>
    </section>
  );
}

function StatusChip({ health }: { health: ReturnType<typeof subscriptionHealth> }) {
  const map = {
    active: { label: "Active", cls: "border-status-success/40 bg-status-success/10 text-status-success" },
    ending: { label: "Ending", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
    past_due: { label: "Payment due", cls: "border-status-danger/40 bg-status-danger/10 text-status-danger" },
    none: { label: "Inactive", cls: "border-line/60 bg-surface-2/40 text-fg-muted" },
  } as const;
  const { label, cls } = map[health];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-surface-1/40 px-4 py-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">{label}</p>
      <p
        className={`mt-1.5 font-display text-lg font-semibold tabular-nums ${
          accent ? "text-gold-300" : "text-fg-primary"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
