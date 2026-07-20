"use client";

import { useCallback, useEffect, useState } from "react";

// Guided tour for the Virtual Office. A dismissible, stepped overlay that
// teaches the spatial workspace — moving, spatial conversations, status,
// emotes, the hub rooms, and editing the layout. Mirrors the look and the
// localStorage-persisted approach of the app-wide GuidedTour, but is a fully
// self-contained component with its OWN storage key so the two never collide.
//
// SSR-safe: every window/localStorage touch is guarded and deferred to an
// effect, so the first client render matches the server (nothing) and hydration
// stays clean.

const DEFAULT_STORAGE_KEY = "fx-office-tour-seen";

interface TourStep {
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    title: "Move around the floor",
    body: "Walk with WASD or the arrow keys, or click any tile to stride over to it. Your avatar spawns in the Commons at the heart of the office.",
  },
  {
    title: "Start a spatial conversation",
    body: "Step into a teammate's or agent's proximity ring to open a spatial conversation — just like walking up to someone's desk. Whoever is in range shows up under \"Near you\".",
  },
  {
    title: "Set your status",
    body: "Tell the room whether you're Available, Focusing, In a meeting, or Away. Going Away quietly drops you out of spatial conversation range so you're not interrupted.",
  },
  {
    title: "React with emotes",
    body: "Send a wave, a 👍, or a 🎉 from the React panel. Your emote floats above your avatar for a few seconds so nearby teammates can feel the room.",
  },
  {
    title: "Explore the hub rooms",
    body: "Each corner is an operational hub — Build, Source, Run, and Execute — staffed by the AI agents that live there. The Run and Execute rooms run behind an approval gate.",
  },
  {
    title: "Make the office yours",
    body: "Rearrange rooms and desks to match how your firm actually works. The layout is the shared backbone everyone on your team sees.",
  },
];

/**
 * Small hook for wiring the office tour into a page. Reads the "seen" flag from
 * localStorage on mount (SSR-safe) and opens the tour automatically on first
 * visit. `open` controls the overlay; `dismiss` marks it seen and closes it;
 * `reopen` re-launches it on demand (e.g. from a "Take the tour" button).
 */
export function useOfficeTour(storageKey: string = DEFAULT_STORAGE_KEY) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(storageKey) !== "1") setOpen(true);
    } catch {
      // Private mode / disabled storage — just show the tour this session.
      setOpen(true);
    }
  }, [storageKey]);

  const markSeen = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // ignore — nothing to persist to
    }
  }, [storageKey]);

  const dismiss = useCallback(() => {
    markSeen();
    setOpen(false);
  }, [markSeen]);

  const reopen = useCallback(() => setOpen(true), []);

  return { open, dismiss, reopen };
}

interface OfficeTourProps {
  /** localStorage key for the "seen" flag. Kept distinct from the setup guide. */
  storageKey?: string;
  /**
   * Optional controlled mode. Provide `open` + `onClose` to drive the overlay
   * yourself; omit both to let the component self-manage via useOfficeTour.
   */
  open?: boolean;
  onClose?: () => void;
}

export function OfficeTour({ storageKey = DEFAULT_STORAGE_KEY, open: openProp, onClose }: OfficeTourProps) {
  const controlled = openProp !== undefined;
  const self = useOfficeTour(storageKey);

  const [step, setStep] = useState(0);

  const open = controlled ? openProp : self.open;
  const close = useCallback(() => {
    if (controlled) onClose?.();
    else self.dismiss();
  }, [controlled, onClose, self]);

  // Reset to the first step each time the tour opens.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Escape to dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Virtual Office guided tour"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-xl border border-line bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
              Office tour
            </span>
            <span className="rounded-full bg-gold-500/15 px-1.5 py-0.5 font-mono text-[10px] text-gold-300">
              {step + 1}/{STEPS.length}
            </span>
          </div>
          <button
            onClick={close}
            aria-label="Skip the tour"
            title="Skip the tour"
            className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
          >
            Skip
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 w-full bg-surface-2">
          <div
            className="h-full bg-gold-400 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold text-fg-primary">
            <span className="mr-1.5 font-mono text-sm text-gold-400">{step + 1}.</span>
            {current.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{current.body}</p>
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 pb-3">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}: ${s.title}`}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-4 bg-gold-400" : "w-1.5 bg-surface-3 hover:bg-fg-muted"
              }`}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Back
          </button>
          {isLast ? (
            <button
              onClick={close}
              className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3.5 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
            >
              Get started
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3.5 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
