import { type LucideIcon } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface KpiTileProps {
  /** Top eyebrow label (caps + tracking). */
  label: string;
  /** Primary value (pre-formatted string — use `$182M`, `15`, `78%`, etc.). */
  value: string;
  /** Optional unit suffix shown alongside the value (e.g. “deals”). */
  unit?: string;
  /** Optional one-line subtext under the value. */
  sub?: string;
  /** Optional pill (e.g. "+12% MoM"). Color via `tone`. */
  pill?: { label: string; tone?: BadgeTone };
  /** Optional decorative icon, top-right. */
  icon?: LucideIcon;
  /** Soft accent color for the icon chip. Defaults to azure. */
  tone?: 'azure' | 'gold' | 'success' | 'warning' | 'neutral';
  className?: string;
}

const TONE_BG: Record<NonNullable<KpiTileProps['tone']>, string> = {
  azure: 'bg-[var(--azure-soft)] text-azure-1 border-[var(--azure-line)]',
  gold: 'bg-[var(--gold-soft)] text-gold-1 border-[var(--gold-line)]',
  success: 'bg-[var(--success-soft)] text-success border-[var(--success-line)]',
  warning: 'bg-[var(--warning-soft)] text-warning border-[var(--warning-line)]',
  neutral: 'bg-surface-2 text-fg-3 border-hairline'
};

/**
 * KpiTile — reusable headline-number card used across every dashboard.
 * Tabular figures, small icon chip, optional delta pill. Tone is muted by
 * default; reserve `gold` for Earn/XP only.
 */
export function KpiTile({
  label,
  value,
  unit,
  sub,
  pill,
  icon: Icon,
  tone = 'azure',
  className
}: KpiTileProps) {
  return (
    <div
      className={cn(
        'flex h-full flex-col justify-between rounded-2xl border border-hairline bg-bg-1 p-4 shadow-[var(--shadow-sm)]',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            {label}
          </p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
              {value}
            </span>
            {unit ? (
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-4">
                {unit}
              </span>
            ) : null}
          </div>
          {sub ? <p className="mt-1 text-[11.5px] text-fg-4">{sub}</p> : null}
        </div>
        {Icon ? (
          <span
            className={cn(
              'flex h-9 w-9 flex-none items-center justify-center rounded-xl border',
              TONE_BG[tone]
            )}
          >
            <Icon size={16} strokeWidth={1.9} aria-hidden />
          </span>
        ) : null}
      </div>
      {pill ? (
        <div className="mt-3">
          <Badge tone={pill.tone ?? 'azure'} className="text-[10px]">
            {pill.label}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}
