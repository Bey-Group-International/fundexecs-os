"use client";

// OpenVC / Fintrx-style thesis alignment breakdown panel.
// Shows per-dimension pass/fail for check size, geography, investor type,
// and target IRR — giving the GP a clear read on exactly why an LP fits or doesn't.
import type { Investor, InvestmentThesis } from "@/lib/supabase/database.types";

interface Props {
  investor: Investor;
  thesis: InvestmentThesis | null;
}

interface Dimension {
  label: string;
  weight: number;          // max points this dimension contributes
  earned: number;          // points earned
  status: "pass" | "partial" | "fail" | "unknown";
  detail: string;
}

function fmt(v: number | null, suffix = ""): string {
  if (v === null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(0)}M${suffix}`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K${suffix}`;
  return `$${v}${suffix}`;
}

function buildDimensions(investor: Investor, thesis: InvestmentThesis): Dimension[] {
  const dims: Dimension[] = [];

  // ── Check size (45 pts) ──────────────────────────────────────────────────
  const invMin = investor.typical_check_min;
  const invMax = investor.typical_check_max;
  const thMin = thesis.check_size_min;
  const thMax = thesis.check_size_max;
  if (invMin !== null || invMax !== null) {
    const lo = invMin ?? 0;
    const hi = invMax ?? Infinity;
    const tLo = thMin ?? 0;
    const tHi = thMax ?? Infinity;
    const overlaps = hi >= tLo && lo <= tHi;
    dims.push({
      label: "Check Size",
      weight: 45,
      earned: overlaps ? 45 : 0,
      status: overlaps ? "pass" : "fail",
      detail: overlaps
        ? `${fmt(invMin)}–${fmt(invMax)} overlaps mandate band (${fmt(thMin)}–${fmt(thMax)})`
        : `${fmt(invMin)}–${fmt(invMax)} is outside mandate band (${fmt(thMin)}–${fmt(thMax)})`,
    });
  } else {
    dims.push({
      label: "Check Size",
      weight: 45,
      earned: 0,
      status: "unknown",
      detail: "No check-size range on record for this LP",
    });
  }

  // ── Geography (30 pts) ───────────────────────────────────────────────────
  if (investor.jurisdiction && thesis.geographies.length) {
    const j = investor.jurisdiction.toLowerCase();
    const match = thesis.geographies.some(
      (g) => g.toLowerCase().includes(j) || j.includes(g.toLowerCase()),
    );
    dims.push({
      label: "Geography",
      weight: 30,
      earned: match ? 30 : 0,
      status: match ? "pass" : "fail",
      detail: match
        ? `${investor.jurisdiction} is in target geographies: ${thesis.geographies.join(", ")}`
        : `${investor.jurisdiction} is not in target geographies: ${thesis.geographies.join(", ")}`,
    });
  } else if (!investor.jurisdiction) {
    dims.push({
      label: "Geography",
      weight: 30,
      earned: 0,
      status: "unknown",
      detail: "No jurisdiction on record for this LP",
    });
  } else {
    dims.push({
      label: "Geography",
      weight: 30,
      earned: 15,
      status: "partial",
      detail: "Thesis has no geography requirement — open to all",
    });
  }

  // ── Investor type (25 pts) ───────────────────────────────────────────────
  const typeScore: Record<string, number> = {
    institution: 25, fund_of_funds: 25, family_office: 20,
    lp: 18, co_gp: 12, bank: 10, lender: 8, other: 0,
  };
  const typeLabel: Record<string, string> = {
    institution: "Institutional LP", fund_of_funds: "Fund of Funds",
    family_office: "Family Office", lp: "LP",
    co_gp: "Co-GP", bank: "Bank", lender: "Lender", other: "Other",
  };
  const ts = typeScore[investor.investor_type] ?? 5;
  dims.push({
    label: "Investor Type",
    weight: 25,
    earned: ts,
    status: ts >= 20 ? "pass" : ts >= 10 ? "partial" : "fail",
    detail:
      ts >= 20
        ? `${typeLabel[investor.investor_type] ?? investor.investor_type} — strong fit for institutional fund raises`
        : ts >= 10
        ? `${typeLabel[investor.investor_type] ?? investor.investor_type} — moderate fit`
        : `${typeLabel[investor.investor_type] ?? investor.investor_type} — limited mandate fit`,
  });

  // ── IRR expectations (bonus signal) ─────────────────────────────────────
  if (thesis.target_irr !== null) {
    dims.push({
      label: "Target IRR",
      weight: 0,
      earned: 0,
      status: "unknown",
      detail: `Fund targets ${thesis.target_irr}% IRR — confirm LP aligns with this return expectation`,
    });
  }

  return dims;
}

const STATUS_META = {
  pass: { icon: "✓", tone: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30" },
  partial: { icon: "~", tone: "text-gold-400", bg: "bg-gold-400/10 border-gold-400/30" },
  fail: { icon: "✗", tone: "text-status-danger", bg: "bg-status-danger/10 border-status-danger/30" },
  unknown: { icon: "?", tone: "text-fg-muted", bg: "bg-surface-2 border-line" },
};

export function ThesisAlignmentBreakdown({ investor, thesis }: Props) {
  if (!thesis) {
    return (
      <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          Thesis Alignment
        </h3>
        <p className="text-sm text-fg-muted">
          Set an active mandate in{" "}
          <a href="/settings/mandate" className="underline hover:text-fg-primary">
            Settings → Mandate
          </a>{" "}
          to see per-dimension alignment.
        </p>
      </div>
    );
  }

  const dims = buildDimensions(investor, thesis);
  const totalEarned = dims.reduce((s, d) => s + d.earned, 0);
  const totalWeight = dims.filter((d) => d.weight > 0).reduce((s, d) => s + d.weight, 0);
  const score = totalWeight > 0 ? Math.round((totalEarned / totalWeight) * 100) : 0;

  const passes = dims.filter((d) => d.status === "pass").length;
  const fails = dims.filter((d) => d.status === "fail").length;

  return (
    <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          Thesis Alignment
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-sm font-bold ${
              score >= 70 ? "text-emerald-400" : score >= 35 ? "text-gold-400" : "text-fg-muted"
            }`}
          >
            {score}
            <span className="text-xs font-normal">/100</span>
          </span>
        </div>
      </div>

      {/* Summary bar */}
      <div className="mb-3 flex items-center gap-1.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full transition-all ${
              score >= 70 ? "bg-emerald-400" : score >= 35 ? "bg-gold-400" : "bg-fg-muted"
            }`}
            style={{ width: `${score}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-fg-muted">
          {passes} pass · {fails} fail
        </span>
      </div>

      {/* Dimension rows */}
      <div className="flex flex-col gap-2">
        {dims.map((dim) => {
          const meta = STATUS_META[dim.status];
          return (
            <div
              key={dim.label}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${meta.bg}`}
            >
              <span className={`mt-0.5 shrink-0 font-mono text-xs font-bold ${meta.tone}`}>
                {meta.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-fg-primary">{dim.label}</span>
                  {dim.weight > 0 && (
                    <span className="font-mono text-[9px] text-fg-muted">
                      {dim.earned}/{dim.weight} pts
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">{dim.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
