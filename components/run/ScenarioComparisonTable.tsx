"use client";

// Forcastr-style multi-scenario comparison table for the deal war room.
// Renders a side-by-side columnar view of every exit scenario from scenarioGrid:
// exit value, gross multiple, IRR, LP proceeds, GP carry — all in one glance.
import { scenarioGrid, type ExitScenario } from "@/lib/exit-scenarios";
import type { WaterfallTerms } from "@/lib/waterfall";

interface Props {
  cost: number;
  currentValue: number;
  paidIn: number;
  holdYears: number;
  terms?: WaterfallTerms;
}

function fmtM(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtX(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(2)}×`;
}

function IrrTone({ irr }: { irr: number | null }) {
  if (irr === null) return <span className="text-fg-muted">—</span>;
  const tone =
    irr >= 25
      ? "text-emerald-300"
      : irr >= 15
      ? "text-gold-300"
      : irr >= 0
      ? "text-fg-secondary"
      : "text-status-danger";
  return <span className={tone}>{fmtPct(irr)}</span>;
}

function MoicTone({ moic }: { moic: number | null }) {
  if (moic === null) return <span className="text-fg-muted">—</span>;
  const tone =
    moic >= 3
      ? "text-emerald-300"
      : moic >= 2
      ? "text-gold-300"
      : moic >= 1
      ? "text-fg-secondary"
      : "text-status-danger";
  return <span className={tone}>{fmtX(moic)}</span>;
}

export function ScenarioComparisonTable({ cost, currentValue, paidIn, holdYears, terms }: Props) {
  if (cost <= 0 || paidIn <= 0) {
    return (
      <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          Exit Scenarios
        </h3>
        <p className="text-sm text-fg-muted">
          Add an underwriting case with cost basis and paid-in capital to model exit scenarios.
        </p>
      </div>
    );
  }

  const scenarios: ExitScenario[] = scenarioGrid(cost, currentValue, holdYears, paidIn, terms);

  // Split current-mark scenario out (tagged "Current mark")
  const current = scenarios.find((s) => s.label === "Current mark");
  const grid = scenarios.filter((s) => s.label !== "Current mark");

  return (
    <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          Exit Scenarios
        </h3>
        <span className="font-mono text-[10px] text-fg-muted">
          {holdYears.toFixed(1)}-year hold · paid-in {fmtM(paidIn)}
        </span>
      </div>

      {/* Current mark callout */}
      {current && (
        <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg border border-gold-500/30 bg-gold-500/5 px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
            Current mark
          </span>
          <span className="font-mono text-sm font-semibold text-fg-primary">
            {fmtM(current.exitValue)}
          </span>
          <span className="font-mono text-xs text-fg-secondary">
            {fmtX(current.grossMultiple)} gross
          </span>
          <IrrTone irr={current.irr} />
          <span className="ml-auto font-mono text-[10px] text-fg-muted">
            LP: {fmtM(current.toLps)} · GP: {fmtM(current.toGp)}
          </span>
        </div>
      )}

      {/* Scenario grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {[
                ["Scenario", "text-left"],
                ["Exit Value", "text-right"],
                ["Gross", "text-right"],
                ["Gross IRR", "text-right"],
                ["LP MOIC", "text-right"],
                ["LP IRR", "text-right"],
                ["GP Carry", "text-right"],
              ].map(([label, align]) => (
                <th
                  key={label}
                  className={`pb-2 font-mono text-[9px] uppercase tracking-wider text-fg-muted ${align}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/40">
            {grid.map((s) => (
              <tr key={s.label} className="group hover:bg-surface-2/40">
                <td className="py-2 pr-3 font-mono text-[11px] text-fg-secondary">{s.label}</td>
                <td className="py-2 text-right font-mono text-xs text-fg-primary">{fmtM(s.exitValue)}</td>
                <td className="py-2 text-right font-mono text-xs">
                  <MoicTone moic={s.grossMultiple} />
                </td>
                <td className="py-2 text-right font-mono text-xs">
                  <IrrTone irr={s.irr} />
                </td>
                <td className="py-2 text-right font-mono text-xs">
                  <MoicTone moic={s.lpMultiple} />
                </td>
                <td className="py-2 text-right font-mono text-xs">
                  <IrrTone irr={s.lpIrr} />
                </td>
                <td className="py-2 text-right font-mono text-xs text-gold-300">{fmtM(s.toGp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 font-mono text-[9px] text-fg-muted">
        Waterfall modeled over {holdYears.toFixed(1)}-year hold. Green = ≥ 25% IRR / 3× MOIC.
      </p>
    </div>
  );
}
