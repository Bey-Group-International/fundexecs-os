"use client";

import { useState, useTransition } from "react";
import { formatCredits, formatUsd, type Plan, type PlanInterval } from "@/lib/billing";
import { selectPlanAction } from "./actions";

export interface PlanView extends Plan {
  annualSavingsUsd: number;
  annualSavingsPct: number;
}

// The plans grid with a monthly/annual toggle. Annual surfaces the two-months-
// free saving; the recommended plan and the current plan are badged. Choosing a
// plan activates it (payment mocked) so the badges reflect a live choice.
export function PlanSelector({
  plans,
  currentPlan,
  recommendedKey,
  live = false,
}: {
  plans: PlanView[];
  currentPlan: string | null;
  recommendedKey: string | null;
  live?: boolean;
}) {
  const [interval, setInterval] = useState<PlanInterval>("annual");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(planKey: string) {
    setError(null);
    setPendingKey(planKey);
    const fd = new FormData();
    fd.set("plan_key", planKey);
    fd.set("interval", interval);
    startTransition(async () => {
      const res = await selectPlanAction(fd);
      if (res?.url) {
        window.location.href = res.url; // off to Stripe Checkout
        return;
      }
      if (res?.error) setError(res.error);
      setPendingKey(null);
    });
  }

  return (
    <div>
      {/* Billing interval toggle */}
      <div className="mb-4 flex items-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface-1 p-0.5">
          {(["monthly", "annual"] as PlanInterval[]).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setInterval(opt)}
              aria-pressed={interval === opt}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                interval === opt
                  ? "bg-gold-400 text-surface-0"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold-300">
          Annual = 2 months free
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = currentPlan === p.key;
          const isRecommended = recommendedKey === p.key && !isCurrent;
          const price = interval === "annual" ? p.annual : p.monthly;
          const credits = interval === "annual" ? p.creditsPerMonth * 12 : p.creditsPerMonth;
          const busy = pending && pendingKey === p.key;

          return (
            <div
              key={p.key}
              className={`fx-card relative flex flex-col p-5 ${
                isRecommended ? "border-gold-500/50" : ""
              }`}
            >
              {(isCurrent || isRecommended) && (
                <span
                  className={`absolute -top-2 right-4 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                    isCurrent
                      ? "border border-status-success/40 bg-status-success/10 text-status-success"
                      : "border border-gold-500/40 bg-gold-500/10 text-gold-300"
                  }`}
                >
                  {isCurrent ? "Current plan" : "Recommended"}
                </span>
              )}

              <p className="font-display text-lg font-semibold text-fg-primary">{p.name}</p>
              <p className="mt-0.5 text-xs text-fg-secondary">{p.blurb}</p>

              <p className="mt-3 font-display text-2xl font-semibold text-fg-primary">
                {formatUsd(price)}
                <span className="text-sm font-normal text-fg-muted">
                  /{interval === "annual" ? "yr" : "mo"}
                </span>
              </p>
              <p className="font-mono text-[11px] text-fg-muted">
                {formatCredits(credits)} credits / {interval === "annual" ? "yr" : "mo"}
                {interval === "annual" && p.annualSavingsUsd > 0
                  ? ` · save ${formatUsd(p.annualSavingsUsd)} (${p.annualSavingsPct}%)`
                  : ""}
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
                type="button"
                disabled={busy || isCurrent}
                onClick={() => choose(p.key)}
                className={`mt-4 rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${
                  isCurrent
                    ? "border border-line text-fg-muted"
                    : "bg-gold-400 text-surface-0 hover:bg-gold-300"
                }`}
              >
                {isCurrent ? "Active" : busy ? "Activating…" : `Choose ${p.name}`}
              </button>
            </div>
          );
        })}
      </div>

      {error ? <p className="mt-3 text-xs text-status-danger">{error}</p> : null}
      <p className="mt-3 text-xs text-fg-muted">
        {live
          ? "Secure checkout by Stripe. Your plan activates and credits are granted the moment payment completes. Unused credits roll over while your plan is active."
          : "Stripe isn’t configured here — no card is charged. Choosing a plan activates it and front-loads its credits so you can see the value flow. Unused credits roll over while your plan is active."}
      </p>
    </div>
  );
}
