import { cn } from '@/lib/utils';

export type BadgeTone = 'gold' | 'azure' | 'success' | 'neutral';

const TONES: Record<BadgeTone, string> = {
  gold: 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1',
  azure: 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1',
  success: 'border-[var(--success-line)] bg-[var(--success-soft)] text-success',
  neutral: 'border-hairline bg-surface-2 text-fg-3'
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Leading status dot. */
  dot?: boolean;
  /** Soft-pulse the dot ("live" framing). */
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Small tonal pill — eyebrow framing for status and beta marks. */
export function Badge({ tone = 'neutral', dot, pulse, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]',
        TONES[tone],
        className
      )}
    >
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full bg-current', pulse && 'fx-glow-pulse')}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
