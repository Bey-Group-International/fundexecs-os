"use client";

import { useState } from "react";
import { computeWaterfall, allocateToHolders } from "@/lib/waterfall";
import { compactUsd, usd } from "@/lib/format";

interface HolderShare {
  name: string;
  ownershipPct: number;
}

function NumField({
  label,
  value,
  onChange,
  suffix,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-fg-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step={step ?? "any"}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-md border border-line bg-surface-0 px-3 py-2 font-mono text-fg-primary outline-none focus:border-gold-500"
        />
        {suffix ? <span className="font-mono text-xs text-fg-muted">{suffix}</span> : null}
      </div>
    </label>
  );
}

// Interactive waterfall scenario. Pure math runs client-side so the operator can
// dial the distribution and terms and watch the split — and the per-LP
// allocation — update live.
export default function WaterfallCalculator({
  paidIn: initialPaidIn,
  holders,
  defaultDistribution,
}: {
  paidIn: number;
  holders: HolderShare[];
  defaultDistribution: number;
}) {
  const [distribution, setDistribution] = useState(Math.round(defaultDistribution));
  const [paidIn, setPaidIn] = useState(Math.round(initialPaidIn));
  const [prefRate, setPrefRate] = useState(8);
  const [carry, setCarry] = useState(20);
  const [catchUp, setCatchUp] = useState(100);

  const result = computeWaterfall(distribution, paidIn, {
    prefRate: prefRate / 100,
    carry: carry / 100,
    catchUp: catchUp / 100,
  });
  const allocation = allocateToHolders(result.totalToLps, holders).filter((a) => a.ownershipPct > 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Inputs */}
      <div className="grid gap-4 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <NumField label="Distribution" value={distribution} onChange={setDistribution} suffix="$" />
        <NumField label="Paid-in capital" value={paidIn} onChange={setPaidIn} suffix="$" />
        <NumField label="Pref rate" value={prefRate} onChange={setPrefRate} suffix="%" />
        <NumField label="Carry" value={carry} onChange={setCarry} suffix="%" />
        <NumField label="GP catch-up" value={catchUp} onChange={setCatchUp} suffix="%" />
      </div>

      {/* Split summary */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-line bg-surface-2/40 px-3.5 py-3">
          <span className="font-display text-lg font-semibold text-emerald-300">{usd(result.totalToLps)}</span>
          <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            to LPs · {result.lpPct}%
          </span>
        </div>
        <div className="rounded-xl border border-line bg-surface-2/40 px-3.5 py-3">
          <span className="font-display text-lg font-semibold text-gold-300">{usd(result.totalToGp)}</span>
          <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            to GP · {result.gpPct}%
          </span>
        </div>
      </div>

      {/* Tiers */}
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-line bg-surface-2/80 px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          <span>Tier</span>
          <span className="text-right">To LPs</span>
          <span className="text-right">To GP</span>
        </div>
        {result.tiers.map((t) => (
          <div
            key={t.key}
            className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-line/50 bg-surface-1 px-4 py-2.5 text-sm last:border-0"
          >
            <span className="text-fg-secondary">{t.label}</span>
            <span className="text-right font-mono text-emerald-300/90">{t.toLps > 0 ? usd(t.toLps) : "—"}</span>
            <span className="text-right font-mono text-gold-300/90">{t.toGp > 0 ? usd(t.toGp) : "—"}</span>
          </div>
        ))}
      </div>

      {/* Per-LP allocation */}
      {allocation.length > 0 ? (
        <div>
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
            LP allocation · by ownership
          </h3>
          <div className="overflow-hidden rounded-xl border border-line">
            {allocation.map((a, i) => (
              <div
                key={a.name}
                className={`flex items-center justify-between gap-3 bg-surface-1 px-4 py-2.5 text-sm ${i > 0 ? "border-t border-line/50" : ""}`}
              >
                <span className="min-w-0 truncate text-fg-primary">{a.name}</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-fg-muted">{a.ownershipPct}%</span>
                  <span className="font-mono text-emerald-300">{compactUsd(a.amount)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 px-4 py-4 text-center text-sm text-fg-muted">
          Add commitments to the cap table to see the per-LP allocation.
        </p>
      )}
    </div>
  );
}
