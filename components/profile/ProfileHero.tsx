import { Badge, Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { MEMBER_TYPE_LABELS } from '@/lib/member-types';
import type { FundProfile } from '@/lib/queries/fund-profile';
import { ProfileActionButton } from './ProfileActionButton';

function toneForScore(score: number): { color: string; bg: string; label: string } {
  if (score >= 75) return { color: 'var(--success)', bg: 'var(--success-soft)', label: 'Strong' };
  if (score >= 50) return { color: 'var(--accent)', bg: 'var(--accent-soft)', label: 'Solid' };
  if (score >= 25) return { color: 'var(--warning)', bg: 'var(--warning-soft)', label: 'Building' };
  return { color: 'var(--danger)', bg: 'var(--danger-soft)', label: 'Gap' };
}

/** One-line framing of what the Profile is, per member type. */
const PROFILE_BLURB: Record<string, string> = {
  investment_firm:
    'Everything an LP would probe — thesis, sectors, stage, and check size — kept in one canonical place. Earn drafts, you approve, the Chain of Trust captures the proof.',
  service_provider:
    'What every prospective client checks first — your category, services, ideal client, and how you engage — in one credible record. Earn drafts, you approve.',
  startup:
    'What every investor checks first — sector, stage, what you’re raising, and traction — in one credible record. Earn drafts, you approve.',
  individual_investor:
    'What founders and syndicate leads check first — your investor profile, check size, sectors, and value-add — in one place. Earn drafts, you approve.',
  student:
    'A credible introduction mentors and firms can trust — your institution, field, interests, and goals — documented as it forms.'
};

const DEFAULT_BLURB =
  'The canonical record every counterparty reads from — built as you onboard, documented as it forms. Earn drafts, you approve.';

export interface ProfileHeroProps {
  profile: FundProfile;
  className?: string;
}

/**
 * ProfileHero — the Source-of-Truth header. Eyebrow voice, entity name + owner
 * identity, an inline ring gauge for completeness, and a CTA to extend the
 * Profile via onboarding. Copy adapts to the member type so the framing is
 * right for funds, service providers, startups, investors, and students alike.
 */
export function ProfileHero({ profile, className }: ProfileHeroProps) {
  const tone = toneForScore(profile.completenessScore);
  const gaugeC = 2 * Math.PI * 42;
  const dashOffset = gaugeC - (profile.completenessScore / 100) * gaugeC;
  const owner = profile.managerName ?? 'Owner unassigned';
  const memberLabel = profile.memberType
    ? MEMBER_TYPE_LABELS[profile.memberType]
    : 'Member type unset';
  const blurb = (profile.memberType && PROFILE_BLURB[profile.memberType]) || DEFAULT_BLURB;

  return (
    <Card data-testid="profile-hero" className={cn('relative overflow-hidden p-[18px]', className)}>
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
            {owner}
            {profile.fundTier ? ` · ${profile.fundTier}` : null}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="azure" dot className="text-[10.5px]">
              On the record
            </Badge>
            <Badge tone="gold" className="text-[10.5px]">
              {memberLabel}
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

          <p className="mt-3 max-w-[60ch] text-[12px] text-fg-3">{blurb}</p>

          <ProfileActionButton variant="hero" profile={profile} className="mt-4" />
        </div>

        {/* Completeness ring */}
        <div
          className="flex flex-col items-center gap-2 sm:w-[180px]"
          data-testid="profile-completeness"
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
              ? 'Every required field on the record.'
              : `${profile.gaps.length} gap${profile.gaps.length === 1 ? '' : 's'} for Earn to close.`}
          </p>
        </div>
      </div>
    </Card>
  );
}
