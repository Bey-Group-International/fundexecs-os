"use client";

// components/run/ContractReviewPanel.tsx
// Run › Contract Review — the interactive surface. The operator optionally picks
// a known contract (for labeling) or pastes contract text, then runs a
// CUAD-style clause & risk review (via the reviewContract server action). Results
// render as a findings table (clause · present? · risk · excerpt · redline), an
// overall risk score/level (computed client-side with the pure assessContract),
// a "missing protective clauses" callout, and a subtle fallback note when the
// review ran without an API key. Styling follows the app design tokens and dark
// mode, consistent with ContractStatusBoard.tsx.
import { useMemo, useState, useTransition } from "react";
import { reviewContract } from "@/components/run/contract-review-actions";
import {
  assessContract,
  CLAUSE_TYPE_BY_KEY,
  type Finding,
  type RiskLevel,
  type OverallLevel,
} from "@/lib/contract-review";
import type { ContractOption } from "@/components/run/ContractReviewModule";

const RISK_BADGE: Record<RiskLevel, string> = {
  none: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  low: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  high: "border-red-500/40 bg-red-500/10 text-red-300",
};

const LEVEL_META: Record<OverallLevel, { label: string; cls: string }> = {
  low: { label: "Low Risk", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  moderate: { label: "Moderate Risk", cls: "border-blue-500/40 bg-blue-500/10 text-blue-300" },
  elevated: { label: "Elevated Risk", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  high: { label: "High Risk", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
};

function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${RISK_BADGE[risk]}`}
    >
      {risk}
    </span>
  );
}

export function ContractReviewPanel({ contracts }: { contracts: ContractOption[] }) {
  const [contractId, setContractId] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [source, setSource] = useState<"ai" | "fallback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedTitle = contracts.find((c) => c.id === contractId)?.title;

  const assessment = useMemo(
    () => (findings ? assessContract(findings) : null),
    [findings],
  );

  function run() {
    setError(null);
    if (text.trim().length === 0) {
      setError("Paste the contract text to review.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await reviewContract({ title: selectedTitle, text });
        setFindings(res.findings);
        setSource(res.source);
      } catch {
        setError("Review failed. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Input */}
      <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          M&amp;A Contract Review
        </h3>

        {contracts.length > 0 && (
          <label className="mb-3 block">
            <span className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              Contract (optional — for labeling)
            </span>
            <select
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-400/50"
            >
              <option value="">— None —</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            Contract text
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Paste the contract text here…"
            className="w-full resize-y rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-400/50"
          />
        </label>

        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={isPending}
            className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-400/50"
          >
            {isPending ? "Reviewing…" : "Run review"}
          </button>
          {selectedTitle && (
            <span className="font-mono text-[10px] text-fg-muted">Reviewing: {selectedTitle}</span>
          )}
        </div>
      </div>

      {/* Results */}
      {findings && assessment && (
        <>
          {/* Overall score */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Overall Risk Score
              </p>
              <p className="mt-1 text-3xl font-semibold text-fg-primary">
                {assessment.score}
                <span className="ml-1 text-base text-fg-muted">/100</span>
              </p>
            </div>
            <span
              className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${LEVEL_META[assessment.level].cls}`}
            >
              {LEVEL_META[assessment.level].label}
            </span>
          </div>

          {/* Missing protective clauses */}
          {assessment.missing.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/6 p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
                ⚠ Missing protective clauses — {assessment.missing.length}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {assessment.missing.map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-amber-500/30 bg-amber-500/8 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Findings table */}
          <div className="rounded-2xl border border-line bg-surface-1">
            <div className="border-b border-line bg-surface-2/30 px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Clause Findings · {findings.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      Clause
                    </th>
                    <th className="px-2 py-2 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      Present
                    </th>
                    <th className="px-2 py-2 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      Risk
                    </th>
                    <th className="px-2 py-2 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      Excerpt
                    </th>
                    <th className="px-4 py-2 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      Suggested Redline
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {findings.map((f) => (
                    <tr key={f.clause_type} className="align-top">
                      <td className="px-4 py-2 font-medium text-fg-primary">
                        {CLAUSE_TYPE_BY_KEY[f.clause_type]?.label ?? f.clause_type}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`font-mono text-[10px] ${f.present ? "text-emerald-300" : "text-fg-muted"}`}
                        >
                          {f.present ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <RiskBadge risk={f.risk} />
                      </td>
                      <td className="px-2 py-2 max-w-[16rem] text-xs text-fg-secondary">
                        {f.excerpt ? <span className="italic">“{f.excerpt}”</span> : <span className="text-fg-muted">—</span>}
                      </td>
                      <td className="px-4 py-2 max-w-[18rem] text-xs text-fg-secondary">
                        {f.redline ?? <span className="text-fg-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fallback note */}
          {source === "fallback" && (
            <p className="font-mono text-[9px] text-fg-muted">
              Heuristic review (no model key configured) — keyword/regex scan. Connect
              ANTHROPIC_API_KEY for a full AI-generated clause analysis.
            </p>
          )}
        </>
      )}
    </div>
  );
}
