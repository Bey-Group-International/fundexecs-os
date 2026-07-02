"use client";

import React from "react";

export interface SecondaryPosition {
  id: string;
  assetName: string;
  nav: number;
  bidPrice: number | null;
  askPrice: number | null;
  discountPct: number | null;
  premiumPct: number | null;
  lastTradePrice: number | null;
  lastTradeDate: string | null;
  buyerInterest: number;
  sellerInterest: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(n);
}

function InterestBar({ buyer, seller }: { buyer: number; seller: number }) {
  const total = buyer + seller || 1;
  const buyerPct = (buyer / total) * 100;
  const sellerPct = (seller / total) * 100;
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-2">
        <span className="text-fg-muted text-xs w-14 shrink-0">Buyers</span>
        <div className="flex-1 h-1.5 bg-surface-1 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-300 rounded-full" style={{ width: `${buyerPct}%` }} />
        </div>
        <span className="text-emerald-300 font-mono text-xs w-6 text-right">{buyer}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-fg-muted text-xs w-14 shrink-0">Sellers</span>
        <div className="flex-1 h-1.5 bg-surface-1 rounded-full overflow-hidden">
          <div className="h-full bg-gold-400 rounded-full" style={{ width: `${sellerPct}%` }} />
        </div>
        <span className="text-gold-400 font-mono text-xs w-6 text-right">{seller}</span>
      </div>
    </div>
  );
}

function PositionRow({ p }: { p: SecondaryPosition }) {
  const hasBid = p.bidPrice !== null;
  const hasAsk = p.askPrice !== null;
  const bidBelowNav = hasBid && p.bidPrice! < p.nav;
  const askAboveNav = hasAsk && p.askPrice! > p.nav;

  return (
    <div className="bg-surface-1 rounded-2xl p-5 flex flex-col gap-4 border border-line">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-fg-primary font-display font-semibold text-base leading-tight">{p.assetName}</span>
          <span className="text-fg-muted text-xs font-mono">NAV {fmt(p.nav)}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {p.lastTradePrice !== null && (
            <span className="text-fg-secondary font-mono text-sm">Last {fmt(p.lastTradePrice)}</span>
          )}
          {p.lastTradeDate && (
            <span className="text-fg-muted text-xs">{p.lastTradeDate}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 bg-surface-0 rounded-xl p-3 flex flex-col gap-0.5 border border-line">
          <span className="text-fg-muted text-xs uppercase tracking-widest">Bid</span>
          {hasBid ? (
            <span className={`font-mono text-lg font-semibold ${bidBelowNav ? "text-status-danger" : "text-fg-primary"}`}>
              {fmt(p.bidPrice!)}
            </span>
          ) : (
            <span className="font-mono text-lg text-fg-muted">—</span>
          )}
        </div>
        <div className="text-fg-muted text-sm font-mono">↔</div>
        <div className="flex-1 bg-surface-0 rounded-xl p-3 flex flex-col gap-0.5 border border-line">
          <span className="text-fg-muted text-xs uppercase tracking-widest">Ask</span>
          {hasAsk ? (
            <span className={`font-mono text-lg font-semibold ${askAboveNav ? "text-emerald-300" : "text-fg-primary"}`}>
              {fmt(p.askPrice!)}
            </span>
          ) : (
            <span className="font-mono text-lg text-fg-muted">—</span>
          )}
        </div>
        <div className="flex-1 bg-surface-0 rounded-xl p-3 flex flex-col gap-0.5 border border-line items-center">
          {p.discountPct !== null && (
            <>
              <span className="text-fg-muted text-xs uppercase tracking-widest">Discount</span>
              <span className="font-mono text-lg font-semibold text-status-danger">{p.discountPct.toFixed(1)}%</span>
            </>
          )}
          {p.premiumPct !== null && (
            <>
              <span className="text-fg-muted text-xs uppercase tracking-widest">Premium</span>
              <span className="font-mono text-lg font-semibold text-emerald-300">+{p.premiumPct.toFixed(1)}%</span>
            </>
          )}
          {p.discountPct === null && p.premiumPct === null && (
            <>
              <span className="text-fg-muted text-xs uppercase tracking-widest">Spread</span>
              <span className="font-mono text-lg text-fg-muted">—</span>
            </>
          )}
        </div>
      </div>

      <InterestBar buyer={p.buyerInterest} seller={p.sellerInterest} />
    </div>
  );
}

export function SecondaryLiquidityPanel({ positions }: { positions: SecondaryPosition[] }) {
  return (
    <div className="bg-surface-0 rounded-2xl p-6 flex flex-col gap-6 border border-line">
      <div className="flex flex-col gap-1">
        <h2 className="text-fg-primary font-display font-semibold text-xl">Secondary Market Liquidity</h2>
        <p className="text-fg-muted text-sm">ForgeGlobal-style bid/ask panel for secondary transactions.</p>
      </div>
      {positions.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-fg-muted text-sm border border-line rounded-2xl bg-surface-1">
          No secondary positions available.
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {positions.map((p) => (
            <PositionRow key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
