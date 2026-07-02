"use client";

export interface FunnelStage {
  label: string;
  count: number;
  convertedFrom: number | null;
  avgDaysInStage: number | null;
  staleDealIds: string[];
}

function conversionColor(rate: number): string {
  if (rate >= 50) return "text-emerald-300";
  if (rate >= 25) return "text-gold-400";
  return "text-status-danger";
}

export function DealStageFunnel({ stages }: { stages: FunnelStage[] }) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);
  const totalDeals = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="bg-surface-0 border border-line rounded-2xl p-6 flex flex-col gap-6 w-full max-w-lg">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-lg font-semibold text-fg-primary">Deal Stage Funnel</h2>
        <p className="text-xs text-fg-muted">
          PipelineRoad-style pipeline view with conversion rates and stale alerts.
        </p>
      </div>

      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-fg-muted uppercase tracking-widest font-mono">Total across all stages</span>
        <span className="text-sm font-mono font-semibold text-fg-primary">{totalDeals}</span>
      </div>

      <div className="flex flex-col gap-3">
        {stages.map((stage, i) => {
          const widthPct = Math.max((stage.count / maxCount) * 100, 15);
          const conversionRate =
            stage.convertedFrom !== null && stage.convertedFrom > 0
              ? Math.round((stage.count / stage.convertedFrom) * 100)
              : null;

          return (
            <div key={stage.label} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-fg-secondary font-medium">{stage.label}</span>
                  {conversionRate !== null && (
                    <span className={`font-mono ${conversionColor(conversionRate)}`}>
                      ({conversionRate}%)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {stage.avgDaysInStage !== null && (
                    <span className="font-mono text-fg-muted">{stage.avgDaysInStage}d avg</span>
                  )}
                  {stage.staleDealIds.length > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-surface-1 border border-line font-mono text-status-danger text-xs">
                      {stage.staleDealIds.length} stale
                    </span>
                  )}
                  <span className="font-mono font-semibold text-fg-primary w-6 text-right">
                    {stage.count}
                  </span>
                </div>
              </div>

              <div className="h-7 w-full flex items-center">
                <div
                  className="h-full rounded-lg bg-surface-1 border border-line flex items-center px-2 transition-all"
                  style={{ width: `${widthPct}%` }}
                >
                  <div
                    className="h-2 rounded-full bg-gold-300 opacity-60"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
