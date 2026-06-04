import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger' | 'outline';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Lucide icon component rendered before the label, e.g. `icon={ArrowRight}`. */
  icon?: LucideIcon;
  /** Lucide icon component rendered after the label. */
  iconRight?: LucideIcon;
  children?: ReactNode;
}

/**
 * Button — the primary action primitive.
 *
 * Per the FundExecs OS design decision, `primary` is WHITE (not the
 * prototype's blue gradient). `gold` is reserved for the Earn Copilot and
 * gamification surfaces only.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-white text-[#070b14] hover:bg-slate-200 border border-transparent',
  secondary: 'bg-surface-2 text-fg-1 border border-hairline hover:bg-surface-3',
  ghost: 'bg-transparent text-fg-3 border border-transparent hover:bg-surface-1 hover:text-fg-1',
  gold: 'bg-gradient-to-br from-gold-1 to-gold-2 text-[#070b14] font-semibold border border-transparent hover:brightness-105',
  danger:
    'bg-[var(--danger-soft)] text-danger border border-[var(--danger-line)] hover:bg-[rgba(251,113,133,0.18)]',
  outline: 'bg-transparent text-fg-2 border border-hairline hover:bg-surface-2'
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'text-[12.5px] px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2.5 gap-2',
  lg: 'text-sm px-5 py-3 gap-2'
};

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 16 };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    className,
    children,
    type,
    ...props
  },
  ref
) {
  const iconSize = ICON_SIZE[size];
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className
      )}
      {...props}
    >
      {Icon && <Icon size={iconSize} strokeWidth={1.9} aria-hidden />}
      {children}
      {IconRight && <IconRight size={iconSize} strokeWidth={1.9} aria-hidden />}
    </button>
  );
});
