"use client";

export interface FundKPI {
  id: string;
  name: string;
  vintage: number | null;
  called: number;
  distributed: number;
  nav: number;
  committed: number;
  avgHoldMonths: number | null;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtMultiple(n: number): string {
  return `${n.toFixed(2)}x`;
}

function tvpiColor(tvpi: number): string {
  if (tvpi >= 2) return "text-emerald-300";
  if (tvpi >= 1) return "text-gold-300";
  return "text-status-danger";
}

function metricColor(value: number, thresholdHigh: number, thresholdMid: number): string {
  if (value >= thresholdHigh) return "text-emerald-300";
  if (value >= thresholdMid) return "text-gold-300";
  return "text-status-danger";
}

interface ComputedFund {
  fund: FundKPI;
  dpi: number | null;
  rvpi: number | null;
  tvpi: number | null;
  irr: number | null;
  calledPct: number;
}

function computeFund(fund: FundKPI): ComputedFund {
  const dpi = fund.called > 0 ? fund.distributed / fund.called : null;
  const rvpi = fund.called > 0 ? fund.nav / fund.called : null;
  const tvpi = dpi !== null && rvpi !== null ? dpi + rvpi : null;
  const irr =
    tvpi !== null && fund.avgHoldMonths != null && fund.avgHoldMonths > 0
      ? (Math.pow(tvpi, 12 / fund.avgHoldMonths) - 1) * 100
      : null;
  const calledPct = fund.committed > 0 ? (fund.called / fund.committed) * 100 : 0;
  return { fund, dpi, rvpi, tvpi, irr, calledPct };
}

interface KPITileProps {
  label: string;
  value: string | null;
  colorClass?: string;
}

function KPITile({ label, value, colorClass = "text-fg-primary" }: KPITileProps) {
  return (
    <div className="flex flex-col gap-0.5 p-2.5 rounded-xl bg-surface-1">
      <span className="font-mono uppercase text-xs text-fg-muted tracking-wide">{label}</span>
      <span className={`font-display text-lg font-bold tabular-nums ${colorClass}`}>
        {value ?? <span className="text-fg-muted text-base">N/A</span>}
      </span>
    </div>
  );
}

export function FundKPIPanel({ funds }: { funds: FundKPI[] }) {
  const computed = funds.map(computeFund);

  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5 flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-mono uppercase tracking-widest text-xs text-fg-muted">Fund KPIs</h2>
        <p className="text-fg-secondary text-sm">FundWave-style DPI / RVPI / TVPI / IRR by fund.</p>
      </div>

      {computed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <p className="text-fg-muted text-sm font-mono">No funds</p>
          <p className="text-fg-muted text-xs">Fund KPI data will appear here once funds are added.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {computed.map(({ fund, dpi, rvpi, tvpi, irr, calledPct }) => (
            <div key={fund.id} className="rounded-2xl bg-surface-0 border border-line p-4 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-fg-primary text-sm font-medium truncate">{fund.name}</span>
                  {fund.vintage != null && (
                    <span className="text-fg-muted text-xs font-mono">Vintage {fund.vintage}</span>
                  )}
                </div>
                {tvpi !== null && (
                  <span className={`shrink-0 font-display text-xl font-bold tabular-nums ${tvpiColor(tvpi)}`}>
                    {fmtMultiple(tvpi)}
                    <span className="text-xs font-mono font-normal text-fg-muted ml-1">TVPI</span>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <KPITile
                  label="DPI"
                  value={dpi !== null ? fmtMultiple(dpi) : null}
                  colorClass={dpi !== null ? metricColor(dpi, 1.5, 1) : "text-fg-muted"}
                />
                <KPITile
                  label="RVPI"
                  value={rvpi !== null ? fmtMultiple(rvpi) : null}
                  colorClass={rvpi !== null ? metricColor(rvpi, 1.2, 0.8) : "text-fg-muted"}
                />
                <KPITile
                  label="TVPI"
                  value={tvpi !== null ? fmtMultiple(tvpi) : null}
                  colorClass={tvpi !== null ? tvpiColor(tvpi) : "text-fg-muted"}
                />
                <KPITile
                  label="IRR (approx)"
                  value={irr !== null ? `${irr.toFixed(1)}%` : null}
                  colorClass={irr !== null ? metricColor(irr, 20, 10) : "text-fg-muted"}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono uppercase text-xs text-fg-muted">Called</span>
                  <span className="font-mono text-xs text-fg-secondary tabular-nums">
                    {fmtUsd(fund.called)} / {fmtUsd(fund.committed)}
                    <span className="text-fg-muted ml-1.5">({calledPct.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gold-400"
                    style={{ width: `${Math.min(calledPct, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
