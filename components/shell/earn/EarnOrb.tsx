'use client';

import { X } from 'lucide-react';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';
import { useEarnContext } from './EarnContext';

export interface EarnOrbProps {
  /** Whether the Earn dock is currently open (flips the orb to a close affordance). */
  open: boolean;
  /** Toggle the Earn dock. */
  onToggle: () => void;
}

/**
 * EarnOrb — the floating circular gold Earn orb fixed bottom-right.
 *
 * Wave-1: surfaces a `data-context` attribute reflecting the current
 * `EarnContext.kind` so CSS-only `:has([data-context="deal"])` selectors in
 * `app/globals.css` can wear a context-specific pulse (no JS animation
 * logic). Click toggles the Earn dock.
 *
 * Gold is reserved for Earn, so the orb wears the gold glow ring. Animates
 * transform/opacity only — never transitions `color`.
 */
export function EarnOrb({ open, onToggle }: EarnOrbProps) {
  const earnCtx = useEarnContext();
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid="earn-orb"
      data-context={earnCtx.kind}
      aria-label={
        open ? 'Close Earn dock' : 'Earnest Fundmaker, Chief Operating Officer — open chat'
      }
      aria-expanded={open}
      className={cn(
        'earn-orb',
        'group fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full',
        'border border-[var(--gold-line)] bg-gradient-to-br from-gold-1 to-gold-2',
        'shadow-[0_8px_24px_-6px_rgba(247,201,72,0.55)] outline-none',
        'transition-transform duration-200 ease-[cubic-bezier(.22,.61,.36,1)] will-change-transform',
        'hover:-translate-y-0.5 hover:scale-[1.04] active:scale-95',
        'focus-visible:ring-2 focus-visible:ring-[var(--gold-line)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0'
      )}
    >
      {/* Soft pulsing gold halo */}
      <span
        className="pointer-events-none absolute inset-0 animate-pulse rounded-full bg-[radial-gradient(circle,rgba(247,201,72,0.35),transparent_70%)] blur-[6px]"
        aria-hidden
      />
      {open ? (
        <X size={22} strokeWidth={2.2} className="relative text-[#070b14]" aria-hidden />
      ) : (
        <EarnCoin size={44} online className="relative" />
      )}
    </button>
  );
}
