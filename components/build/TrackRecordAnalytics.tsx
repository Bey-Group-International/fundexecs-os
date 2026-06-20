"use client";

// Analytics + sortable list for the Build > Track Record module.
// Pure props in, presentation out — no data fetching here. Two exports:
//  - TrackRecordAnalytics: summary cards, realized/unrealized split, by-vintage
//    breakdown (inline-SVG bars + compact table).
//  - SortableTrackRecordList: client-side sort control over the deal list.
import { useMemo, useState } from "react";
import type { TrackRecord } from "@/lib/supabase/database.types";
import { blendTrackRecord, groupByVintage } from "@/lib/track-record";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function fmtMoic(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(2)}x` : "—";
}

function fmtPct(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}

function fmtRatio(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) ? n.toFixed(2) : "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold text-fg-primary">{value}</div>
    </div>
  );
}

export function TrackRecordAnalytics({ records }: { records: TrackRecord[] }) {
  const blended = useMemo(() => blendTrackRecord(records), [records]);
  const vintages = useMemo(() => groupByVintage(records), [records]);

  const { totalRealized, totalUnrealized, totalValue } = blended;
  const splitBase = totalValue > 0 ? totalValue : 0;
  const realizedPct = splitBase > 0 ? (totalRealized / splitBase) * 100 : 0;
  const unrealizedPct = splitBase > 0 ? (totalUnrealized / splitBase) * 100 : 0;

  // Scale by-vintage bars to the largest value across all groups.
  const chartMax = Math.max(
    1,
    ...vintages.map((g) => Math.max(g.blended.totalInvested, g.blended.totalValue))
  );

  return (
    <section className="mb-6 space-y-5 rounded-xl border border-line bg-surface-0 p-4">
      <div>
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Pooled performance</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Gross IRR" value={fmtPct(blended.weightedGrossIrr)} />
          <Stat label="Pooled MOIC" value={fmtMoic(blended.pooledMoic)} />
          <Stat label="DPI" value={fmtRatio(blended.dpi)} />
          <Stat label="RVPI" value={fmtRatio(blended.rvpi)} />
          <Stat label="Invested" value={compactUsd(blended.totalInvested)} />
          <Stat label="Total value" value={compactUsd(blended.totalValue)} />
        </div>
      </div>

      <div>
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Realized vs unrealized</h3>
        {splitBase > 0 ? (
          <>
            <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-status-success" style={{ width: `${realizedPct}%` }} />
              <div className="h-full bg-gold-400" style={{ width: `${unrealizedPct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-secondary">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-status-success" />
                Realized {compactUsd(totalRealized)} ({realizedPct.toFixed(0)}%)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-gold-400" />
                Unrealized {compactUsd(totalUnrealized)} ({unrealizedPct.toFixed(0)}%)
              </span>
            </div>
          </>
        ) : (
          <p className="mt-2 text-xs text-fg-muted">No realized or unrealized value recorded yet.</p>
        )}
      </div>

      <div>
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">By vintage</h3>
        {vintages.length === 0 ? (
          <p className="mt-2 text-xs text-fg-muted">No deals to break down yet.</p>
        ) : (
          <div className="mt-2 space-y-3">
            <div className="space-y-2">
              {vintages.map((g) => {
                const investedW = (g.blended.totalInvested / chartMax) * 100;
                const valueW = (g.blended.totalValue / chartMax) * 100;
                return (
                  <div key={g.vintage ?? "unknown"} className="flex items-center gap-2 text-xs">
                    <span className="w-12 shrink-0 font-mono text-fg-muted">{g.vintage ?? "—"}</span>
                    <svg
                      viewBox="0 0 100 14"
                      preserveAspectRatio="none"
                      className="h-3.5 flex-1"
                      role="img"
                      aria-label={`Vintage ${g.vintage ?? "unknown"}: invested ${compactUsd(g.blended.totalInvested)}, value ${compactUsd(g.blended.totalValue)}`}
                    >
                      <rect x="0" y="0" width="100" height="6" rx="1" className="fill-surface-2" />
                      <rect x="0" y="0" width={investedW} height="6" rx="1" className="fill-fg-secondary" />
                      <rect x="0" y="8" width="100" height="6" rx="1" className="fill-surface-2" />
                      <rect x="0" y="8" width={valueW} height="6" rx="1" className="fill-gold-400" />
                    </svg>
                  </div>
                );
              })}
              <div className="flex gap-4 pl-14 text-[10px] text-fg-muted">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-fg-secondary" /> Invested
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-gold-400" /> Total value
                </span>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left">
                    {["Vintage", "Deals", "Invested", "MOIC", "IRR"].map((h) => (
                      <th key={h} className="px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vintages.map((g) => (
                    <tr key={g.vintage ?? "unknown"} className="border-b border-line last:border-0">
                      <td className="px-2.5 py-1.5 font-mono text-fg-primary">{g.vintage ?? "—"}</td>
                      <td className="px-2.5 py-1.5 text-fg-secondary">{g.blended.dealCount}</td>
                      <td className="px-2.5 py-1.5 text-fg-secondary">{compactUsd(g.blended.totalInvested)}</td>
                      <td className="px-2.5 py-1.5 text-fg-secondary">{fmtMoic(g.blended.pooledMoic)}</td>
                      <td className="px-2.5 py-1.5 text-fg-secondary">{fmtPct(g.blended.weightedGrossIrr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// --- Sortable list ---------------------------------------------------------

type SortKey = "vintage" | "irr" | "moic" | "invested";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "vintage", label: "Vintage" },
  { key: "irr", label: "IRR" },
  { key: "moic", label: "MOIC" },
  { key: "invested", label: "Invested" },
];

function sortValue(r: TrackRecord, key: SortKey): number {
  switch (key) {
    case "vintage":
      return r.vintage_year ?? -Infinity;
    case "irr":
      return r.gross_irr ?? -Infinity;
    case "moic":
      return r.gross_moic ?? -Infinity;
    case "invested":
      return r.invested_amount ?? -Infinity;
  }
}

/**
 * Wraps the existing record list with a client-side sort control. The parent
 * (a server component) renders each row server-side and passes them as a
 * serializable `rows` array ({ id, node }); React Server Components allow
 * server-rendered nodes to cross into a client component as props. This
 * component re-orders those nodes by mapping the chosen sort over `records`.
 */
export function SortableTrackRecordList({
  records,
  rows,
}: {
  records: TrackRecord[];
  rows: { id: string; node: React.ReactNode }[];
}) {
  const [key, setKey] = useState<SortKey>("vintage");
  const [desc, setDesc] = useState(true);

  const nodeById = useMemo(() => {
    const m = new Map<string, React.ReactNode>();
    for (const row of rows) m.set(row.id, row.node);
    return m;
  }, [rows]);

  const sorted = useMemo(() => {
    const copy = [...records];
    copy.sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av === bv) return a.deal_name.localeCompare(b.deal_name);
      return desc ? bv - av : av - bv;
    });
    return copy;
  }, [records, key, desc]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Sort by</span>
        {SORT_OPTIONS.map((o) => {
          const active = o.key === key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                if (active) setDesc((d) => !d);
                else {
                  setKey(o.key);
                  setDesc(true);
                }
              }}
              className={`rounded-md border px-2 py-0.5 transition ${
                active
                  ? "border-gold-400 bg-surface-2 text-fg-primary"
                  : "border-line text-fg-muted hover:text-fg-secondary"
              }`}
              aria-pressed={active}
            >
              {o.label}
              {active ? (desc ? " ↓" : " ↑") : ""}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              {["Deal", "Class", "Vintage", "Invested", "IRR", "MOIC", ""].map((h) => (
                <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{sorted.map((r) => nodeById.get(r.id))}</tbody>
        </table>
      </div>
    </div>
  );
}
