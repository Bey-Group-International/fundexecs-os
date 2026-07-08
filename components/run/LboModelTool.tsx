"use client";

// components/run/LboModelTool.tsx
// An interactive LBO returns model for Run › Underwriting — a live modeling
// scratchpad that runs the full leverage / debt-sweep chain (lib/lbo-model.ts)
// and shows IRR / MOIC, the year-by-year debt schedule, and the value-creation
// bridge. Complements the per-case UnderwritingCalculator, which is a simpler
// leverage-blind equity CAGR.
import { useMemo, useState } from "react";
import { computeLbo, defaultLboInputs, type LboInputs } from "@/lib/lbo-model";

// Inputs the UI collects as whole percentages (converted to fractions on the
// way into computeLbo) versus raw dollar / multiple / year values.
const PCT_FIELDS = new Set<keyof LboInputs>([
  "debtPct",
  "interestRate",
  "revenueGrowth",
  "ebitdaMargin",
  "daPctRevenue",
  "capexPctRevenue",
  "nwcPctRevenueChange",
  "taxRate",
]);

interface FieldDef {
  key: keyof LboInputs;
  label: string;
  suffix?: string;
}

const FIELDS: FieldDef[] = [
  { key: "entryEbitda", label: "Entry EBITDA", suffix: "$" },
  { key: "entryMultiple", label: "Entry multiple", suffix: "x" },
  { key: "debtPct", label: "Debt of EV", suffix: "%" },
  { key: "interestRate", label: "Interest", suffix: "%" },
  { key: "holdYears", label: "Hold", suffix: "yr" },
  { key: "exitMultiple", label: "Exit multiple", suffix: "x" },
  { key: "revenue", label: "Revenue", suffix: "$" },
  { key: "revenueGrowth", label: "Rev growth", suffix: "%" },
  { key: "ebitdaMargin", label: "EBITDA margin", suffix: "%" },
  { key: "daPctRevenue", label: "D&A / rev", suffix: "%" },
  { key: "capexPctRevenue", label: "CapEx / rev", suffix: "%" },
  { key: "nwcPctRevenueChange", label: "ΔNWC / Δrev", suffix: "%" },
  { key: "taxRate", label: "Tax rate", suffix: "%" },
];

const fieldClass =
  "w-full rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const labelClass = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";

// Present a stored value in UI units: fractions become whole percents.
function toDisplay(key: keyof LboInputs, v: number): string {
  if (PCT_FIELDS.has(key)) return String(Math.round(v * 1000) / 10);
  return String(v);
}

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

export function LboModelTool() {
  const [raw, setRaw] = useState<Record<keyof LboInputs, string>>(() => {
    const d = defaultLboInputs();
    return Object.fromEntries(
      (Object.keys(d) as (keyof LboInputs)[]).map((k) => [k, toDisplay(k, d[k])]),
    ) as Record<keyof LboInputs, string>;
  });
  const [open, setOpen] = useState(false);

  const inputs = useMemo<LboInputs>(() => {
    const d = defaultLboInputs();
    const out = { ...d };
    for (const k of Object.keys(d) as (keyof LboInputs)[]) {
      const parsed = parseFloat(raw[k]);
      if (Number.isFinite(parsed)) {
        out[k] = PCT_FIELDS.has(k) ? parsed / 100 : parsed;
      }
    }
    return out;
  }, [raw]);

  const result = useMemo(() => computeLbo(inputs), [inputs]);

  const bridgeParts = [
    { label: "EBITDA growth", value: result.bridge.ebitdaGrowth },
    { label: "Multiple", value: result.bridge.multipleExpansion },
    { label: "Debt paydown", value: result.bridge.debtPaydown },
  ];
  const bridgeMax = Math.max(1, ...bridgeParts.map((p) => Math.abs(p.value)));

  return (
    <div className="mb-4 rounded-xl border border-line bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
            LBO model
          </span>
          <span className="ml-2 text-sm text-fg-secondary">
            Model leverage, cash sweep, and exit returns
          </span>
        </span>
        <span className="flex items-center gap-3 font-mono text-sm">
          <span className="text-gold-300">
            {result.irr != null ? `${(result.irr * 100).toFixed(1)}% IRR` : "— IRR"}
          </span>
          <span className="text-fg-secondary">
            {result.moic != null ? `${result.moic.toFixed(2)}x` : "—"}
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
          {/* Inputs */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className={labelClass}>
                  {f.label}
                  {f.suffix ? ` (${f.suffix})` : ""}
                </span>
                <input
                  value={raw[f.key]}
                  onChange={(e) => setRaw((r) => ({ ...r, [f.key]: e.target.value }))}
                  inputMode="decimal"
                  className={fieldClass}
                  aria-label={f.label}
                />
              </label>
            ))}
          </div>

          {/* Headline returns */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Entry equity", value: money(result.entryEquity) },
              { label: "Exit equity", value: money(result.exitEquity) },
              { label: "MOIC", value: result.moic != null ? `${result.moic.toFixed(2)}x` : "—" },
              { label: "IRR", value: result.irr != null ? `${(result.irr * 100).toFixed(1)}%` : "—" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-line/60 bg-surface-2 px-3 py-2">
                <p className={labelClass}>{s.label}</p>
                <p className="mt-0.5 font-mono text-base text-gold-300">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Value bridge */}
          <div className="mt-4">
            <p className={`${labelClass} mb-2`}>Equity value bridge</p>
            <div className="flex flex-col gap-1.5">
              {bridgeParts.map((p) => (
                <div key={p.label} className="grid grid-cols-[120px_1fr_90px] items-center gap-2">
                  <span className="text-xs text-fg-secondary">{p.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className={`h-full rounded-full ${p.value < 0 ? "bg-status-danger" : "bg-gold-500"}`}
                      style={{ width: `${(Math.abs(p.value) / bridgeMax) * 100}%` }}
                    />
                  </div>
                  <span className="text-right font-mono text-xs text-fg-secondary">{money(p.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Debt schedule */}
          {result.schedule.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <p className={`${labelClass} mb-2`}>Debt schedule</p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    {["Year", "Revenue", "EBITDA", "Interest", "FCF", "Paydown", "Ending debt"].map((h) => (
                      <th key={h} className={`${labelClass} py-1.5 pr-3 font-normal`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {result.schedule.map((y) => (
                    <tr key={y.year} className="border-b border-line/40">
                      <td className="py-1.5 pr-3 text-gold-400">{y.year}</td>
                      <td className="py-1.5 pr-3 text-fg-secondary">{money(y.revenue)}</td>
                      <td className="py-1.5 pr-3 text-fg-secondary">{money(y.ebitda)}</td>
                      <td className="py-1.5 pr-3 text-fg-secondary">{money(y.interest)}</td>
                      <td className="py-1.5 pr-3 text-fg-secondary">{money(y.fcf)}</td>
                      <td className="py-1.5 pr-3 text-emerald-300">{money(y.debtPaydown)}</td>
                      <td className="py-1.5 pr-3 text-fg-primary">{money(y.endingDebt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-[11px] text-fg-muted">
            A modeling scratchpad — equity returns from entry leverage, an annual cash sweep, and
            the exit multiple. It is not saved; capture a case above to persist IRR/MOIC.
          </p>
        </div>
      )}
    </div>
  );
}
