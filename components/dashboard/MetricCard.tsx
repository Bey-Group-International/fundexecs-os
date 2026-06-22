import type { DashboardMetric } from "@/lib/dashboard/types";

const TONE_CLASS: Record<NonNullable<DashboardMetric["tone"]>, string> = {
  good: "border-status-success/35 text-status-success",
  warn: "border-gold-500/45 text-gold-300",
  muted: "border-line text-fg-muted",
};

export function MetricCard({ metric }: { metric: DashboardMetric }) {
  return (
    <div className="fx-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          {metric.label}
        </p>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
            TONE_CLASS[metric.tone ?? "muted"]
          }`}
        >
          live
        </span>
      </div>
      <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
        {metric.value}
      </p>
      <p className="mt-1 text-xs leading-5 text-fg-muted">{metric.detail}</p>
    </div>
  );
}
