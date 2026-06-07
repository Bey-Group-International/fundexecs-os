import { Award, Lock } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Achievement } from '@/lib/queries/gamification';

export interface AchievementGridProps {
  achievements: Achievement[];
  /** When true, a small "coming soon" note marks this as pre-Phase-2 scaffold. */
  placeholder?: boolean;
  className?: string;
}

/**
 * AchievementGrid — earned vs locked milestone badges. Earned badges glow gold
 * (reward = gold, per the design lint); locked badges read as quiet, honest
 * placeholders with a lock. In-flight badges show a thin progress bar. Until
 * Phase 2 lands the loader returns locked launch badges, so this renders an
 * honest "not yet earned" wall rather than faking progress.
 */
export function AchievementGrid({ achievements, placeholder, className }: AchievementGridProps) {
  const earnedCount = achievements.filter((a) => a.earned).length;

  return (
    <Card className={cn('p-5', className)} data-testid="achievement-grid">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="Achievements · milestones" title="What you've proven" />
        <span className="text-[10.5px] font-semibold tabular-nums text-fg-4">
          {earnedCount}/{achievements.length} earned
        </span>
      </div>

      {achievements.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-5 text-center text-[12px] text-fg-3">
          Milestone badges will appear here as you put work on the record.
        </p>
      ) : (
        <ul
          className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="achievement-grid-items"
        >
          {achievements.map((a) => (
            <li
              key={a.id}
              data-testid={`achievement-${a.id}`}
              data-earned={a.earned}
              className={cn(
                'flex items-start gap-3 rounded-xl border bg-bg-1 px-3 py-3 transition-colors',
                a.earned
                  ? 'border-[var(--gold-line)] bg-[var(--gold-soft)] shadow-[var(--shadow-sm)]'
                  : 'border-hairline opacity-80'
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex h-9 w-9 flex-none items-center justify-center rounded-xl',
                  a.earned ? 'bg-[var(--gold-soft)] text-gold-1' : 'bg-surface-2 text-fg-5'
                )}
              >
                {a.earned ? (
                  <Award size={17} strokeWidth={2} aria-hidden />
                ) : (
                  <Lock size={15} strokeWidth={2} aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'truncate text-[12.5px] font-semibold',
                    a.earned ? 'text-gold-1' : 'text-fg-1'
                  )}
                >
                  {a.title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-fg-3">
                  {a.description}
                </p>
                {!a.earned && a.progress != null ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className="block h-full rounded-full bg-azure-1"
                        style={{ width: `${Math.max(0, Math.min(100, a.progress))}%` }}
                      />
                    </span>
                    <span className="text-[10px] font-semibold tabular-nums text-fg-4">
                      {a.progress}%
                    </span>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {placeholder ? (
        <p className="mt-3 text-[10.5px] text-fg-4">
          Preview · badges unlock automatically once Earn&rsquo;s intelligence comes online.
        </p>
      ) : null}
    </Card>
  );
}

export default AchievementGrid;
