import type { ModuleSummary, Stat, FunnelStage, Tone } from "@/lib/source-stats";

const TEXT_TONE: Record<Tone, string> = {
  gold: "text-gold-300",
  success: "text-status-success",
  info: "text-status-info",
  muted: "text-fg-secondary",
  danger: "text-status-danger",
};

const BAR_TONE: Record<Tone, string> = {
  gold: "bg-gold-400",
  success: "bg-status-success",
  info: "bg-status-info",
  muted: "bg-fg-muted/50",
  danger: "bg-status-danger",
};

function StatCard({ stat }: { stat: Stat }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 px-3.5 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{stat.label}</div>
      <div className={`mt-1 font-display text-xl font-semibold ${stat.tone ? TEXT_TONE[stat.tone] : "text-fg-primary"}`}>
        {stat.value}
      </div>
      {stat.hint ? <div className="mt-0.5 text-[10px] text-fg-muted">{stat.hint}</div> : null}
    </div>
  );
}

function FunnelRow({ stage }: { stage: FunnelStage }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {stage.label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-[width] ${BAR_TONE[stage.tone]}`}
          style={{ width: stage.count === 0 ? "0%" : `${Math.max(6, stage.share * 100)}%` }}
        />
      </div>
      <span className="w-6 shrink-0 text-right font-mono text-[11px] text-fg-secondary">
        {stage.count}
      </span>
    </div>
  );
}

// The dashboard header for a Source module: a KPI strip over a stage/status
// funnel, both derived from the rows already on the page. Renders nothing when
// there are no rows yet (the empty state below it carries the call to action).
export function ModuleDashboard({ summary, empty }: { summary: ModuleSummary; empty: boolean }) {
  if (empty) return null;
  return (
    <div className="mb-5 space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {summary.stats.map((s) => (
          <StatCard key={s.label} stat={s} />
        ))}
      </div>
      {summary.funnel ? (
        <div className="rounded-xl border border-line bg-surface-1 p-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-gold-400">
            {summary.funnel.title}
          </div>
          <div className="space-y-2">
            {summary.funnel.stages.map((s) => (
              <FunnelRow key={s.key} stage={s} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
