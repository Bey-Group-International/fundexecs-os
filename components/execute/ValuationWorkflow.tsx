"use client";

import React from "react";

export interface ValuationRecord {
  id: string;
  assetName: string;
  methodology: "dcf" | "market_comp" | "cost" | "nav" | "409a";
  currentMark: number;
  priorMark: number | null;
  markDate: string;
  boardApproved: boolean;
  nextReviewDate: string | null;
  changePercent: number | null;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(n);
}

const METHODOLOGY_STYLES: Record<ValuationRecord["methodology"], { label: string; cls: string }> = {
  dcf:         { label: "DCF",         cls: "bg-blue-900/40 text-blue-300 border-blue-700/40" },
  market_comp: { label: "Market Comp", cls: "bg-purple-900/40 text-purple-300 border-purple-700/40" },
  cost:        { label: "Cost",        cls: "bg-amber-900/40 text-amber-300 border-amber-700/40" },
  nav:         { label: "NAV",         cls: "bg-teal-900/40 text-teal-300 border-teal-700/40" },
  "409a":      { label: "409A",        cls: "bg-rose-900/40 text-rose-300 border-rose-700/40" },
};

function daysUntil(dateStr: string): number {
  const now = new Date();
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function MarkDeltaBar({ prior, current }: { prior: number; current: number }) {
  const max = Math.max(prior, current);
  const priorPct = (prior / max) * 100;
  const currentPct = (current / max) * 100;
  const up = current >= prior;
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-2">
        <span className="text-fg-muted text-xs w-12 shrink-0">Prior</span>
        <div className="flex-1 h-1.5 bg-surface-0 rounded-full overflow-hidden border border-line">
          <div className="h-full bg-fg-muted/40 rounded-full" style={{ width: `${priorPct}%` }} />
        </div>
        <span className="text-fg-muted font-mono text-xs w-16 text-right">{fmt(prior)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-fg-muted text-xs w-12 shrink-0">Current</span>
        <div className="flex-1 h-1.5 bg-surface-0 rounded-full overflow-hidden border border-line">
          <div className={`h-full rounded-full ${up ? "bg-emerald-300" : "bg-status-danger"}`} style={{ width: `${currentPct}%` }} />
        </div>
        <span className={`font-mono text-xs w-16 text-right ${up ? "text-emerald-300" : "text-status-danger"}`}>{fmt(current)}</span>
      </div>
    </div>
  );
}

function ValuationCard({ v }: { v: ValuationRecord }) {
  const meth = METHODOLOGY_STYLES[v.methodology];
  const up = v.changePercent !== null && v.changePercent >= 0;
  const reviewSoon = v.nextReviewDate !== null && daysUntil(v.nextReviewDate) <= 90;

  return (
    <div className="bg-surface-1 rounded-2xl p-5 flex flex-col gap-4 border border-line">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-fg-primary font-display font-semibold text-base leading-tight">{v.assetName}</span>
          <span className={`inline-flex items-center self-start px-2 py-0.5 rounded-lg text-xs font-mono border ${meth.cls}`}>
            {meth.label}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-fg-primary font-mono text-2xl font-semibold leading-none">{fmt(v.currentMark)}</span>
          {v.changePercent !== null && (
            <span className={`font-mono text-sm font-medium ${up ? "text-emerald-300" : "text-status-danger"}`}>
              {up ? "▲" : "▼"} {Math.abs(v.changePercent).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {v.priorMark !== null && (
        <MarkDeltaBar prior={v.priorMark} current={v.currentMark} />
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-fg-muted">Mark date: <span className="text-fg-secondary font-mono">{v.markDate}</span></span>
        {v.boardApproved && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-900/30 text-emerald-300 border border-emerald-700/30 font-mono">
            ✓ Board Approved
          </span>
        )}
      </div>

      {v.nextReviewDate && (
        <div className={`flex items-center gap-2 rounded-xl px-3 py-2 border text-xs ${reviewSoon ? "bg-amber-900/20 border-amber-700/30 text-amber-300" : "bg-surface-0 border-line text-fg-muted"}`}>
          {reviewSoon && <span>⚠</span>}
          <span>Next review: <span className="font-mono">{v.nextReviewDate}</span>{reviewSoon && <span className="ml-1 font-medium">— due soon</span>}</span>
        </div>
      )}
    </div>
  );
}

export function ValuationWorkflow({ valuations }: { valuations: ValuationRecord[] }) {
  return (
    <div className="bg-surface-0 rounded-2xl p-6 flex flex-col gap-6 border border-line">
      <div className="flex flex-col gap-1">
        <h2 className="text-fg-primary font-display font-semibold text-xl">Valuation Workflow</h2>
        <p className="text-fg-muted text-sm">ForgeGlobal-style 409A methodology tracking and mark history.</p>
      </div>
      {valuations.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-fg-muted text-sm border border-line rounded-2xl bg-surface-1">
          No valuation records found.
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {valuations.map((v) => (
            <ValuationCard key={v.id} v={v} />
          ))}
        </div>
      )}
    </div>
  );
}
