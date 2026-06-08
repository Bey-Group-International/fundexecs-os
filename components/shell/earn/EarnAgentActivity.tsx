'use client';

import { TeamAvatar, getCOO, getMember, type TeamMember } from '@/lib/team';
import { cn } from '@/lib/utils';
import type { EarnContextKind } from './EarnContext';
import { copyFor, specialistsFor } from './EarnContextCopy';

export interface EarnAgentActivityProps {
  /** Current dock context — drives which specialists are "on point". */
  kind: EarnContextKind;
  /** True while a chat turn is in flight — escalates the strip to "working". */
  busy?: boolean;
  className?: string;
}

/**
 * EarnAgentActivity — the live desk strip in the Earn dock.
 *
 * Reacts to the operator's context: the specialists "on point" for the current
 * surface (deal → origination + counsel, capital-stack → capital formation,
 * etc.) light up with a pulse, led by Earn (the COO). While a chat turn is in
 * flight the line escalates to "coordinating the desk…"; otherwise it shows the
 * context's standing activity copy. Purely presentational — it reflects the
 * roster + context, no fabricated runtime telemetry.
 */
export function EarnAgentActivity({ kind, busy = false, className }: EarnAgentActivityProps) {
  const coo = getCOO();
  const specialists = specialistsFor(kind)
    .map((slug) => getMember(slug))
    .filter((m): m is TeamMember => m != null)
    .slice(0, 3);
  const onPoint: TeamMember[] = [coo, ...specialists];
  const lead = specialists[0];
  const status = busy
    ? `Earn is coordinating the desk${lead ? ` with ${lead.name.split(' ')[0]}` : ''}…`
    : copyFor(kind).activity;

  return (
    <div
      className={cn(
        'relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-hairline bg-bg-1 px-3 py-2',
        className
      )}
      data-testid="earn-agent-activity"
      data-busy={busy ? 'true' : 'false'}
    >
      {/* Overlapping avatars of who's on point. While Earn coordinates the
          desk they activate in sequence — a gentle staggered lift led by
          Earn (index 0) — via per-avatar animation-delay. Idle: calm pulse. */}
      <div className="flex flex-none -space-x-1.5">
        {onPoint.map((m, i) => (
          <span
            key={m.slug}
            className={cn(
              'relative inline-flex rounded-full ring-2 ring-bg-1',
              busy && 'fx-onpoint-cascade'
            )}
            style={{
              zIndex: onPoint.length - i,
              ...(busy ? { animationDelay: `${i * 0.16}s` } : null)
            }}
            title={`${m.name} · ${m.position}`}
          >
            <TeamAvatar member={m} size={22} className="flex-none" />
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              'inline-flex h-1.5 w-1.5 flex-none rounded-full bg-gold-1',
              busy && 'animate-pulse'
            )}
          />
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.11em] text-gold-1">
            {busy ? 'Working' : 'On the desk'}
          </span>
        </div>
        {/* Keyed on status so a context/busy change re-mounts the line and
            replays the fade — reads as a smooth handoff, not a hard swap. */}
        <p
          key={status}
          className={cn(
            'fx-status-fade mt-0.5 truncate text-[11px] text-fg-3',
            busy && 'animate-pulse'
          )}
        >
          {status}
        </p>
      </div>

      {/* Whisper-quiet working hairline — a transform-only sweep under the
          strip while Earn works. Gold stays reserved for Earn. */}
      {busy ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden"
        >
          <span className="fx-desk-shimmer block h-px w-1/3 bg-gradient-to-r from-transparent via-gold-1 to-transparent opacity-60" />
        </span>
      ) : null}
    </div>
  );
}

export default EarnAgentActivity;
