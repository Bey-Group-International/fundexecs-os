'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HelpTour } from '@/lib/help/content';

/* ============================================================================
 * GuidedTour — a coach-mark overlay that spotlights real UI elements and walks
 * through a tour's steps. A scrim with a cut-out highlight (box-shadow trick)
 * frames the target; a tooltip card explains it with Back / Next / Skip.
 * Targets that aren't on the page are skipped automatically. Keyboard: Esc to
 * exit, ← / → to navigate. Reduced-motion drops the transitions.
 * ========================================================================= */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const CARD_W = 300;
const GAP = 14;

export function GuidedTour({ tour, onClose }: { tour: HelpTour; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = tour.steps[index];
  const isLast = index === tour.steps.length - 1;

  const measure = useCallback(() => {
    const el = document.querySelector(tour.steps[index]?.target ?? '');
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [tour, index]);

  // On step change: scroll the target into view, then measure (in rAF so we
  // never setState synchronously inside the effect body).
  useEffect(() => {
    const el = document.querySelector(tour.steps[index]?.target ?? '');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
    const raf = requestAnimationFrame(() => {
      // settle scroll, then measure twice for smoothness
      requestAnimationFrame(measure);
    });
    const t = setTimeout(measure, 360);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [index, tour, measure]);

  // Keep the highlight glued to the target as the page scrolls/resizes.
  useEffect(() => {
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const next = useCallback(() => {
    if (index >= tour.steps.length - 1) onClose();
    else setIndex((i) => i + 1);
  }, [index, tour.steps.length, onClose]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Keyboard controls.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, back, onClose]);

  if (!step) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  // Tooltip position: prefer the step's placement, fall back to fit.
  let cardTop = vh / 2 - 80;
  let cardLeft = vw / 2 - CARD_W / 2;
  let placement = step.placement ?? 'bottom';

  if (rect) {
    const spaceBelow = vh - (rect.top + rect.height);
    const spaceAbove = rect.top;
    if ((placement === 'bottom' && spaceBelow < 180) || (placement === 'top' && spaceAbove < 180)) {
      placement = spaceBelow >= spaceAbove ? 'bottom' : 'top';
    }
    const cx = rect.left + rect.width / 2;
    if (placement === 'bottom') {
      cardTop = rect.top + rect.height + GAP;
      cardLeft = cx - CARD_W / 2;
    } else if (placement === 'top') {
      cardTop = rect.top - GAP - 168;
      cardLeft = cx - CARD_W / 2;
    } else if (placement === 'right') {
      cardTop = rect.top;
      cardLeft = rect.left + rect.width + GAP;
    } else {
      cardTop = rect.top;
      cardLeft = rect.left - CARD_W - GAP;
    }
    // clamp to viewport
    cardLeft = Math.max(12, Math.min(cardLeft, vw - CARD_W - 12));
    cardTop = Math.max(12, Math.min(cardTop, vh - 188));
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={tour.title}>
      {/* Scrim with a cut-out around the target (box-shadow trick). When the
          target is missing, a plain dim scrim is shown and the card centers. */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl transition-all duration-300 ease-[cubic-bezier(.22,.61,.36,1)] motion-reduce:transition-none"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(3,6,12,0.66)',
            outline: '2px solid var(--gold-1)',
            outlineOffset: '2px'
          }}
          aria-hidden
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(3,6,12,0.66)]" aria-hidden />
      )}

      {/* Click-catcher to dismiss on backdrop click (kept under the card). */}
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        aria-label="Close tour"
        onClick={onClose}
      />

      {/* Tooltip card */}
      <div
        className="absolute w-[300px] rounded-2xl border border-hairline bg-bg-1 p-4 shadow-[var(--shadow-lg)] transition-all duration-200 ease-[cubic-bezier(.22,.61,.36,1)] motion-reduce:transition-none"
        style={{ top: cardTop, left: cardLeft }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-1">
            {tour.title} · {index + 1}/{tour.steps.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tour"
            className="-mr-1 -mt-1 flex h-6 w-6 items-center justify-center rounded-lg text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
          >
            <X size={14} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <h3 className="mt-1.5 text-[14px] font-semibold text-fg-1">{step.title}</h3>
        <p className="mt-1 text-[12.5px] leading-6 text-fg-3">{step.body}</p>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5" aria-hidden>
            {tour.steps.map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === index ? 'w-4 bg-gold-1' : 'w-1.5 bg-surface-3'
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={back}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
              >
                <ArrowLeft size={13} strokeWidth={2} aria-hidden />
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_8px_18px_-8px_rgba(37,99,235,0.6)] transition hover:brightness-110"
            >
              {isLast ? (
                <>
                  Done
                  <Check size={13} strokeWidth={2.4} aria-hidden />
                </>
              ) : (
                <>
                  Next
                  <ArrowRight size={13} strokeWidth={2} aria-hidden />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GuidedTour;
