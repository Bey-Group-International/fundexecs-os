import Link from "next/link";
import { engineSlug } from "@/lib/execution-grid";
import type { EngineAnalytics as EngineAnalyticsData } from "@/lib/grid-analytics";

// Format an average cycle time (hours) for display, null-safe.
function cycle(avgCycleHours: number | null): string {
  if (avgCycleHours === null) return "—";
  if (avgCycleHours < 1) return `${Math.round(avgCycleHours * 60)}m`;
  if (avgCycleHours < 48) return `${avgCycleHours.toFixed(1)}h`;
  return `${(avgCycleHours / 24).toFixed(1)}d`;
}

// A compact analytics strip above the grid: org-wide rollup plus per-engine
// throughput and cycle-time mini-stats. Presentational + pure.
export function EngineAnalytics({ analytics }: { analytics: EngineAnalyticsData }) {
  const { engines, rollup } = analytics;
  return (
    <section className="mx-auto mb-5 max-w-6xl rounded-2xl border border-line/80 bg-surface-1/70 p-4 shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold-400">Engine Analytics</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            {rollup.total} routed · {rollup.active} active · {rollup.completed} done · {cycle(rollup.avgCycleHours)} avg cycle
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        {engines.map((stat) => (
          <div
            key={stat.engine}
            className="flex flex-col rounded-xl border border-line/50 bg-surface-0/40 px-2.5 py-2"
          >
            <Link
              href={`/grid/${engineSlug(stat.engine)}`}
              className="truncate font-display text-[11px] font-semibold text-fg-secondary transition hover:text-gold-300"
            >
              {stat.engine}
            </Link>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              {stat.total} total · {stat.active} active · {stat.completed} done
            </p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-gold-300/80">
              {cycle(stat.avgCycleHours)} avg cycle
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
