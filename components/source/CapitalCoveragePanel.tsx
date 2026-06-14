import { PieChart, Layers } from 'lucide-react';
import type { ConcentrationBand, CapitalCoverage } from '@/lib/intelligence/capital-coverage';

/* Capital Coverage & Concentration panel: how funded the live pipeline is and
 * how much exposure rides on a single name. Pure read, key-free — from deal
 * sizes the OS already holds. Renders nothing when there are no sized deals. */

const BAND_TONE: Record<ConcentrationBand, string> = {
  'Highly concentrated': 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger',
  Concentrated: 'border-[var(--warning-line)] bg-[var(--warning-soft)] text-warning',
  Balanced: 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1',
  Diversified: 'border-hairline bg-surface-2 text-fg-3'
};

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export function CapitalCoveragePanel({ data }: { data: CapitalCoverage }) {
  if (data.sizedDeals === 0) return null;

  return (
    <section className="mb-4 rounded-[14px] border border-hairline bg-surface-1 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PieChart size={17} className="text-accent" aria-hidden />
          <h2 className="text-[14.5px] font-semibold text-fg-1">Capital coverage</h2>
        </div>
        <span
          className={`flex-none rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${BAND_TONE[data.band]}`}
        >
          {data.band}
        </span>
      </header>

      <p className="mt-1 text-[12.5px] text-fg-3">{data.headline}</p>

      {/* Coverage bar — committed against pipeline target. */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11.5px] text-fg-4">
          <span>{fmtUsd(data.committed)} committed</span>
          <span>
            {data.coveragePct}% of {fmtUsd(data.pipelineValue)}
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.min(100, data.coveragePct)}%` }}
          />
        </div>
      </div>

      {/* Concentration read. */}
      {data.topDeal && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
          <span className="rounded-full border border-hairline bg-bg-1 px-2 py-0.5 text-fg-3">
            Top name <span className="font-semibold text-fg-1">{data.topDeal.share}%</span>
          </span>
          <span className="rounded-full border border-hairline bg-bg-1 px-2 py-0.5 text-fg-3">
            Top 3 <span className="font-semibold text-fg-1">{data.top3Share}%</span>
          </span>
          <span className="rounded-full border border-hairline bg-bg-1 px-2 py-0.5 text-fg-3">
            {fmtUsd(data.uncommitted)} to commit
          </span>
        </div>
      )}

      {/* Exposure by stage. */}
      <ul className="mt-3 space-y-1.5">
        {data.byStage.map((s) => (
          <li
            key={s.stage}
            className="flex items-center gap-3 rounded-[10px] border border-hairline bg-bg-1 px-3 py-2"
          >
            <Layers size={14} className="flex-none text-fg-4" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12.5px] font-medium capitalize text-fg-1">
                  {s.stage}
                </span>
                <span className="flex-none text-[11.5px] tabular-nums text-fg-4">
                  {fmtUsd(s.total)} · {s.share}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-gold-1"
                  style={{ width: `${Math.min(100, s.share)}%` }}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
