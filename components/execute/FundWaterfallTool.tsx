"use client";

// components/execute/FundWaterfallTool.tsx
// A multi-period fund-life waterfall — the complement to the single-distribution
// WaterfallCalculator. It runs a contribution/distribution schedule through
// lib/waterfall-schedule.ts with compounding preferred return and optional
// super-carry (a higher GP split once LPs pass a return multiple).
import { useMemo, useState } from "react";
import {
  computeWaterfallSchedule,
  type CashflowEvent,
  type ScheduleTerms,
} from "@/lib/waterfall-schedule";
import { ScenarioBar } from "@/components/shared/ScenarioBar";
import type { SavedScenario } from "@/lib/financial-scenarios";

const M = 1_000_000;

interface Row {
  period: string;
  contribution: string; // $M
  distribution: string; // $M
}

const DEFAULT_ROWS: Row[] = [
  { period: "0", contribution: "100", distribution: "" },
  { period: "3", contribution: "", distribution: "40" },
  { period: "5", contribution: "", distribution: "120" },
  { period: "7", contribution: "", distribution: "180" },
];

const fieldClass =
  "w-full rounded-md border border-line bg-surface-0 px-2 py-1 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const labelClass = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

const num = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};

export default function FundWaterfallTool({ saved = [] }: { saved?: SavedScenario[] }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(DEFAULT_ROWS);
  const [mode, setMode] = useState<"european" | "american">("european");
  const [prefPct, setPrefPct] = useState("8");
  const [catchUpPct, setCatchUpPct] = useState("100");
  const [compounding, setCompounding] = useState(true);
  const [baseCarryPct, setBaseCarryPct] = useState("20");
  const [superOn, setSuperOn] = useState(false);
  const [superCarryPct, setSuperCarryPct] = useState("30");
  const [superAboveX, setSuperAboveX] = useState("2");

  // Snapshot the current UI state for saving, and restore it on load. Stored
  // shape is this tool's own state (rows + term strings), read back defensively.
  function getInputs(): Record<string, unknown> {
    return { rows, mode, prefPct, catchUpPct, compounding, baseCarryPct, superOn, superCarryPct, superAboveX };
  }
  function loadScenario(s: Record<string, unknown>) {
    if (Array.isArray(s.rows)) setRows(s.rows as Row[]);
    if (s.mode === "european" || s.mode === "american") setMode(s.mode);
    if (typeof s.prefPct === "string") setPrefPct(s.prefPct);
    if (typeof s.catchUpPct === "string") setCatchUpPct(s.catchUpPct);
    if (typeof s.compounding === "boolean") setCompounding(s.compounding);
    if (typeof s.baseCarryPct === "string") setBaseCarryPct(s.baseCarryPct);
    if (typeof s.superOn === "boolean") setSuperOn(s.superOn);
    if (typeof s.superCarryPct === "string") setSuperCarryPct(s.superCarryPct);
    if (typeof s.superAboveX === "string") setSuperAboveX(s.superAboveX);
    setOpen(true);
  }

  const terms = useMemo<ScheduleTerms>(() => {
    const base = num(baseCarryPct) / 100;
    const tiers = superOn
      ? [
          { carry: base, upToMultiple: num(superAboveX) || Infinity },
          { carry: num(superCarryPct) / 100, upToMultiple: Infinity },
        ]
      : [{ carry: base, upToMultiple: Infinity }];
    return {
      prefRate: num(prefPct) / 100,
      catchUp: num(catchUpPct) / 100,
      compounding,
      carryTiers: tiers,
      mode,
    };
  }, [prefPct, catchUpPct, compounding, baseCarryPct, superOn, superCarryPct, superAboveX, mode]);

  const events = useMemo<CashflowEvent[]>(
    () =>
      rows.map((r) => ({
        period: num(r.period),
        contribution: num(r.contribution) * M,
        distribution: num(r.distribution) * M,
      })),
    [rows],
  );

  const result = useMemo(() => computeWaterfallSchedule(events, terms), [events, terms]);

  const setRow = (i: number, key: keyof Row, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, { period: "", contribution: "", distribution: "" }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
            Fund-life waterfall
          </span>
          <span className="ml-2 text-sm text-fg-secondary">
            Multiple distributions, compounding pref, super-carry
          </span>
        </span>
        <span className="flex items-center gap-3 font-mono text-sm">
          <span className="text-gold-300">{result.dpi.toFixed(2)}x DPI</span>
          <span className="text-fg-secondary">
            {result.lpPct}/{result.gpPct} LP/GP
          </span>
          <svg
            className={`h-3 w-3 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 10 6"
            fill="none"
          >
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-4 py-4">
          <ScenarioBar kind="waterfall" saved={saved} getInputs={getInputs} onLoad={loadScenario} />
          {/* Terms */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Mode</span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as "european" | "american")}
                className={fieldClass}
                aria-label="Waterfall mode"
              >
                <option value="european">European (whole-fund)</option>
                <option value="american">American (deal-by-deal)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Pref (%)</span>
              <input value={prefPct} onChange={(e) => setPrefPct(e.target.value)} inputMode="decimal" className={fieldClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Catch-up (%)</span>
              <input value={catchUpPct} onChange={(e) => setCatchUpPct(e.target.value)} inputMode="decimal" className={fieldClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Carry (%)</span>
              <input value={baseCarryPct} onChange={(e) => setBaseCarryPct(e.target.value)} inputMode="decimal" className={fieldClass} />
            </label>
            <label className="flex items-center gap-2 pt-5">
              <input type="checkbox" checked={compounding} onChange={(e) => setCompounding(e.target.checked)} />
              <span className="text-xs text-fg-secondary">Compound pref</span>
            </label>
            <label className="flex items-center gap-2 pt-5">
              <input type="checkbox" checked={superOn} onChange={(e) => setSuperOn(e.target.checked)} />
              <span className="text-xs text-fg-secondary">Super-carry</span>
            </label>
          </div>
          {superOn && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Super carry (%)</span>
                <input value={superCarryPct} onChange={(e) => setSuperCarryPct(e.target.value)} inputMode="decimal" className={fieldClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Above (× paid-in)</span>
                <input value={superAboveX} onChange={(e) => setSuperAboveX(e.target.value)} inputMode="decimal" className={fieldClass} />
              </label>
            </div>
          )}

          {/* Schedule */}
          <div className="mt-4 overflow-x-auto">
            <p className={`${labelClass} mb-2`}>Cash-flow schedule ($M)</p>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className={`${labelClass} py-1.5 pr-3 font-normal`}>Period</th>
                  <th className={`${labelClass} py-1.5 pr-3 font-normal`}>Contribution</th>
                  <th className={`${labelClass} py-1.5 pr-3 font-normal`}>Distribution</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/40">
                    <td className="py-1 pr-2">
                      <input value={r.period} onChange={(e) => setRow(i, "period", e.target.value)} inputMode="decimal" className={`${fieldClass} w-16`} aria-label="Period" />
                    </td>
                    <td className="py-1 pr-2">
                      <input value={r.contribution} onChange={(e) => setRow(i, "contribution", e.target.value)} inputMode="decimal" className={`${fieldClass} w-24`} placeholder="0" aria-label="Contribution" />
                    </td>
                    <td className="py-1 pr-2">
                      <input value={r.distribution} onChange={(e) => setRow(i, "distribution", e.target.value)} inputMode="decimal" className={`${fieldClass} w-24`} placeholder="0" aria-label="Distribution" />
                    </td>
                    <td className="py-1">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-fg-muted transition hover:text-status-danger"
                        aria-label="Remove row"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={addRow}
              className="mt-2 rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/60 hover:text-gold-300"
            >
              + Add event
            </button>
          </div>

          {/* Fund totals */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Paid-in", value: money(result.paidIn) },
              { label: "To LPs", value: money(result.totalToLps) },
              { label: "GP carry", value: money(result.totalToGp) },
              { label: "DPI", value: `${result.dpi.toFixed(2)}x` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-line/60 bg-surface-2 px-3 py-2">
                <p className={labelClass}>{s.label}</p>
                <p className="mt-0.5 font-mono text-base text-gold-300">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Per-distribution breakdown */}
          {result.distributions.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <p className={`${labelClass} mb-2`}>Per-distribution split</p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    {["Period", "Distribution", "ROC", "Pref", "GP catch-up", "Carry LP", "Carry GP"].map((h) => (
                      <th key={h} className={`${labelClass} py-1.5 pr-3 font-normal`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {result.distributions.map((d, i) => (
                    <tr key={i} className="border-b border-line/40">
                      <td className="py-1.5 pr-3 text-gold-400">{d.period}</td>
                      <td className="py-1.5 pr-3 text-fg-primary">{money(d.distribution)}</td>
                      <td className="py-1.5 pr-3 text-fg-secondary">{money(d.roc)}</td>
                      <td className="py-1.5 pr-3 text-fg-secondary">{money(d.prefToLps)}</td>
                      <td className="py-1.5 pr-3 text-fg-secondary">{money(d.catchUpToGp)}</td>
                      <td className="py-1.5 pr-3 text-emerald-300">{money(d.carryToLps)}</td>
                      <td className="py-1.5 pr-3 text-gold-300">{money(d.carryToGp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(result.unreturnedCapital > 1 || result.accruedPrefRemaining > 1) && (
            <p className="mt-3 text-[11px] text-fg-muted">
              Outstanding to LPs: {money(result.unreturnedCapital)} unreturned capital
              {result.accruedPrefRemaining > 1 ? ` + ${money(result.accruedPrefRemaining)} accrued pref` : ""}
              {mode === "american"
                ? " — carry is taken deal-by-deal as realizations occur."
                : " — GP carry accrues only once these are cleared."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
