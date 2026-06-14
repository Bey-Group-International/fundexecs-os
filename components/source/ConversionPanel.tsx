import { Filter, TrendingDown } from 'lucide-react';
import type { ConversionAnalytics } from '@/lib/intelligence/conversion';

/* Pipeline Conversion panel: the formation funnel and where it leaks. Pure read,
 * key-free — cumulative reach + stage-to-stage conversion from the current deal
 * distribution. Renders nothing when the funnel is empty. */

export function ConversionPanel({ data }: { data: ConversionAnalytics }) {
  if (data.totalDeals === 0) return null;

  return (
    <section className="mb-4 rounded-[14px] border border-hairline bg-surface-1 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter size={17} className="text-accent" aria-hidden />
          <h2 className="text-[14.5px] font-semibold text-fg-1">Conversion funnel</h2>
        </div>
        <span className="flex-none rounded-full border border-hairline bg-bg-1 px-2 py-0.5 text-[11.5px] text-fg-3">
          {data.overallConversionPct}% to committed
        </span>
      </header>

      <p className="mt-1 text-[12.5px] text-fg-3">{data.headline}</p>

      <ul className="mt-3 space-y-1.5">
        {data.stages
          .filter((s) => s.reached > 0)
          .map((s) => {
            const isLeak = data.biggestLeak !== null && data.biggestLeak.toLabel === s.label;
            const barPct = data.totalDeals > 0 ? (s.reached / data.totalDeals) * 100 : 0;
            return (
              <li
                key={s.key}
                className="flex items-center gap-3 rounded-[10px] border border-hairline bg-bg-1 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-fg-1">
                      {s.label}
                      {isLeak && (
                        <TrendingDown size={12} className="flex-none text-danger" aria-hidden />
                      )}
                    </span>
                    <span className="flex-none text-[11.5px] tabular-nums text-fg-4">
                      {s.reached} · {s.conversionFromPrev}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${isLeak ? 'bg-danger' : 'bg-accent'}`}
                      style={{ width: `${Math.min(100, barPct)}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
      </ul>

      {data.biggestLeak && (
        <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-fg-4">
          <TrendingDown size={12} className="flex-none text-danger" aria-hidden />
          {data.biggestLeak.lost} lost {data.biggestLeak.fromLabel} → {data.biggestLeak.toLabel} (
          {data.biggestLeak.conversionPct}% through)
        </p>
      )}
    </section>
  );
}
