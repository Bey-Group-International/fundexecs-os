"use client";

// Forcastr-style portfolio exit scenario rollup.
// Shows aggregate exit projections at different multiple targets across every
// held asset, giving the GP a single-screen read on what the portfolio returns
// under base / upside / downside exits.

interface AssetRow {
  id: string;
  name: string;
  cost: number;          // equity invested
  nav: number;           // current marked value
  moic: number | null;
  holdPeriodMonths: number | null;
}

interface Props {
  assets: AssetRow[];
  totalNAV: number;
}

const SCENARIOS = [
  { label: "Downside", multiple: 0.75, tone: "text-status-danger" },
  { label: "Base",     multiple: 1.5,  tone: "text-fg-secondary" },
  { label: "Upside",   multiple: 2.5,  tone: "text-gold-300" },
  { label: "Bull",     multiple: 4.0,  tone: "text-emerald-300" },
] as const;

function fmt(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function moicFmt(v: number): string {
  return `${v.toFixed(2)}×`;
}

// Annualised IRR approximation from MOIC and hold period in months.
function approxIRR(moic: number, holdMonths: number | null): number | null {
  if (!holdMonths || holdMonths <= 0) return null;
  const years = holdMonths / 12;
  return (Math.pow(moic, 1 / years) - 1) * 100;
}

function irrFmt(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function irrTone(v: number | null): string {
  if (v === null) return "text-fg-muted";
  if (v >= 25) return "text-emerald-300";
  if (v >= 15) return "text-gold-300";
  if (v < 0) return "text-status-danger";
  return "text-fg-secondary";
}

export function PortfolioExitScenarios({ assets, totalNAV }: Props) {
  const held = assets.filter((a) => a.cost > 0);
  if (!held.length) return null;

  const totalCost = held.reduce((s, a) => s + a.cost, 0);
  const avgHold = held.length
    ? Math.round(held.reduce((s, a) => s + (a.holdPeriodMonths ?? 0), 0) / held.length)
    : null;

  return (
    <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
            Exit Scenarios
          </h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            Aggregate portfolio projections at each exit multiple — current NAV base.
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-semibold text-fg-primary">{fmt(totalNAV)}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Current NAV</p>
        </div>
      </div>

      {/* Portfolio-level scenario bar */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SCENARIOS.map((s) => {
          const exitValue = totalNAV * s.multiple;
          const moic = totalCost > 0 ? exitValue / totalCost : null;
          const irr = moic && avgHold ? approxIRR(moic, avgHold) : null;
          return (
            <div key={s.label} className="rounded-lg border border-line/60 bg-surface-0 px-3 py-2.5">
              <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{s.label}</p>
              <p className={`mt-1 font-display text-lg font-semibold ${s.tone}`}>{fmt(exitValue)}</p>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-fg-muted">
                {moic != null ? (
                  <span className={s.tone}>{moicFmt(moic)}</span>
                ) : null}
                {irr !== null ? (
                  <span className={irrTone(irr)}>{irrFmt(irr)} IRR</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-asset scenario table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="pb-2 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted">Asset</th>
              <th className="pb-2 text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">Cost</th>
              <th className="pb-2 text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">NAV</th>
              {SCENARIOS.map((s) => (
                <th key={s.label} className="pb-2 text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {s.label} ({s.multiple}×)
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/40">
            {held.map((a) => (
              <tr key={a.id}>
                <td className="py-2 pr-3 font-medium text-fg-primary">{a.name}</td>
                <td className="py-2 pr-3 text-right font-mono text-xs text-fg-muted">{fmt(a.cost)}</td>
                <td className="py-2 pr-3 text-right font-mono text-xs text-fg-secondary">{fmt(a.nav)}</td>
                {SCENARIOS.map((s) => {
                  const exitV = a.nav * s.multiple;
                  const m = a.cost > 0 ? exitV / a.cost : null;
                  return (
                    <td key={s.label} className={`py-2 text-right font-mono text-xs ${s.tone}`}>
                      {fmt(exitV)}
                      {m != null ? (
                        <span className="ml-1 text-[10px] opacity-60">{moicFmt(m)}</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td className="py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Total</td>
              <td className="py-2 pr-3 text-right font-mono text-xs font-semibold text-fg-primary">{fmt(totalCost)}</td>
              <td className="py-2 pr-3 text-right font-mono text-xs font-semibold text-fg-primary">{fmt(totalNAV)}</td>
              {SCENARIOS.map((s) => (
                <td key={s.label} className={`py-2 text-right font-mono text-xs font-semibold ${s.tone}`}>
                  {fmt(totalNAV * s.multiple)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 font-mono text-[9px] text-fg-muted">
        Multiples applied to current NAV. IRR estimated from average hold period ({avgHold != null ? `${avgHold}mo` : "unknown"}).
      </p>
    </div>
  );
}
