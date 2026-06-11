'use client';

import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'gold' | 'ghost' | 'outline';
export type ButtonSize = 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[linear-gradient(135deg,#3B74F0,#2152D8)] text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] hover:brightness-110',
  gold: 'bg-[linear-gradient(135deg,#F7C948,#E5A823)] text-[#070b14] shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_20px_-8px_rgba(247,201,72,0.55)] hover:brightness-105',
  ghost: 'bg-transparent text-fg-3 hover:bg-surface-2 hover:text-fg-1',
  outline: 'border border-hairline bg-surface-1 text-fg-2 hover:bg-surface-2 hover:text-fg-1'
};

const SIZES: Record<ButtonSize, string> = {
  md: 'px-4 py-2.5 text-[13.5px]',
  lg: 'px-6 py-3 text-[14.5px]'
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** The house button — prototype variants (primary blue, Earn gold, ghost). */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:pointer-events-none disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
