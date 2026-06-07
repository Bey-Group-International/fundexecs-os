import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { FundProfile } from '@/lib/queries/fund-profile';

function toneForScore(score: number): { color: string; bg: string; label: string } {
  if (score >= 75) return { color: 'var(--success)', bg: 'var(--success-soft)', label: 'Strong' };
  if (score >= 50) return { color: 'var(--accent)', bg: 'var(--accent-soft)', label: 'Solid' };
  if (score >= 25) return { color: 'var(--warning)', bg: 'var(--warning-soft)', label: 'Building' };
  return { color: 'var(--danger)', bg: 'var(--danger-soft)', label: 'Gap' };
}

export interface FundProfileHeroProps {
  profile: FundProfile;
  className?: string;
}

/**
 * FundProfileHero — the Source-of-Truth header. Eyebrow voice ("Source of Truth
 * · documented as it forms"), fund name + manager identity, an inline ring gauge
 * for the LP-probed completeness, and a CTA to extend the profile via the
 * onboarding/quiz surface. Solid `bg-bg-1` everywhere.
 */
export function FundProfileHero({ profile, className }: FundProfileHeroProps) {
  const tone = toneForScore(profile.completenessScore);
  const gaugeC = 2 * Math.PI * 42;
  const dashOffset = gaugeC - (profile.completenessScore / 100) * gaugeC;
  const manager = profile.managerName ?? 'Unassigned manager';

  return (
    <Card
      data-testid="fund-profile-hero"
      className={cn('relative overflow-hidden p-[18px]', className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(70% 130% at 0% 0%, rgba(247,201,72,0.10), transparent 60%), radial-gradient(60% 100% at 100% 0%, rgba(91,141,239,0.08), transparent 65%)'
        }}
      />

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            Source of Truth · documented as it forms
          </p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-fg-1 sm:text-[28px]">
            {profile.fundName}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-fg-3">
            Manager · {manager}
            {profile.fundTier ? ` · ${profile.fundTier}` : null}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="azure" dot className="text-[10.5px]">
              On the record
            </Badge>
            <Badge tone="gold" className="text-[10.5px]">
              {profile.memberType ?? 'member type unset'}
            </Badge>
            {profile.focusAreas.slice(0, 3).map((fa) => (
              <span
                key={fa}
                className="rounded-full border border-hairline bg-surface-1 px-2 py-0.5 text-[10.5px] text-fg-3"
              >
                {fa}
              </span>
            ))}
          </div>

          <p className="mt-3 max-w-[60ch] text-[12px] text-fg-3">
            Everything an LP would probe — thesis, strategy, target raise, terms, track record, and
            team — kept in one canonical place. Earn drafts, you approve, the Chain of Trust
            captures the proof.
          </p>

          <Link
            href="/onboarding"
            data-testid="fund-profile-edit-cta"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-transparent bg-[var(--cta-gradient)] px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[var(--shadow-cta)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {profile.completenessScore >= 100
              ? 'Open profile'
              : profile.completenessScore > 0
                ? 'Resume profile'
                : 'Start profile'}
            <ArrowRight size={13} strokeWidth={2} aria-hidden />
          </Link>
        </div>

        {/* Completeness ring */}
        <div
          className="flex flex-col items-center gap-2 sm:w-[180px]"
          data-testid="fund-profile-completeness"
        >
          <div className="relative h-[140px] w-[140px]">
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
                stroke={tone.color}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={gaugeC}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="text-[30px] font-semibold tabular-nums leading-none tracking-[-0.02em]"
                style={{ color: tone.color }}
              >
                {profile.completenessScore}%
              </span>
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                Documented
              </span>
            </div>
          </div>
          <span
            className="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: tone.color, borderColor: tone.color, backgroundColor: tone.bg }}
          >
            {tone.label}
          </span>
          <p className="text-center text-[10.5px] text-fg-4">
            {profile.gaps.length === 0
              ? 'Every LP-probed field on the record.'
              : `${profile.gaps.length} gap${profile.gaps.length === 1 ? '' : 's'} for Earn to close.`}
          </p>
        </div>
      </div>
    </Card>
  );
}
