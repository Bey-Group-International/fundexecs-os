'use client';

import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { EarnCoin } from '@/components/screens/EarnCoin';

/**
 * Shared building blocks for the AI-led beta surfaces (the pre-auth claim
 * journey at /beta/claim and the post-auth invite welcome at /beta/welcome):
 * reduced-motion awareness, a typewriter reveal, Earn's speech bubble, a choice
 * chip, and the primary button class. Kept in one place so both flows stay
 * visually and behaviorally in lockstep.
 */

/** Honor prefers-reduced-motion. SSR-safe: false until the client reads it. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    queueMicrotask(() => setReduced(mq.matches));
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

/* ── tiny char-by-char reveal for Earn's lines (queueMicrotask reset keeps the
      react-hooks/set-state-in-effect rule happy). Reveals instantly when the
      user prefers reduced motion. ──────────────────────────────────────────── */
export function useTypewriter(text: string, reducedMotion: boolean, speed = 16): string {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (reducedMotion) {
      queueMicrotask(() => setCount(text.length));
      return;
    }
    let i = 0;
    queueMicrotask(() => setCount(0));
    const id = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, reducedMotion]);
  return reducedMotion ? text : text.slice(0, count);
}

/** Earn's speech bubble — coin + typed line, announced to screen readers. */
export function EarnSays({
  line,
  size = 44,
  reducedMotion
}: {
  line: string;
  size?: number;
  reducedMotion: boolean;
}) {
  const typed = useTypewriter(line, reducedMotion);
  return (
    <div className="flex items-start gap-3.5">
      <div className="relative flex-none">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: 'radial-gradient(circle, rgba(247,201,72,0.4), transparent 65%)',
            filter: 'blur(18px)'
          }}
          aria-hidden
        />
        <EarnCoin size={size} glow online />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-1">Earn</p>
        <p
          className="mt-1 min-h-[1.6em] text-[15px] leading-7 text-fg-1"
          aria-live="polite"
          aria-atomic="true"
        >
          {typed}
          <span
            aria-hidden
            className={`ml-0.5 inline-block h-[1.05em] w-px translate-y-[2px] bg-gold-1 align-middle ${
              reducedMotion ? '' : 'animate-pulse'
            }`}
          />
        </p>
      </div>
    </div>
  );
}

/** Reactive choice chip. */
export function Chip({
  children,
  onClick,
  active,
  icon: Icon
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium transition ${
        active
          ? 'border-gold-1/60 bg-[var(--gold-soft,var(--surface-2))] text-fg-1'
          : 'border-hairline bg-surface-1 text-fg-2 hover:border-gold-1/40 hover:text-fg-1'
      }`}
    >
      {Icon && <Icon size={15} strokeWidth={1.9} aria-hidden />}
      {children}
    </button>
  );
}

export const PRIMARY_BTN =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-5 py-2.5 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110 disabled:opacity-60';
