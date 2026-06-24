"use client";

// components/execute/PortfolioHealthDashboard.tsx
// Portfolio Health Dashboard — Portfolio Pilot clone.
// Shows health score, allocation breakdown, risk alerts, and per-asset metrics.
import {
  formatMOIC,
  formatIRR,
  varianceLabel,
  SEVERITY_STYLES,
} from "@/lib/portfolio-analytics";
import type { ConcentrationRisk, PortfolioHealthScore } from "@/lib/portfolio-analytics";

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

interface Props {
  healthScore: PortfolioHealthScore;
  assets: AssetMetric[];
  riskAlerts: ConcentrationRisk[];
  totalNAV: number;
}

function HealthScoreRing({ score, grade }: { score: number; grade: string }) {
  const color =
    score >= 85 ? "text-emerald-400" : score >= 70 ? "text-yellow-400" : score >= 55 ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <span className={`font-display text-5xl font-bold tabular-nums ${color}`}>{score}</span>
      <span className={`rounded-full border px-3 py-1 font-mono text-sm font-bold ${color} border-current/30 bg-current/10`}>
        Grade {grade}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Portfolio Health</span>
    </div>
  );
}

function RiskAlertCard({ risk }: { risk: ConcentrationRisk }) {
  const styles = SEVERITY_STYLES[risk.severity];
  return (
    <div className={`rounded-xl border p-4 ${styles.border} ${styles.bg}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-medium ${styles.text}`}>{risk.label}</p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider border-current/30 ${styles.text}`}>
          {risk.severity}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-fg-secondary">{risk.recommendation}</p>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full transition-all ${risk.severity === "critical" ? "bg-red-500" : risk.severity === "high" ? "bg-amber-500" : "bg-yellow-500"}`}
              style={{ width: `${Math.min(100, (risk.actualPct / (risk.thresholdPct * 1.5)) * 100)}%` }}
            />
          </div>
        </div>
        <span className={`font-mono text-xs ${styles.text}`}>
          {risk.actualPct.toFixed(0)}% / {risk.thresholdPct.toFixed(0)}% limit
        </span>
      </div>
    </div>
  );
}

function AssetRow({ asset }: { asset: AssetMetric }) {
  const variance = varianceLabel(asset.moic, asset.underwriteMOIC);
  const variancePositive = asset.moic !== null && asset.underwriteMOIC !== null && asset.moic >= asset.underwriteMOIC;

  return (
    <div className={`flex items-center gap-4 border-b border-line px-4 py-3 last:border-0 transition hover:bg-surface-2/40 ${asset.isUnderperforming ? "bg-red-500/[0.03]" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg-primary">{asset.name}</p>
        <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
          {asset.sector} · {asset.geography}
        </p>
      </div>
      <div className="hidden w-16 text-right sm:block">
        <p className="font-mono text-sm font-semibold text-fg-primary">{formatMOIC(asset.moic)}</p>
        <p className="font-mono text-[10px] text-fg-muted">MOIC</p>
      </div>
      <div className="hidden w-16 text-right md:block">
        <p className="font-mono text-sm text-fg-secondary">{formatIRR(asset.irr)}</p>
        <p className="font-mono text-[10px] text-fg-muted">IRR</p>
      </div>
      <div className="hidden w-20 text-right lg:block">
        <p className={`font-mono text-xs ${variancePositive ? "text-emerald-400" : "text-red-400"}`}>
          {variance}
        </p>
        <p className="font-mono text-[10px] text-fg-muted">vs UW</p>
      </div>
      <div className="hidden w-16 text-right lg:block">
        <p className="font-mono text-xs text-fg-secondary">
          {asset.concentrationPct !== null ? `${asset.concentrationPct.toFixed(1)}%` : "—"}
        </p>
        <p className="font-mono text-[10px] text-fg-muted">NAV %</p>
      </div>
      {asset.isUnderperforming && (
        <span className="shrink-0 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-mono text-[9px] text-red-400">
          Under UW
        </span>
      )}
    </div>
  );
}

export function PortfolioHealthDashboard({ healthScore, assets, riskAlerts, totalNAV }: Props) {
  // Guard: no assets yet — show a clean onboarding state instead of a
  // meaningless Grade F with all-zero sub-scores.
  if (assets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface-1 p-10 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 text-gold-400">
          ◇
        </div>
        <p className="mt-3 text-sm font-medium text-fg-primary">Portfolio health score builds here</p>
        <p className="mt-1 text-xs text-fg-secondary">
          Add assets in Asset Management — once you have holdings, your NAV,
          MOIC, diversification score, and grade will populate here automatically.
        </p>
      </div>
    );
  }

  const totalAssets = assets.length;
  const underperforming = assets.filter((a) => a.isUnderperforming).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Health score + sub-scores */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="sm:col-span-1 flex items-center justify-center rounded-xl border border-line bg-surface-1 p-6">
          <HealthScoreRing score={healthScore.overall} grade={healthScore.grade} />
        </div>
        <div className="sm:col-span-3 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Performance", score: healthScore.performance, max: 40, desc: "vs underwrite targets" },
            { label: "Diversification", score: healthScore.diversification, max: 40, desc: "concentration risk" },
            { label: "Momentum", score: healthScore.momentum, max: 20, desc: "portfolio trajectory" },
          ].map((sub) => (
            <div key={sub.label} className="rounded-xl border border-line bg-surface-1 p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{sub.label}</p>
              <p className="mt-2 font-display text-2xl font-bold text-fg-primary">
                {sub.score}
                <span className="ml-1 font-mono text-sm text-fg-muted">/{sub.max}</span>
              </p>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-yellow-500/60" style={{ width: `${(sub.score / sub.max) * 100}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-fg-muted">{sub.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
        <p className="text-sm text-fg-secondary">{healthScore.summary}</p>
        <div className="mt-2 flex flex-wrap gap-4">
          <span className="font-mono text-xs text-fg-muted">{totalAssets} assets · ${(totalNAV / 1_000_000).toFixed(1)}M NAV</span>
          {underperforming > 0 && (
            <span className="font-mono text-xs text-red-400">{underperforming} underperforming</span>
          )}
        </div>
      </div>

      {/* Risk alerts */}
      {riskAlerts.length > 0 && (
        <section>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
            Risk Alerts · {riskAlerts.length}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {riskAlerts.map((risk, i) => (
              <RiskAlertCard key={i} risk={risk} />
            ))}
          </div>
        </section>
      )}

      {/* Asset table */}
      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
          Portfolio Positions · {assets.length}
        </h3>
        <div className="rounded-xl border border-line bg-surface-1">
          <div className="flex items-center gap-4 border-b border-line bg-surface-2/30 px-4 py-2.5">
            <span className="min-w-0 flex-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Asset</span>
            <span className="hidden w-16 text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted sm:block">MOIC</span>
            <span className="hidden w-16 text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted md:block">IRR</span>
            <span className="hidden w-20 text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted lg:block">vs UW</span>
            <span className="hidden w-16 text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted lg:block">NAV %</span>
          </div>
          {assets.map((asset) => (
            <AssetRow key={asset.id} asset={asset} />
          ))}
        </div>
      </section>
    </div>
  );
}
