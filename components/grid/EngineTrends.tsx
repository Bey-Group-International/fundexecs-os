import Link from "next/link";
import { engineSlug } from "@/lib/execution-grid";
import type { EngineTrend } from "@/lib/grid-trends";

// Render a single engine's weekly completed counts as a compact inline-SVG
// sparkline — no chart lib, just a polyline. Flat baseline when there's no
// throughput so empty engines still read cleanly.
function Sparkline({ counts }: { counts: number[] }) {
  const w = 88;
  const h = 24;
  const pad = 2;
  const max = Math.max(1, ...counts);
  const span = Math.max(1, counts.length - 1);
  const points = counts
    .map((c, i) => {
      const x = pad + (i / span) * (w - pad * 2);
      const y = h - pad - (c / max) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className="text-gold-300/80"
      aria-hidden
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A compact trends strip: per-engine sparkline of weekly completed throughput,
// in canonical order. Presentational + pure.
export function EngineTrends({ trends }: { trends: EngineTrend[] }) {
  return (
    <section className="mx-auto mb-5 max-w-6xl rounded-2xl border border-line/80 bg-surface-1/70 p-4 shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold-400">Engine Trends</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            Weekly completed throughput · last {trends[0]?.series.length ?? 0} weeks
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        {trends.map((trend) => {
          const counts = trend.series.map((p) => p.completed);
          const latest = counts.length ? counts[counts.length - 1] : 0;
          return (
            <div
              key={trend.engine}
              className="flex flex-col rounded-xl border border-line/50 bg-surface-0/40 px-2.5 py-2"
            >
              <Link
                href={`/grid/${engineSlug(trend.engine)}`}
                className="truncate font-display text-[11px] font-semibold text-fg-secondary transition hover:text-gold-300"
              >
                {trend.engine}
              </Link>
              <div className="mt-1.5">
                <Sparkline counts={counts} />
              </div>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                {latest} this week
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
