import {
  Check,
  Lock,
  type LucideIcon,
  IdCard,
  Crosshair,
  FileCheck2,
  Landmark
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProfileLadderState, ProfileTierId } from '@/lib/proof-of-truth/tiers';

/* ----------------------------------------------------------------------------
 * ProfileLadder — the four-rung readiness ladder, rendered identically on the
 * Profile surface and inside the onboarding wizard. Each rung shows its state
 * (locked → in progress → complete) and the readiness it unlocks, so reaching
 * 100% reads as climbing to "Institutionally ready", not filling a form.
 *
 * Pure presentational (no client hooks, no server-only) so both the server page
 * and the client flow can import it.
 * --------------------------------------------------------------------------*/

const TIER_ICONS: Record<ProfileTierId, LucideIcon> = {
  identity: IdCard,
  mandate: Crosshair,
  evidence: FileCheck2,
  institutional: Landmark
};

export interface ProfileLadderProps {
  ladder: ProfileLadderState;
  /** 'full' = the Profile surface strip; 'compact' = the wizard header. */
  variant?: 'full' | 'compact';
  className?: string;
}

export function ProfileLadder({ ladder, variant = 'full', className }: ProfileLadderProps) {
  const compact = variant === 'compact';

  return (
    <div
      data-testid="profile-ladder"
      className={cn(
        'rounded-2xl border border-hairline bg-bg-1',
        compact ? 'p-3' : 'p-4 sm:p-5',
        className
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gold-1">
            Readiness ladder
          </span>
          {ladder.institutionalReady ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--success)] bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--success)]">
              <Check size={11} strokeWidth={2.6} aria-hidden />
              Institutionally ready
            </span>
          ) : (
            <span className="text-[10.5px] font-medium text-fg-4">
              {ladder.readinessTierId ? `Now: ${ladder.readinessLabel}` : 'Getting started'}
            </span>
          )}
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-fg-3">
          {ladder.overallPct}%
        </span>
      </div>

      <ol className="grid gap-2 sm:grid-cols-4">
        {ladder.tiers.map((rung) => {
          const Icon = TIER_ICONS[rung.tier.id];
          const isCurrent = rung.tier.id === ladder.currentTierId && !rung.complete;
          const state = rung.complete ? 'complete' : rung.locked ? 'locked' : 'active';
          return (
            <li
              key={rung.tier.id}
              data-testid={`ladder-rung-${rung.tier.id}`}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex flex-col gap-1.5 rounded-xl border px-3 py-2.5 transition-colors',
                state === 'complete' && 'border-[var(--gold-line)] bg-[var(--gold-soft)]',
                state === 'active' &&
                  isCurrent &&
                  'border-gold-1 bg-[var(--gold-soft)] shadow-[0_0_0_3px_var(--gold-soft)]',
                state === 'active' && !isCurrent && 'border-hairline bg-surface-1',
                state === 'locked' && 'border-hairline bg-surface-1 opacity-70'
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 flex-none items-center justify-center rounded-lg border',
                    state === 'complete'
                      ? 'border-[var(--gold-line)] text-gold-1'
                      : state === 'locked'
                        ? 'border-hairline text-fg-5'
                        : 'border-hairline text-fg-3'
                  )}
                >
                  {state === 'complete' ? (
                    <Check size={13} strokeWidth={2.6} aria-hidden />
                  ) : state === 'locked' ? (
                    <Lock size={12} strokeWidth={2} aria-hidden />
                  ) : (
                    <Icon size={13} strokeWidth={2} aria-hidden />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[11.5px] font-semibold text-fg-1">
                    {rung.tier.label}
                  </div>
                  <div className="truncate text-[10px] font-medium text-fg-4">
                    {rung.tier.readiness}
                  </div>
                </div>
                {rung.tier.id !== 'institutional' && (
                  <span className="ml-auto text-[10px] font-semibold tabular-nums text-fg-4">
                    {rung.pct}%
                  </span>
                )}
              </div>

              {rung.tier.id !== 'institutional' && (
                <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-gold-1 transition-[width] duration-500"
                    style={{ width: `${rung.pct}%` }}
                  />
                </div>
              )}

              {!compact && (
                <p className="text-[10.5px] leading-snug text-fg-4">
                  {rung.gaps > 0 && !rung.complete
                    ? `${rung.gaps} to close`
                    : rung.complete
                      ? 'On the record'
                      : rung.tier.blurb}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default ProfileLadder;
