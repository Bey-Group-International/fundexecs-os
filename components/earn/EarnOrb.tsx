'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { openEarn } from '@/lib/earn/launcher';

/**
 * The Earn orb — the always-available capital-formation companion. A floating
 * circular launcher (bottom-right), shimmering halo + a gentle float, with the
 * spec's microcopy: a resting "Earn" label that becomes "Ask Earn" on hover.
 * Tapping summons the command-first panel through the global opener. Hidden
 * while the panel is open so the two never overlap.
 */
export function EarnOrb({ hidden }: { hidden?: boolean }) {
  const reduced = useReducedMotion() ?? false;
  const [hover, setHover] = useState(false);

  if (hidden) return null;

  return (
    <div className="fixed bottom-[76px] right-4 z-[55] flex items-center gap-2.5 lg:bottom-6 lg:right-6">
      <span
        className={cnLabel(hover)}
        aria-hidden
        style={{ transition: 'opacity 160ms ease, transform 160ms ease' }}
      >
        {hover ? 'Ask Earn' : 'Earn'}
      </span>
      <motion.button
        type="button"
        onClick={() => openEarn()}
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        whileTap={{ scale: 0.94 }}
        animate={reduced ? undefined : { y: [0, -3, 0] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        aria-label="Ask Earn"
        className="relative flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full border border-[var(--gold-line)] bg-bg-2 shadow-[0_10px_34px_-8px_rgba(247,201,72,0.55)] transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold-line)]"
      >
        <span
          className="fx-glow-pulse pointer-events-none absolute -inset-1 rounded-full bg-[radial-gradient(circle,rgba(247,201,72,0.42),transparent_70%)] blur-[6px]"
          aria-hidden
        />
        <EarnCoin size={40} online />
      </motion.button>
    </div>
  );
}

function cnLabel(hover: boolean): string {
  return [
    'rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-1 text-[11.5px] font-semibold text-gold-1 shadow-sm',
    hover ? 'opacity-100' : 'opacity-90'
  ].join(' ');
}
