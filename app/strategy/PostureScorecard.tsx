import { ShieldCheck } from 'lucide-react';
import { Badge, Card, ProgressBar, SectionTitle, type BadgeTone } from '@/components/ui';
import type { PostureBand, PostureResult } from '@/lib/strategy/posture';

/**
 * Institutional Posture scorecard for `/strategy`. Four pillars — Compliance ·
 * Governance · Execution · Capital — rolled into one composite that reads as
 * "how you operate vs. a seasoned investment firm." Every value comes from the
 * pure `computeInstitutionalPosture` over inputs the page already loads; nothing
 * is fabricated. Peer percentile and momentum Δ are deliberately absent (they
 * need the posture-snapshot table — a later phase).
 */
export interface PostureScorecardProps {
  posture: PostureResult;
}

const BAND_META: Record<PostureBand, { tone: BadgeTone; label: string }> = {
  institutional: { tone: 'success', label: 'Institutional' },
  emerging: { tone: 'gold', label: 'Emerging' },
  building: { tone: 'warning', label: 'Building' },
  unmeasured: { tone: 'neutral', label: 'Unmeasured' }
};

/** Per-pillar bar tone by its own standing, so weak pillars read at a glance. */
function pillarColor(score: number | null): string {
  if (score === null) return 'var(--fg-5)';
  if (score >= 75) return 'var(--success)';
  if (score >= 50) return 'var(--gold-1)';
  return 'var(--warning)';
}

export function PostureScorecard({ posture }: PostureScorecardProps) {
  const band = BAND_META[posture.band];

  return (
    <Card className="p-[18px]">
      <SectionTitle
        eyebrow="Institutional posture"
        title="How you operate vs. a seasoned firm"
        className="mb-3"
        action={
          <div className="flex items-baseline gap-2">
            {posture.composite !== null ? (
              <span className="text-[22px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-fg-1">
                {posture.composite}
                <span className="ml-0.5 text-[12px] font-medium text-fg-4">/ 100</span>
              </span>
            ) : (
              <span className="text-[12px] text-fg-4">Not yet measured</span>
            )}
            <Badge tone={band.tone} dot>
              {band.label}
            </Badge>
          </div>
        }
      />

      <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-fg-4">
        <ShieldCheck
          size={13}
          strokeWidth={1.9}
          className="mt-px flex-none text-fg-5"
          aria-hidden
        />
        <p className="max-w-2xl">
          The discipline LPs underwrite — compliance, governance, execution, and capital, rolled up
          from your Chain of Trust, operating plan, and raise. Close the weakest pillar first; each
          one compounds into the next.
        </p>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {posture.dimensions.map((d) => (
          <div key={d.key} className="rounded-[12px] border border-hairline bg-surface-1 p-3.5">
            <div className="flex items-baseline justify-between">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-3">
                {d.label}
              </dt>
              <dd className="text-[13px] font-semibold tabular-nums text-fg-1">
                {d.score === null ? <span className="text-fg-5">—</span> : d.score}
              </dd>
            </div>
            <div className="mt-2">
              <ProgressBar
                value={d.score ?? 0}
                color={pillarColor(d.score)}
                height={5}
                ariaLabel={`${d.label} posture`}
              />
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-fg-5">{d.cue}</p>
          </div>
        ))}
      </dl>
    </Card>
  );
}
