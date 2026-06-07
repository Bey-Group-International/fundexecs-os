import Link from 'next/link';
import { Target, Compass, Coins, Scale, History, Users, Plus } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { FundProfile } from '@/lib/queries/fund-profile';

/**
 * On-record / gap status chip shared by every section card. Makes the canonical
 * record scannable at a glance (green dot = documented, warning = an LP would
 * press on it). Uses the shared `Badge` so tone tokens stay consistent with the
 * Gaps card. No gold (reserved for Earn).
 */
function StatusChip({ present }: { present: boolean }) {
  return present ? (
    <Badge tone="success" dot className="flex-none text-[9.5px] uppercase tracking-[0.1em]">
      On record
    </Badge>
  ) : (
    <Badge tone="warning" className="flex-none text-[9.5px] uppercase tracking-[0.1em]">
      Add
    </Badge>
  );
}

function money(n: number | null): string {
  if (n == null || n <= 0) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export interface FundProfileSectionsProps {
  profile: FundProfile;
  className?: string;
}

/**
 * FundProfileSections — the six LP-probed sections rendered as compact cards
 * (thesis, strategy, target raise, terms, track record, team). Missing fields
 * render a calm hint instead of a fabrication. Read-mostly in Wave 1; the
 * primary edit path is the onboarding/quiz surface, which the Hero CTA opens.
 */
export function FundProfileSections({ profile, className }: FundProfileSectionsProps) {
  return (
    <div className={cn('grid gap-[18px] lg:grid-cols-2', className)}>
      <SectionCard
        icon={Target}
        eyebrow="Thesis · why now, why you"
        title="Investment thesis"
        body={profile.thesis}
        testid="fund-profile-thesis"
        empty="No thesis on the record yet — Earn drafts it from your strategy + track record when you give the go-ahead."
      />
      <SectionCard
        icon={Compass}
        eyebrow="Strategy · mandate fit"
        title="Stage · sector · geography"
        body={
          profile.strategy ??
          (profile.focusAreas.length > 0 ? profile.focusAreas.join(' · ') : null)
        }
        testid="fund-profile-strategy"
        empty="Set focus areas in the profile builder so LPs can read mandate fit at a glance."
      />
      <SectionCard
        icon={Coins}
        eyebrow="Target raise"
        title={money(profile.targetRaise)}
        body={
          profile.targetRaise && profile.targetRaise > 0
            ? 'The size LPs use to scale their check and assess concentration.'
            : null
        }
        testid="fund-profile-target-raise"
        empty="Size the raise so Earn can pace LP outreach against the goal."
      />
      <SectionCard
        icon={Scale}
        eyebrow="Terms · audit-ready"
        title="Fee · carry · structure"
        body={renderTerms(profile)}
        testid="fund-profile-terms"
        empty="Add fee, carry, and structure — LPs won't commit until all three are explicit."
      />
      <SectionCard
        icon={History}
        eyebrow="Track record"
        title="Prior deals · returns · highlights"
        body={renderTrackRecord(profile)}
        testid="fund-profile-track-record"
        empty="Track record is the biggest LP diligence item — list prior deals, returns, and notable exits."
      />
      <Card data-testid="fund-profile-team" className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <SectionTitle eyebrow="Team · LPs back people" title="Masthead" />
          <StatusChip present={profile.team.length > 0} />
        </div>
        {profile.team.length === 0 ? (
          <Link
            href="/onboarding"
            data-testid="fund-profile-team-empty"
            className="group block rounded-xl border border-dashed border-hairline bg-surface-1 p-4 text-center outline-none transition-[transform,box-shadow,background] hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-sm)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0"
          >
            <Users size={18} strokeWidth={1.9} className="mx-auto text-fg-4" aria-hidden />
            <p className="mt-2 text-[12px] text-fg-3">
              Name the GP and key team with their roles — Earn surfaces this to every LP.
            </p>
            <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
              Add the team
              <Plus size={12} strokeWidth={2.2} aria-hidden />
            </span>
          </Link>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {profile.team.map((m) => (
              <li
                key={`${m.name}-${m.role ?? ''}`}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2"
                data-testid={`fund-profile-team-${m.name.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-2 text-[11px] font-semibold text-fg-2">
                  {m.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((s) => s[0]?.toUpperCase() ?? '')
                    .join('')}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-semibold text-fg-1">{m.name}</p>
                  <p className="truncate text-[10.5px] text-fg-4">{m.role ?? 'Team member'}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  eyebrow,
  title,
  body,
  empty,
  testid
}: {
  icon: typeof Target;
  eyebrow: string;
  title: string;
  body: string | null;
  empty: string;
  testid: string;
}) {
  const present = Boolean(body && body.trim().length > 0);

  const inner = (
    <>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-9 w-9 flex-none items-center justify-center rounded-xl border bg-bg-1 transition-colors',
            present ? 'border-hairline bg-surface-1 text-azure-1' : 'text-warning'
          )}
          style={present ? undefined : { borderColor: 'var(--warning)' }}
        >
          <Icon size={15} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            {eyebrow}
          </p>
          <h3 className="mt-0.5 text-[15px] font-semibold tracking-[-0.012em] text-fg-1">
            {title}
          </h3>
        </div>
        <StatusChip present={present} />
      </div>
      <p
        className={cn(
          'mt-3 max-w-[60ch] text-[12.5px] leading-relaxed',
          present ? 'text-fg-2' : 'text-fg-4'
        )}
      >
        {present ? body : empty}
      </p>
    </>
  );

  // Present sections are read-mostly. A gap is a live invitation: make the whole
  // card a link into the profile builder so the empty state is actionable, not
  // a dead end (matching the Gaps card's behavior).
  if (present) {
    return (
      <Card data-testid={testid} className="p-5">
        {inner}
      </Card>
    );
  }
  return (
    <Link
      href="/onboarding"
      data-testid={testid}
      className="group block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0"
    >
      <Card className="p-5 transition-[transform,box-shadow] group-hover:-translate-y-0.5 group-hover:shadow-[var(--shadow-sm)]">
        {inner}
      </Card>
    </Link>
  );
}

function renderTerms(profile: FundProfile): string | null {
  const parts: string[] = [];
  if (profile.terms.managementFeePct != null) parts.push(`${profile.terms.managementFeePct}% mgmt`);
  if (profile.terms.carryPct != null) parts.push(`${profile.terms.carryPct}% carry`);
  if (profile.terms.structure) parts.push(profile.terms.structure);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function renderTrackRecord(profile: FundProfile): string | null {
  const parts: string[] = [];
  if (profile.trackRecord.priorDeals != null && profile.trackRecord.priorDeals > 0) {
    parts.push(`${profile.trackRecord.priorDeals} prior deals`);
  }
  if (profile.trackRecord.returnsSummary) parts.push(profile.trackRecord.returnsSummary);
  if (profile.trackRecord.highlights) parts.push(profile.trackRecord.highlights);
  return parts.length > 0 ? parts.join(' · ') : null;
}
