"use client";

// Inputs-driven returns calculator with a live client-side preview. The
// authoritative compute happens server-side in `saveUnderwritingInputs` (via
// the same pure `computeReturnsFromInputs`); this just mirrors it so the
// operator sees IRR/MOIC update as they type before saving.
import { useState } from "react";
import { computeReturnsFromInputs } from "@/lib/underwriting-calc";
import { saveUnderwritingInputs } from "@/components/run/underwriting-actions";

const fieldClass =
  "rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const labelClass = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";

function toNum(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function UnderwritingCalculator({
  caseId,
  initial,
}: {
  caseId: string;
  initial: {
    equity: number | null;
    exitValue: number | null;
    exitMultiple: number | null;
    holdYears: number | null;
    leverage: number | null;
  };
}) {
  const [equity, setEquity] = useState(initial.equity?.toString() ?? "");
  const [exitValue, setExitValue] = useState(initial.exitValue?.toString() ?? "");
  const [exitMultiple, setExitMultiple] = useState(initial.exitMultiple?.toString() ?? "");
  const [holdYears, setHoldYears] = useState(initial.holdYears?.toString() ?? "");
  const [leverage, setLeverage] = useState(initial.leverage?.toString() ?? "");

  const eq = toNum(equity);
  const hy = toNum(holdYears);
  const preview =
    eq != null && eq > 0 && hy != null && (toNum(exitValue) != null || toNum(exitMultiple) != null)
      ? computeReturnsFromInputs({
          equity: eq,
          exitValue: toNum(exitValue),
          exitMultiple: toNum(exitMultiple),
          holdYears: hy,
        })
      : { irr: null, moic: null };

  const irrLabel = preview.irr != null ? `${(preview.irr * 100).toFixed(1)}%` : "—";
  const moicLabel = preview.moic != null ? `${preview.moic.toFixed(2)}x` : "—";

  return (
    <form action={saveUnderwritingInputs} className="mt-3 rounded-lg border border-line bg-surface-0 p-3">
      <input type="hidden" name="id" value={caseId} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Entry equity</span>
          <input
            name="equity"
            value={equity}
            onChange={(e) => setEquity(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Exit value</span>
          <input
            name="exitValue"
            value={exitValue}
            onChange={(e) => setExitValue(e.target.value)}
            inputMode="decimal"
            placeholder="—"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>or Exit ×</span>
          <input
            name="exitMultiple"
            value={exitMultiple}
            onChange={(e) => setExitMultiple(e.target.value)}
            inputMode="decimal"
            placeholder="—"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Hold yrs</span>
          <input
            name="holdYears"
            value={holdYears}
            onChange={(e) => setHoldYears(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Leverage</span>
          <input
            name="leverage"
            value={leverage}
            onChange={(e) => setLeverage(e.target.value)}
            inputMode="decimal"
            placeholder="opt."
            className={fieldClass}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 font-mono text-sm">
          <span className="text-fg-secondary">
            IRR <span className="text-gold-300">{irrLabel}</span>
          </span>
          <span className="text-fg-secondary">
            MOIC <span className="text-gold-300">{moicLabel}</span>
          </span>
          <span className="text-[10px] uppercase tracking-wider text-fg-muted">live preview</span>
        </div>
        <button className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
          Save &amp; compute
        </button>
      </div>
    </form>
  );
}
