'use client';

import { useEffect, useState } from 'react';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { TEAM_ROSTER, TeamAvatar } from '@/lib/team';
import { usePrefersReducedMotion } from '@/components/beta/earn-chat';

/**
 * Brand boot-up splash — the "powering on" moment the instant an invitee opens
 * the link, before the personalized welcome. The wordmark assembles over Earn
 * (foreground, glowing) with the executive team fanned faintly behind, then the
 * whole thing fades out and hands off to the welcome.
 *
 * Self-dismissing (calls `onDone` after the sequence) and click/tap-to-skip.
 * Honors prefers-reduced-motion (renders the final frame, holds briefly, exits).
 */
export function BrandSplash({ onDone }: { onDone: () => void }) {
  const reducedMotion = usePrefersReducedMotion();
  const [revealed, setRevealed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setRevealed(true));
    const hold = reducedMotion ? 900 : 2600; // on-screen time before the fade-out
    const fade = reducedMotion ? 200 : 460;
    const outId = window.setTimeout(() => setLeaving(true), hold);
    const doneId = window.setTimeout(onDone, hold + fade);
    return () => {
      window.clearTimeout(outId);
      window.clearTimeout(doneId);
    };
  }, [reducedMotion, onDone]);

  function skip() {
    setLeaving(true);
    window.setTimeout(onDone, reducedMotion ? 0 : 280);
  }

  /** Staggered first-paint reveal via CSS transitions (instant for reduced motion). */
  const reveal = (delayMs: number, y = 14): React.CSSProperties =>
    reducedMotion
      ? {}
      : {
          opacity: revealed ? 1 : 0,
          transform: revealed ? 'none' : `translateY(${y}px)`,
          transition:
            'opacity 700ms cubic-bezier(0.22,1,0.36,1), transform 700ms cubic-bezier(0.22,1,0.36,1)',
          transitionDelay: `${delayMs}ms`
        };

  return (
    <div
      role="img"
      aria-label="FundExecs OS — by FundExecs Technologies"
      onClick={skip}
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center overflow-hidden px-6 text-center"
      style={{
        background:
          'radial-gradient(58% 50% at 50% 32%, rgba(247,201,72,0.16), transparent 70%), radial-gradient(60% 60% at 50% 100%, rgba(37,99,235,0.12), transparent 70%), linear-gradient(180deg, var(--bg-0), var(--bg-1))',
        opacity: leaving ? 0 : 1,
        transition: 'opacity 460ms ease',
        pointerEvents: leaving ? 'none' : 'auto'
      }}
    >
      {/* Executive team — faint, fanned out behind everything. */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-hidden
      >
        <div className="flex max-w-[22rem] flex-wrap items-center justify-center gap-2.5 opacity-[0.16] blur-[0.5px] sm:max-w-md">
          {TEAM_ROSTER.map((m, i) => (
            <div key={m.slug} style={reveal(120 + i * 38, 8)}>
              <TeamAvatar member={m} size={30} />
            </div>
          ))}
        </div>
      </div>

      {/* Earn — the hero, glowing behind the wordmark. */}
      <div className="relative flex flex-col items-center">
        <div className="relative mb-6" style={reveal(0, 0)}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background: 'radial-gradient(circle, rgba(247,201,72,0.45), transparent 62%)',
              filter: 'blur(34px)'
            }}
          />
          <EarnCoin size={96} glow online className={reducedMotion ? '' : 'fx-coin-float'} />
        </div>

        <h1
          className="text-[40px] font-semibold tracking-[-0.025em] text-fg-1 sm:text-[58px]"
          style={reveal(420)}
        >
          FundExecs <span className="text-gold-1">OS</span>
        </h1>
        <p
          className="mt-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-fg-4 sm:text-[12px]"
          style={reveal(760)}
        >
          By FundExecs Technologies
        </p>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          skip();
        }}
        className="absolute bottom-6 right-6 text-[11.5px] text-fg-5 transition hover:text-fg-3"
        style={reveal(1300)}
      >
        Skip
      </button>
    </div>
  );
}

export default BrandSplash;
