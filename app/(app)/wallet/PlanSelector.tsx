"use client";

import { useState, useTransition } from "react";
import { formatCredits, formatUsd, type Plan, type PlanInterval } from "@/lib/billing";
import { StripeCheckoutModal } from "@/components/StripeCheckoutModal";
import { selectPlanAction } from "./actions";

export interface PlanView extends Plan {
  annualSavingsUsd: number;
  annualSavingsPct: number;
}

function ComputeLayerGraphic({ featured = false }: { featured?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 180 82"
      className="h-20 w-full text-neural-400"
      fill="none"
    >
      <path
        d="M10 58H42L57 40H94L109 23H151"
        stroke="currentColor"
        strokeOpacity={featured ? 0.65 : 0.35}
        strokeWidth="1.5"
      />
      <path
        d="M18 28H54L68 45H112L126 61H166"
        stroke="currentColor"
        strokeOpacity={featured ? 0.42 : 0.24}
      />
      <path
        d="M24 68H78M102 15H152M68 15H88"
        stroke="currentColor"
        strokeOpacity="0.22"
      />
      {[42, 57, 94, 109, 151, 54, 112, 126].map((x, i) => (
        <circle
          key={`${x}-${i}`}
          cx={x}
          cy={[58, 40, 40, 23, 23, 28, 45, 61][i]}
          r={featured ? 3.5 : 2.8}
          className={featured ? "drop-shadow-[0_0_8px_rgba(118,185,0,0.95)]" : ""}
          fill="currentColor"
          fillOpacity={featured ? 0.95 : 0.55}
        />
      ))}
      <rect
        x="8"
        y="8"
        width="164"
        height="66"
        rx="14"
        stroke="currentColor"
        strokeOpacity={featured ? 0.28 : 0.14}
      />
    </svg>
  );
}

// The plans grid with a monthly/annual toggle. Annual surfaces the two-months-
// free saving; the recommended plan and the current plan are badged. Choosing a
// plan opens an in-app embedded Stripe Checkout (or mock-activates when Stripe
// isn't configured).
export function PlanSelector({
  plans,
  currentPlan,
  recommendedKey,
  live = false,
  publishableKey = "",
}: {
  plans: PlanView[];
  currentPlan: string | null;
  recommendedKey: string | null;
  live?: boolean;
  publishableKey?: string;
}) {
  const [interval, setInterval] = useState<PlanInterval>("annual");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(planKey: string) {
    setError(null);
    setPendingKey(planKey);
    const fd = new FormData();
    fd.set("plan_key", planKey);
    fd.set("interval", interval);
    startTransition(async () => {
      const res = await selectPlanAction(fd);
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
      {/* Billing interval toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-neural-400/25 bg-black/70 p-0.5 shadow-[inset_0_1px_0_rgba(199,255,107,0.08)]">
          {(["monthly", "annual"] as PlanInterval[]).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setInterval(opt)}
              aria-pressed={interval === opt}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
                interval === opt
                  ? "bg-neural-400 text-black shadow-[0_0_18px_rgba(118,185,0,0.35)]"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        <span className="rounded-full border border-neural-400/35 bg-neural-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-neural-300">
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
              data-active={isCurrent || isRecommended ? "true" : undefined}
              className={`fx-neural-card group flex flex-col p-5 ${
                isRecommended ? "border-neural-400/60 shadow-[0_18px_60px_-34px_rgba(118,185,0,0.95)]" : ""
              }`}
            >
              {(isCurrent || isRecommended) && (
                <span
                  className={`absolute -top-2 right-4 z-10 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] ${
                    isCurrent
                      ? "border border-status-success/40 bg-status-success/10 text-status-success"
                      : "border border-neural-400/50 bg-black text-neural-300 shadow-[0_0_18px_rgba(118,185,0,0.35)]"
                  }`}
                >
                  {isCurrent ? "Current plan" : "Recommended"}
                </span>
              )}

              <div className="relative z-10">
                <div className="mb-4 rounded-xl border border-neural-400/10 bg-neural-400/[0.035] p-2">
                  <ComputeLayerGraphic featured={p.key === "pro"} />
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-neural-300">
                  {p.key} tier
                </p>
                <p className="mt-1 font-display text-xl font-semibold text-fg-primary">{p.name}</p>
                <p className="mt-1 text-xs leading-5 text-fg-secondary">{p.blurb}</p>
              </div>

              <p className="relative z-10 mt-4 font-display text-3xl font-semibold text-fg-primary">
                {formatUsd(price)}
                <span className="text-sm font-normal text-fg-muted">
                  /{interval === "annual" ? "yr" : "mo"}
                </span>
              </p>
              <p className="relative z-10 font-mono text-[11px] text-fg-muted">
                {formatCredits(credits)} credits / {interval === "annual" ? "yr" : "mo"}
                {interval === "annual" && p.annualSavingsUsd > 0
                  ? ` · save ${formatUsd(p.annualSavingsUsd)} (${p.annualSavingsPct}%)`
                  : ""}
              </p>

              <ul className="relative z-10 mt-4 flex flex-1 flex-col gap-2 text-xs text-fg-secondary">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <span className="text-neural-400">→</span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                disabled={busy || isCurrent}
                onClick={() => choose(p.key)}
                aria-busy={busy}
                className={`relative z-10 mt-5 overflow-hidden rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${
                  isCurrent
                    ? "border border-neural-400/20 text-fg-muted"
                    : "bg-neural-400 text-black shadow-[0_0_22px_rgba(118,185,0,0.28)] hover:bg-neural-300"
                }`}
              >
                {isCurrent ? "Active" : busy ? "Activating…" : `Choose ${p.name}`}
                {busy ? <span className="fx-data-stream" aria-hidden /> : null}
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
