import { Card, SectionTitle } from '@/components/ui';
import type { ReadinessDimensionScore } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';

const DIMENSION_LABEL: Record<ReadinessDimensionScore['dimension'], string> = {
  profile: 'Profile',
  proof: 'Proof',
  materials: 'Materials',
  pipeline: 'Pipeline',
  capital: 'Capital'
};

const DIMENSION_HINT: Record<ReadinessDimensionScore['dimension'], string> = {
  profile: 'Source of Truth completeness',
  proof: 'Chain-of-Trust depth',
  materials: 'Decks · memos · governance',
  pipeline: 'LP / deal universe depth',
  capital: 'Progress against target raise'
};

const DIMENSION_HREF: Record<ReadinessDimensionScore['dimension'], string> = {
  profile: '/profile',
  proof: '/trust',
  materials: '/materials',
  pipeline: '/pipeline',
  capital: '/capital-stack'
};

function toneForScore(score: number): { color: string; bg: string; label: string } {
  if (score >= 75) return { color: 'var(--success)', bg: 'var(--success-soft)', label: 'Strong' };
  if (score >= 50) return { color: 'var(--accent)', bg: 'var(--accent-soft)', label: 'Solid' };
  if (score >= 25) return { color: 'var(--warning)', bg: 'var(--warning-soft)', label: 'Building' };
  return { color: 'var(--danger)', bg: 'var(--danger-soft)', label: 'Gap' };
}

export interface ReadinessGaugeProps {
  /** 0–100 institutional-readiness score. */
  score: number;
  /** Per-dimension breakdown (always the same 5 entries in display order). */
  breakdown: ReadinessDimensionScore[];
  className?: string;
}

/**
 * ReadinessGauge — the headline 0–100 institutional-readiness number with
 * its five-dimension breakdown rendered beside it. Each dimension links to
 * the surface that closes that gap (Fund Profile, Trust Center, Materials,
 * Pipeline, Capital Stack). Tone-coded so a quick glance tells the manager
 * where the weakness sits.
 */
export function ReadinessGauge({ score, breakdown, className }: ReadinessGaugeProps) {
  const overall = toneForScore(score);
  const gaugeCircumference = 2 * Math.PI * 42;
  const dashOffset = gaugeCircumference - (score / 100) * gaugeCircumference;

  return (
    <Card className={cn('p-5', className)} data-testid="readiness-gauge">
      <SectionTitle
        eyebrow="Institutional readiness"
        title="How investable, today"
        className="mb-3"
      />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {/* Headline ring */}
        <div className="flex flex-col items-center gap-2 sm:w-[150px]">
          <div className="relative h-[120px] w-[120px]" data-testid="readiness-gauge-ring">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="var(--surface-2)"
                strokeWidth="8"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke={overall.color}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={gaugeCircumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="text-[26px] font-semibold tabular-nums tracking-[-0.02em]"
                style={{ color: overall.color }}
              >
                {score}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                / 100
              </span>
            </div>
          </div>
          <span
            className="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]"
            style={{
              color: overall.color,
              borderColor: overall.color,
              backgroundColor: overall.bg
            }}
          >
            {overall.label}
          </span>
        </div>

        {/* Five-dim breakdown */}
        <ul
          className="grid w-full gap-1.5 sm:grid-cols-2 lg:grid-cols-1"
          data-testid="readiness-gauge-breakdown"
        >
          {breakdown.map((dim) => {
            const tone = toneForScore(dim.score);
            return (
              <li
                key={dim.dimension}
                data-testid={`readiness-dim-${dim.dimension}`}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2"
              >
                <a
                  href={DIMENSION_HREF[dim.dimension]}
                  className="flex w-32 flex-none flex-col"
                  aria-label={`${DIMENSION_LABEL[dim.dimension]} · ${dim.score}%`}
                >
                  <span className="text-[12px] font-semibold text-fg-1">
                    {DIMENSION_LABEL[dim.dimension]}
                  </span>
                  <span className="truncate text-[10.5px] text-fg-4">
                    {DIMENSION_HINT[dim.dimension]}
                  </span>
                </a>
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${dim.score}%`, backgroundColor: tone.color }}
                  />
                </div>
                <span
                  className="w-9 flex-none text-right text-[11.5px] font-semibold tabular-nums"
                  style={{ color: tone.color }}
                >
                  {dim.score}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
