"use client";

// components/run/FundScoringBoard.tsx
// Presentational board for the ML-style fund-selection scoring model. Renders a
// ranked, sortable table of the firm's funds with a tier badge, key metrics, and
// a per-row expandable factor breakdown (label / weight / contribution / note)
// so every score is explainable. Styling follows the app's Tailwind design
// tokens (text-fg-*, bg-surface-*, border-line, gold-* accents, font-mono
// labels) and the accordion pattern from components/execute/ContractStatusBoard.
import { useMemo, useState } from "react";
import type { RankedFund, FundTier } from "@/lib/fund-scoring";

// Row shape the board consumes — RankedFund from the pure model.
type Row = RankedFund;

const TIER_META: Record<FundTier, { label: string; classes: string }> = {
  top: {
    label: "Top",
    classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  },
  upper: {
    label: "Upper",
    classes: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  },
  mid: {
    label: "Mid",
    classes: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  },
  lower: {
    label: "Lower",
    classes: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  },
};

function TierBadge({ tier }: { tier: FundTier }) {
  const meta = TIER_META[tier];
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.classes}`}
    >
      {meta.label}
    </span>
  );
}

function formatUsd(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${Math.round(v / 1_000_000)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

function formatPct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function formatMoic(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(2)}x`;
}

/** Horizontal weight/contribution bar for one factor line. */
function ContributionBar({ contribution }: { contribution: number }) {
  // Each factor contributes at most weight*100 points; the widest single factor
  // maxes near 25pts (prior IRR). Scale the bar against a 25-pt reference so the
  // strongest factors read as ~full width.
  const pct = Math.max(0, Math.min(100, (contribution / 25) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full rounded-full bg-gold-500/70"
        style={{ width: `${pct}%` }}
        aria-hidden
      />
    </div>
  );
}

function FactorBreakdown({ row }: { row: Row }) {
  return (
    <div className="border-t border-line bg-surface-2/20 px-4 py-3">
      <p className="mb-3 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
        Factor breakdown
      </p>
      <ul className="flex flex-col gap-3">
        {row.factors.map((f) => (
          <li key={f.label} className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1">
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-fg-primary">{f.label}</span>
                <span className="font-mono text-[10px] text-fg-muted">
                  w {(f.weight * 100).toFixed(0)}%
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-4 text-fg-muted">{f.note}</p>
              <div className="mt-1.5">
                <ContributionBar contribution={f.contribution} />
              </div>
            </div>
            <span className="pt-0.5 text-right font-mono text-xs tabular-nums text-fg-secondary">
              +{f.contribution.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FundRowItem({
  row,
  rank,
  open,
  onToggle,
}: {
  row: Row;
  rank: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-line last:border-0">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${row.name} — ${open ? "hide" : "view"} factor breakdown`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-surface-2/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-400/50"
      >
        <span className="w-6 shrink-0 text-center font-mono text-[11px] tabular-nums text-fg-muted">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg-primary">{row.name}</p>
          <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
            {formatUsd(row.inputs.fund_size_usd)}
            {row.inputs.vintage_year != null && ` · vintage ${row.inputs.vintage_year}`}
            {` · prior IRR ${formatPct(row.inputs.prior_gross_irr)}`}
            {` · ${formatMoic(row.inputs.prior_moic)}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <span className="font-mono text-sm font-semibold tabular-nums text-fg-primary">
              {row.score.toFixed(1)}
            </span>
            <span className="ml-0.5 font-mono text-[9px] text-fg-muted">/100</span>
          </div>
          <TierBadge tier={row.tier} />
          <span
            aria-hidden
            className={`inline-block font-mono text-[10px] text-fg-muted transition-transform ${
              open ? "rotate-90 text-gold-400" : ""
            }`}
          >
            →
          </span>
        </div>
      </div>
      {/* Animated accordion: collapses height via a 0fr→1fr grid track. */}
      <div
        className={`grid transition-all duration-200 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <FactorBreakdown row={row} />
        </div>
      </div>
    </div>
  );
}

type SortDir = "desc" | "asc";

export function FundScoringBoard({ rows }: { rows: Row[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // rows arrive score-desc from the model; re-sort only when the operator flips
  // direction. Ranks are always assigned by the natural (desc) order so a fund's
  // rank number is stable regardless of the display sort.
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    [...rows]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .forEach((r, i) => m.set(r.id, i + 1));
    return m;
  }, [rows]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) =>
      sortDir === "desc" ? b.score - a.score : a.score - b.score,
    );
    return copy;
  }, [rows, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-1/50 p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          No funds to score yet
        </p>
        <p className="mt-1 text-xs text-fg-secondary">
          Add a fund and its prior track record to see predicted-performance
          scores and the factor breakdown behind each one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-gold-500/20 bg-gold-500/[0.04] p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
          How this score works
        </p>
        <p className="mt-1.5 text-xs leading-5 text-fg-secondary">
          Each fund is scored 0–100 by a transparent weighted model over
          pre-investment factors: prior gross IRR (25%), GP experience (22%),
          fund size vs. the mid-market sweet spot (18%), sector specialization
          (15%), prior MOIC (12%), and deployment discipline (8%). Every factor
          is normalized by a documented logistic or bell curve — no trained
          weights, no black box. Expand any fund to see how much each factor
          contributed. Tiers: Top ≥ 75, Upper ≥ 60, Mid ≥ 40, else Lower.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface-1">
        <div className="flex items-center gap-3 border-b border-line bg-surface-2/30 px-4 py-2">
          <span className="w-6 shrink-0 text-center font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            #
          </span>
          <span className="flex-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Fund
          </span>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            aria-label={`Sort by score ${sortDir === "desc" ? "ascending" : "descending"}`}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-gold-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-400/50"
          >
            Score
            <span aria-hidden className="text-[9px]">
              {sortDir === "desc" ? "▼" : "▲"}
            </span>
          </button>
        </div>
        {sorted.map((row) => (
          <FundRowItem
            key={row.id}
            row={row}
            rank={rankById.get(row.id) ?? 0}
            open={openId === row.id}
            onToggle={() => setOpenId((id) => (id === row.id ? null : row.id))}
          />
        ))}
      </div>
    </div>
  );
}
