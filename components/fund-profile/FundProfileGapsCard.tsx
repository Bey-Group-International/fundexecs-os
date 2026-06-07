import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { FundProfile, FundProfileGap } from '@/lib/queries/fund-profile';

const SEVERITY_META: Record<
  FundProfileGap['severity'],
  { tone: BadgeTone; color: string; icon: LucideIcon }
> = {
  missing: { tone: 'danger', color: 'var(--danger)', icon: AlertTriangle },
  weak: { tone: 'warning', color: 'var(--warning)', icon: AlertTriangle }
};

export interface FundProfileGapsCardProps {
  profile: FundProfile;
  className?: string;
}

/**
 * FundProfileGapsCard — the LP-probe list. Each gap names the field, says why
 * an LP cares, and routes to the surface that closes it. Solid bg-bg-1 rows
 * with severity-tinted icon discs. The empty state is the win state.
 */
export function FundProfileGapsCard({ profile, className }: FundProfileGapsCardProps) {
  const { gaps } = profile;

  return (
    <Card className={cn('p-5', className)} data-testid="fund-profile-gaps">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="LP probe · audit-ready" title="Gaps an LP would press on" />
        {gaps.length === 0 ? (
          <Badge tone="success" dot className="text-[10px]">
            Clear
          </Badge>
        ) : (
          <Badge tone="warning" className="text-[10px]">
            {gaps.length}
          </Badge>
        )}
      </div>

      {gaps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-6 text-center">
          <ShieldCheck size={18} strokeWidth={1.9} className="mx-auto text-success" aria-hidden />
          <p className="mt-2 text-[12.5px] font-medium text-fg-2">
            Every LP-probed field on the record.
          </p>
          <p className="mt-0.5 text-[11px] text-fg-4">
            Earn keeps it current — audit-ready, documented as it forms.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="fund-profile-gaps-list">
          {gaps.map((gap) => {
            const meta = SEVERITY_META[gap.severity];
            const Icon = meta.icon;
            return (
              <li key={`${gap.field}-${gap.severity}`}>
                <Link
                  href="/onboarding"
                  data-testid={`fund-profile-gap-${gap.field}`}
                  className="group flex items-start gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 transition-[background,transform,box-shadow] hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-sm)]"
                >
                  <span
                    aria-hidden
                    className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border bg-bg-1"
                    style={{ color: meta.color, borderColor: meta.color }}
                  >
                    <Icon size={14} strokeWidth={2} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={meta.tone} className="text-[9.5px] uppercase">
                        {gap.severity}
                      </Badge>
                      <p className="truncate text-[12.5px] font-semibold text-fg-1">{gap.label}</p>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-fg-3">{gap.reason}</p>
                  </div>
                  <ArrowUpRight
                    size={13}
                    strokeWidth={2}
                    className="mt-1 flex-none text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-azure-1"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
