// components/execute/PortfolioHealthLive.tsx
// Execute › Asset Management — live data wiring for the Portfolio Health
// Dashboard. Server component: resolves org context, reads the held portfolio
// via the Portfolio Monitor aggregator (assets + latest valuation marks +
// totals), derives a health score, per-asset metrics, and concentration risk
// alerts, then renders the presentational dashboard. Every load is best-effort —
// any failure (no org, query error, exception) degrades to a zeroed/neutral
// empty state rather than throwing, so the page always renders cleanly.
import { getSessionContext } from "@/lib/auth";
import { getPortfolioMonitor } from "@/lib/portfolio-monitor";
import {
  computePortfolioHealth,
  type ConcentrationRisk,
  type PortfolioHealthScore,
  type RiskSeverity,
} from "@/lib/portfolio-analytics";
import { PortfolioHealthDashboard } from "@/components/execute/PortfolioHealthDashboard";

// The presentational dashboard's per-asset row shape.
interface AssetMetric {
  id: string;
  name: string;
  sector: string;
  geography: string;
  assetClass: string;
  moic: number | null;
  irr: number | null;
  underwriteMOIC: number | null;
  equityInvested: number | null;
  currentValue: number | null;
  concentrationPct: number | null;
  isUnderperforming: boolean;
  holdPeriodMonths: number | null;
}

interface PortfolioHealthData {
  healthScore: PortfolioHealthScore;
  assets: AssetMetric[];
  riskAlerts: ConcentrationRisk[];
  totalNAV: number;
}

// Neutral empty state — no assets, no alerts, a zeroed/F-grade score.
const EMPTY: PortfolioHealthData = {
  healthScore: {
    overall: 0,
    performance: 0,
    diversification: 0,
    momentum: 0,
    grade: "F",
    summary: "No held positions yet — add assets to see portfolio health.",
  },
  assets: [],
  riskAlerts: [],
  totalNAV: 0,
};

// Single-asset concentration threshold (% of NAV) above which a position is
// flagged as a risk, and the severity bands beyond it.
const SINGLE_ASSET_THRESHOLD = 25;

function severityForConcentration(pct: number): RiskSeverity {
  if (pct >= 50) return "critical";
  if (pct >= 40) return "high";
  if (pct >= 33) return "medium";
  return "low";
}

async function loadPortfolioHealth(): Promise<PortfolioHealthData> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return EMPTY;

    const monitor = await getPortfolioMonitor(ctx.orgId);
    if (!monitor.hasData || monitor.assets.length === 0) return EMPTY;

    const totalNAV = monitor.totals.nav;

    const assets: AssetMetric[] = monitor.assets.map((a) => ({
      id: a.id,
      name: a.name,
      sector: a.fundName ?? a.assetType,
      geography: a.assetType,
      assetClass: a.assetType,
      moic: a.moic,
      irr: null,
      underwriteMOIC: null,
      equityInvested: a.cost,
      currentValue: a.nav,
      concentrationPct: a.concentrationPct,
      isUnderperforming: a.moic != null && a.moic < 1,
      holdPeriodMonths: null,
    }));

    const underperformingCount = assets.filter((a) => a.isUnderperforming).length;
    const maxConcentrationPct = monitor.assets.reduce(
      (max, a) => Math.max(max, a.concentrationPct),
      0,
    );

    const healthScore = computePortfolioHealth({
      avgMOIC: monitor.totals.weightedMoic ?? 0,
      // No underwrite target is stored on assets; treat 1.0x (cost) as the
      // baseline so the performance score reflects unrealized gain vs. cost.
      targetMOIC: 1,
      underperformingCount,
      totalAssets: assets.length,
      maxConcentrationPct,
      riskAlertCount: monitor.alerts.length,
    });

    // Concentration risk alerts: any single position above the threshold.
    const riskAlerts: ConcentrationRisk[] = monitor.assets
      .filter((a) => a.concentrationPct >= SINGLE_ASSET_THRESHOLD)
      .map((a) => ({
        type: "single_asset",
        label: `${a.name} — ${a.concentrationPct.toFixed(0)}% of NAV`,
        actualPct: a.concentrationPct,
        thresholdPct: SINGLE_ASSET_THRESHOLD,
        severity: severityForConcentration(a.concentrationPct),
        affectedAssets: [a.name],
        recommendation:
          "Position exceeds the single-asset concentration limit — consider trimming or hedging exposure.",
      }));

    return { healthScore, assets, riskAlerts, totalNAV };
  } catch {
    // Best-effort: any failure degrades to the neutral empty state.
    return EMPTY;
  }
}

export async function PortfolioHealthLive() {
  const { healthScore, assets, riskAlerts, totalNAV } = await loadPortfolioHealth();

  return (
    <section>
      <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
        Portfolio Health
      </p>
      <PortfolioHealthDashboard
        healthScore={healthScore}
        assets={assets}
        riskAlerts={riskAlerts}
        totalNAV={totalNAV}
      />
    </section>
  );
}
