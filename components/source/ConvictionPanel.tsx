import { Gauge, ChevronRight } from 'lucide-react';
import type { ConvictionBand } from '@/lib/intelligence/conviction';
import type { PipelineConviction } from '@/lib/queries/conviction';

/* The Deal Conviction Index panel: a portfolio glance (average + band mix) and
 * a ranked leaderboard of live deals, each with its score, band, and the single
 * highest-leverage next move. Pure read, key-free — computed from OS data. */

const BAND_TONE: Record<ConvictionBand, string> = {
  High: 'border-[var(--success-line)] bg-[var(--success-soft)] text-success',
  Building: 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1',
  Early: 'border-[var(--warning-line)] bg-[var(--warning-soft)] text-warning',
  Cold: 'border-hairline bg-surface-2 text-fg-3'
};

function scoreColor(score: number): string {
  if (score >= 75) return 'text-success';
  if (score >= 50) return 'text-azure-1';
  if (score >= 25) return 'text-warning';
  return 'text-fg-3';
}

export function ConvictionPanel({ conviction }: { conviction: PipelineConviction }) {
  const { results, distribution, average } = conviction;
  if (results.length === 0) return null;

  const top = results.slice(0, 6);

  return (
    <section className="mb-4 rounded-[14px] border border-hairline bg-surface-1 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge size={17} className="text-accent" aria-hidden />
          <h2 className="text-[14.5px] font-semibold text-fg-1">Deal Conviction Index</h2>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-fg-3">
          <span>
            Avg <span className={`font-semibold ${scoreColor(average)}`}>{average}</span>
          </span>
          <span aria-hidden>·</span>
          {(['High', 'Building', 'Early', 'Cold'] as ConvictionBand[]).map((b) =>
            distribution[b] > 0 ? (
              <span
                key={b}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${BAND_TONE[b]}`}
              >
                {distribution[b]} {b}
              </span>
            ) : null
          )}
        </div>
      </header>

      <p className="mt-1 text-[12.5px] text-fg-3">
        An explainable 0–100 read on each live deal — diligence, capital coverage, stage, and
        momentum — computed from your own data.
      </p>

      <ul className="mt-3 space-y-1.5">
        {top.map((r) => (
          <li
            key={r.dealId}
            className="flex items-center gap-3 rounded-[10px] border border-hairline bg-bg-1 px-3 py-2"
          >
            <span
              className={`w-8 flex-none text-[16px] font-bold tabular-nums ${scoreColor(r.score)}`}
            >
              {r.score}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-fg-1">{r.dealName}</div>
              <div className="flex items-center gap-1 truncate text-[11.5px] text-fg-4">
                <ChevronRight size={12} className="flex-none" aria-hidden />
                {r.topLever}
              </div>
            </div>
            <span
              className={`flex-none rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${BAND_TONE[r.band]}`}
            >
              {r.band}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
