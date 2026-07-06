"use client";

// Client panel for the Due-diligence data-room agent. The operator optionally
// picks a deal, pastes data-room text, runs the agent (via a server action, in a
// transition), and reads the resulting risk memo: an overall gauge derived from
// the pure aggregateRisk fn, findings grouped by lens with severity badges, and
// a subtle note when results came from the deterministic fallback (no API key).
import { useMemo, useState, useTransition } from "react";
import { runDiligenceAnalysis } from "@/components/run/diligence-agent-actions";
import {
  aggregateRisk,
  DILIGENCE_LENSES,
  type DiligenceLens,
  type Finding,
  type RiskLevel,
  type Severity,
} from "@/lib/diligence-agent";

interface DealOption {
  id: string;
  name: string;
}

const SEVERITY_BADGE: Record<Severity, string> = {
  low: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  critical: "border-red-500/40 bg-red-500/10 text-red-300",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const LEVEL_META: Record<RiskLevel, { label: string; ring: string; text: string; bar: string }> = {
  low: { label: "Low risk", ring: "border-emerald-500/40", text: "text-emerald-300", bar: "bg-emerald-500" },
  elevated: { label: "Elevated risk", ring: "border-amber-500/40", text: "text-amber-300", bar: "bg-amber-500" },
  high: { label: "High risk", ring: "border-orange-500/40", text: "text-orange-300", bar: "bg-orange-500" },
  severe: { label: "Severe risk", ring: "border-red-500/40", text: "text-red-300", bar: "bg-red-500" },
};

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${SEVERITY_BADGE[severity]}`}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

function RiskGauge({ score, level }: { score: number; level: RiskLevel }) {
  const meta = LEVEL_META[level];
  return (
    <div className={`rounded-xl border ${meta.ring} bg-surface-1 p-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-fg-muted">
            Overall risk
          </p>
          <p className={`mt-1 text-2xl font-semibold ${meta.text}`}>{meta.label}</p>
        </div>
        <div className="text-right">
          <span className={`font-mono text-3xl font-semibold tabular-nums ${meta.text}`}>{score}</span>
          <span className="ml-1 font-mono text-xs text-fg-muted">/100</span>
        </div>
      </div>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${meta.bar}`}
          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

export function DiligenceRoomPanel({ deals }: { deals: DealOption[] }) {
  const [dealId, setDealId] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [result, setResult] = useState<{ findings: Finding[]; source: "ai" | "fallback" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dealName = useMemo(
    () => deals.find((d) => d.id === dealId)?.name,
    [deals, dealId],
  );

  const risk = useMemo(
    () => (result ? aggregateRisk(result.findings) : null),
    [result],
  );

  // Group findings by lens, preserving the canonical lens order for display.
  const grouped = useMemo(() => {
    if (!result) return [] as Array<{ lens: DiligenceLens; label: string; items: Finding[] }>;
    return DILIGENCE_LENSES.map(({ key, label }) => ({
      lens: key,
      label,
      items: result.findings.filter((f) => f.lens === key),
    })).filter((g) => g.items.length > 0);
  }, [result]);

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await runDiligenceAnalysis({ dealName, dataRoomText: text });
        setResult(res);
      } catch {
        setError("The analysis failed to run. Please try again.");
      }
    });
  }

  const canRun = text.trim().length > 0 && !isPending;

  return (
    <div className="flex flex-col gap-6">
      <div className="fx-card p-5">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[220px_1fr] sm:items-start">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Deal (optional)
              </span>
              <select
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
                className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary focus:border-gold-500/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-400/50"
              >
                <option value="">No deal selected</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Data-room excerpt
              </span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="Paste memoranda, contracts, financials, disclosure schedules, or any data-room text…"
                className="min-h-[9rem] resize-y rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-400/50"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[10px] text-fg-muted">
              {text.trim().length > 0 ? `${text.trim().length.toLocaleString()} chars` : "Awaiting input"}
            </p>
            <button
              type="button"
              onClick={run}
              disabled={!canRun}
              className="inline-flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-surface-0 shadow-[0_10px_24px_-14px_rgb(var(--fx-accent-rgb)/0.85)] transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Analyzing…" : "Run diligence agent"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/6 p-4">
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {result && risk && (
        <div className="flex flex-col gap-5">
          <RiskGauge score={risk.score} level={risk.level} />

          {result.source === "fallback" && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/6 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
                Heuristic mode
              </p>
              <p className="mt-1 text-xs text-fg-secondary">
                Generated by the deterministic keyword scan — no model key is configured. Connect
                ANTHROPIC_API_KEY for a full AI-authored risk memo.
              </p>
            </div>
          )}

          {/* Per-lens rollup chips */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {DILIGENCE_LENSES.map(({ key, label }) => {
              const b = risk.byLens[key];
              return (
                <div key={key} className="rounded-lg border border-line bg-surface-1 px-3 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</p>
                  <p className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-medium tabular-nums text-fg-primary">{b.count}</span>
                    {b.top ? <SeverityBadge severity={b.top} /> : (
                      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">clear</span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Findings grouped by lens */}
          <div className="flex flex-col gap-5">
            {grouped.map((group) => (
              <div key={group.lens} className="rounded-xl border border-line bg-surface-1">
                <div className="border-b border-line bg-surface-2/30 px-4 py-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {group.label} · {group.items.length}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {group.items.map((f, i) => (
                    <li key={`${group.lens}-${i}`} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-fg-primary">{f.title}</p>
                        <SeverityBadge severity={f.severity} />
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-fg-secondary">{f.detail}</p>
                      <p className="mt-2 text-xs leading-5 text-fg-muted">
                        <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
                          Recommendation ·{" "}
                        </span>
                        {f.recommendation}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
