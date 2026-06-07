import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';
import { PERSONAS, type PersonaKey } from '@/components/dashboard/fixtures/personas';
import type { CommitmentScheduleRow, CommitmentSnapshot } from './types';

const STATUS_TONE: Record<CommitmentScheduleRow['status'], BadgeTone> = {
  committed: 'azure',
  called: 'success',
  distributed: 'gold',
  'in-progress': 'warning'
};

export interface CommitmentTrackerProps {
  snapshot: CommitmentSnapshot;
  className?: string;
}

/**
 * CommitmentTracker — four headline metrics + a per-LP schedule. The
 * schedule rows use the anonymized activity-ticker pattern that mirrors the
 * live www.fundexecs.com homepage: initials disc · persona label · city ·
 * committed/called · status pill. Persona labels map through
 * `components/dashboard/fixtures/personas.ts` so future re-shoots stay in
 * lockstep with the marketing site.
 */
export function CommitmentTracker({ snapshot, className }: CommitmentTrackerProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="lp-commitment-tracker">
      <SectionTitle
        eyebrow="Commitments · documented as they form"
        title="Capital, called and called out"
        className="mb-3"
      />

      <dl className="grid gap-2 sm:grid-cols-4">
        <SnapshotCell label="Committed" value={snapshot.committed} tone="azure" />
        <SnapshotCell label="Called" value={snapshot.called} tone="success" />
        <SnapshotCell label="Distributed" value={snapshot.distributed} tone="gold" />
        <SnapshotCell label="Remaining" value={snapshot.remaining} tone="neutral" />
      </dl>

      <div
        className="mt-4 mb-1 hidden grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-1 sm:grid"
        aria-hidden
      >
        {['LP', 'City', 'Committed', 'Called', 'Status'].map((h) => (
          <span key={h} className="text-[10px] font-semibold uppercase tracking-[0.11em] text-fg-5">
            {h}
          </span>
        ))}
      </div>

      {snapshot.schedule.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-hairline bg-surface-1 p-6 text-center">
          <p className="text-[12.5px] font-medium text-fg-2">No commitments mapped yet</p>
          <p className="mt-1 text-[11.5px] text-fg-4">
            Subscriptions will appear here as Sloane and Eleanor close each ticket.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {snapshot.schedule.map((row) => {
            const persona = PERSONAS[row.persona as PersonaKey];
            return (
              <li
                key={row.id}
                data-testid={`lp-commitment-row-${row.id}`}
                className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl px-1 py-2.5 transition-colors hover:bg-surface-1 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-2 text-[11px] font-semibold text-fg-2">
                    {row.initials}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold text-fg-1">{row.initials}</p>
                    <p className="truncate text-[10.5px] text-fg-4">
                      {persona?.label ?? row.persona}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 sm:contents">
                  <span className="hidden text-[11.5px] text-fg-3 sm:block">{row.city}</span>
                  <span className="hidden text-[12px] font-medium tabular-nums text-fg-2 sm:block">
                    {row.committed}
                  </span>
                  <span className="hidden text-[12px] tabular-nums text-fg-3 sm:block">
                    {row.called}
                  </span>
                  <Badge
                    tone={STATUS_TONE[row.status]}
                    className="justify-self-start text-[10px] uppercase"
                  >
                    {row.status}
                  </Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function SnapshotCell({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: 'azure' | 'success' | 'gold' | 'neutral';
}) {
  const toneClass = {
    azure: 'border-[var(--azure-line)] text-azure-1',
    success: 'border-[var(--success-line)] text-success',
    gold: 'border-[var(--gold-line)] text-gold-1',
    neutral: 'border-hairline text-fg-3'
  }[tone];
  return (
    <div
      className={cn('rounded-xl border bg-bg-1 px-3 py-2.5 shadow-[var(--shadow-sm)]', toneClass)}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
        {label}
      </span>
      <p className="mt-1 text-[20px] font-semibold tabular-nums tracking-[-0.018em] text-fg-1">
        {value}
      </p>
    </div>
  );
}
