import { Users, Anchor } from 'lucide-react';
import type { LpConcentrationBand, LpConcentration } from '@/lib/intelligence/lp-concentration';

/* LP Concentration & Commitment Health panel: how concentrated the committed
 * capital base is across LPs, and whether one anchor dominates the fund. Pure
 * read, key-free — from the commitments the OS already holds. Renders nothing
 * until there is committed capital. */

const BAND_TONE: Record<LpConcentrationBand, string> = {
  'Single-anchor': 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger',
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

export function LpConcentrationPanel({ data }: { data: LpConcentration }) {
  if (data.lpCount === 0) return null;

  return (
    <section className="mb-4 rounded-[14px] border border-hairline bg-surface-1 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users size={17} className="text-accent" aria-hidden />
          <h2 className="text-[14.5px] font-semibold text-fg-1">LP concentration</h2>
        </div>
        <span
          className={`flex-none rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${BAND_TONE[data.band]}`}
        >
          {data.band}
        </span>
      </header>

      <p className="mt-1 text-[12.5px] text-fg-3">{data.headline}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="rounded-full border border-hairline bg-bg-1 px-2 py-0.5 text-fg-3">
          {fmtUsd(data.totalCommitted)} committed
        </span>
        <span className="rounded-full border border-hairline bg-bg-1 px-2 py-0.5 text-fg-3">
          Top 3 <span className="font-semibold text-fg-1">{data.top3Share}%</span>
        </span>
        <span className="rounded-full border border-hairline bg-bg-1 px-2 py-0.5 text-fg-3">
          {data.lpCount} LP{data.lpCount === 1 ? '' : 's'}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5">
        {data.ranked.map((l) => {
          const isAnchor = data.topLp?.lpId === l.lpId && data.band !== 'Diversified';
          return (
            <li
              key={l.lpId}
              className="flex items-center gap-3 rounded-[10px] border border-hairline bg-bg-1 px-3 py-2"
            >
              {isAnchor ? (
                <Anchor size={14} className="flex-none text-danger" aria-hidden />
              ) : (
                <Users size={14} className="flex-none text-fg-4" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-medium text-fg-1">{l.lpName}</span>
                  <span className="flex-none text-[11.5px] tabular-nums text-fg-4">
                    {fmtUsd(l.amount)} · {l.share}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${isAnchor ? 'bg-danger' : 'bg-accent'}`}
                    style={{ width: `${Math.min(100, l.share)}%` }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
