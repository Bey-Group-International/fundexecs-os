// lib/portfolio-analytics.ts
// Portfolio Health analytics — Portfolio Pilot clone.
// Allocation analysis, concentration risk, performance vs underwrite.

export interface AllocationBreakdown {
  dimension: "sector" | "geography" | "asset_class";
  buckets: AllocationBucket[];
  totalNAV: number;
}

export interface AllocationBucket {
  label: string;
  value: number;       // NAV value
  pct: number;         // % of total
  targetPct?: number;  // from fund thesis
  delta?: number;      // actual - target
  isOverweight?: boolean;
  isUnderweight?: boolean;
}

export interface PortfolioHealthScore {
  overall: number;    // 0-100
  performance: number;
  diversification: number;
  momentum: number;
  grade: "A" | "B" | "C" | "D" | "F";
  summary: string;
}

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export interface ConcentrationRisk {
  type: "sector" | "geography" | "single_asset" | "tenant";
  label: string;
  actualPct: number;
  thresholdPct: number;
  severity: RiskSeverity;
  affectedAssets: string[];
  recommendation: string;
}

// Grade a portfolio health score
export function gradeScore(score: number): PortfolioHealthScore["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

// Compute a simple portfolio health score from metrics
export function computePortfolioHealth(params: {
  avgMOIC: number;
  targetMOIC: number;
  underperformingCount: number;
  totalAssets: number;
  maxConcentrationPct: number;
  riskAlertCount: number;
}): PortfolioHealthScore {
  const { avgMOIC, targetMOIC, underperformingCount, totalAssets, maxConcentrationPct } = params;

  // Performance score (0-40): how close is actual MOIC to target?
  const moicRatio = targetMOIC > 0 ? Math.min(avgMOIC / targetMOIC, 1.5) : 1;
  const performance = Math.min(40, Math.round(moicRatio * 30));

  // Diversification score (0-40): low concentration = high score
  const concentrationPenalty = Math.max(0, (maxConcentrationPct - 20) * 1.5);
  const diversification = Math.max(0, Math.min(40, 40 - concentrationPenalty));

  // Momentum score (0-20): few underperforming assets
  const underperformRatio = totalAssets > 0 ? underperformingCount / totalAssets : 0;
  const momentum = Math.round((1 - underperformRatio) * 20);

  const overall = Math.round(performance + diversification + momentum);
  const grade = gradeScore(overall);

  const summary =
    grade === "A"
      ? "Portfolio is tracking above underwrite with healthy diversification."
      : grade === "B"
        ? "Portfolio is on track. Watch concentration in a few positions."
        : grade === "C"
          ? "Portfolio needs attention — some positions are underperforming target."
          : "Portfolio has material risks. Rebalancing recommended.";

  return { overall, performance, diversification, momentum, grade, summary };
}

// Format MOIC for display
export function formatMOIC(moic: number | null | undefined): string {
  if (!moic) return "—";
  return `${moic.toFixed(2)}x`;
}

// Format IRR for display
export function formatIRR(irr: number | null | undefined): string {
  if (irr === null || irr === undefined) return "—";
  return `${irr.toFixed(1)}%`;
}

// Variance label: actual vs underwrite
export function varianceLabel(actual: number | null | undefined, target: number | null | undefined): string {
  if (!actual || !target || target === 0) return "—";
  const delta = ((actual - target) / target) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

// Risk severity → display
export const SEVERITY_STYLES: Record<RiskSeverity, { border: string; text: string; bg: string }> = {
  critical: { border: "border-red-500/50", text: "text-red-400", bg: "bg-red-500/10" },
  high: { border: "border-amber-500/40", text: "text-amber-400", bg: "bg-amber-500/8" },
  medium: { border: "border-yellow-500/30", text: "text-yellow-400", bg: "bg-yellow-500/8" },
  low: { border: "border-blue-500/30", text: "text-blue-400", bg: "bg-blue-500/8" },
};
