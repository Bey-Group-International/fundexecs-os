import { TrendingUp } from 'lucide-react';
import type { MarketPulse } from '@/lib/queries/command-center';

function compactCapital(usd: number): string {
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  return `$${usd.toLocaleString()}`;
}

interface Props {
  pulse: MarketPulse;
}

export function MarketPulseCard({ pulse }: Props) {
  const hasData =
    pulse.totalCapitalUsd !== null ||
    pulse.dealCount !== null ||
    pulse.startupCount !== null ||
    pulse.topVerticals.length > 0;

  return (
    <section className="rounded-2xl border border-[var(--azure-line)] bg-bg-1 p-[18px]">
      {/* header */}
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1">
            <TrendingUp size={16} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Market pulse · BotMemo AI Funding Intelligence
            </div>
            <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
              {pulse.period ? `AI Funding · ${pulse.period}` : 'AI Funding Landscape'}
            </h2>
          </div>
        </div>
        <a
          href="https://botmemo.com/insights"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-none rounded-lg border border-hairline bg-surface-1 px-2.5 py-1 text-[10.5px] font-medium text-fg-4 transition hover:bg-surface-2 hover:text-fg-2"
        >
          Source ↗
        </a>
      </div>

      {hasData ? (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {pulse.totalCapitalUsd !== null && (
              <Stat
                label="Capital tracked"
                value={compactCapital(pulse.totalCapitalUsd)}
                period={pulse.period}
              />
            )}
            {pulse.dealCount !== null && (
              <Stat
                label="Deals tracked"
                value={pulse.dealCount.toLocaleString()}
                period={pulse.period}
              />
            )}
            {pulse.startupCount !== null && (
              <Stat label="AI startups indexed" value={`${pulse.startupCount.toLocaleString()}+`} />
            )}
          </div>

          {/* verticals */}
          {pulse.topVerticals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {pulse.topVerticals.map((v) => (
                <span
                  key={v}
                  className="inline-flex items-center rounded-full border border-[var(--azure-line)] bg-[var(--azure-soft)] px-2.5 py-0.5 text-[10.5px] font-medium text-azure-1"
                >
                  {v}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-fg-4">
          Market data syncs every 6 hours via the intelligence pipeline. Check back shortly.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  period,
}: {
  label: string;
  value: string;
  period?: string | null;
}) {
  return (
    <div className="rounded-[10px] border border-hairline bg-surface-1 px-3 py-2.5">
      <div className="text-[17px] font-semibold tracking-[-0.01em] [font-feature-settings:'tnum'] text-fg-1">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-fg-5">
        {label}
        {period ? ` · ${period}` : ''}
      </div>
    </div>
  );
}
