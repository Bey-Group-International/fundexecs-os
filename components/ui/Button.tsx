'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'gold' | 'ghost' | 'outline' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[linear-gradient(135deg,#3B74F0,#2152D8)] text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] hover:brightness-110',
  gold: 'bg-[linear-gradient(135deg,#F7C948,#E5A823)] text-[#070b14] shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_20px_-8px_rgba(247,201,72,0.55)] hover:brightness-105',
  ghost: 'bg-transparent text-fg-3 hover:bg-surface-2 hover:text-fg-1',
  outline: 'border border-hairline bg-surface-1 text-fg-2 hover:bg-surface-2 hover:text-fg-1',
  secondary: 'border border-hairline bg-surface-2 text-fg-1 hover:bg-surface-3',
  danger:
    'border border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger hover:bg-[rgba(251,113,133,0.18)]'
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-[12.5px]',
  md: 'px-4 py-2.5 text-[13.5px]',
  lg: 'px-6 py-3 text-[14.5px]'
};

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 16 };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Lucide icon component rendered before the label, e.g. `icon={ArrowRight}`. */
  icon?: LucideIcon;
  /** Lucide icon component rendered after the label. */
  iconRight?: LucideIcon;
}

/** The house button — prototype variants (primary blue, Earn gold, ghost…). */
export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  type,
  ...rest
}: ButtonProps) {
  const iconSize = ICON_SIZE[size];
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:pointer-events-none disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {Icon && <Icon size={iconSize} strokeWidth={1.9} aria-hidden />}
      {children}
      {IconRight && <IconRight size={iconSize} strokeWidth={1.9} aria-hidden />}
    </button>
  );
}
