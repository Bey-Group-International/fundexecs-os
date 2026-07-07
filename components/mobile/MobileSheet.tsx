"use client";

import { useEffect, useRef } from "react";
import { CloseIcon } from "./icons";

// Bottom slide-up sheet used across the app shell for quick actions, the More
// menu, and confirmations. Handles scrim, Escape, body scroll-lock, focus
// capture, and a drag-handle affordance. Mobile-only by construction (its only
// callers live inside `md:hidden` shells).
export function MobileSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus into the sheet for screen-reader / keyboard users.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fx-scrim-enter absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="fx-sheet-enter absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-line/70 bg-surface-1 pb-safe shadow-[0_-24px_60px_-30px_rgb(0_0_0/0.8)] outline-none"
      >
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/50 to-transparent" />
        {/* Drag handle */}
        <div className="sticky top-0 z-10 flex flex-col items-center gap-2 rounded-t-3xl bg-surface-1/95 px-4 pt-2.5 pb-2 backdrop-blur-xl">
          <span aria-hidden className="h-1 w-9 rounded-full bg-line" />
          {(title || subtitle) && (
            <div className="flex w-full items-start justify-between gap-3 pt-1">
              <div className="min-w-0">
                {title && (
                  <p id={labelledBy} className="font-display text-base font-semibold tracking-tight text-fg-primary">
                    {title}
                  </p>
                )}
                {subtitle && <p className="mt-0.5 text-[12px] leading-snug text-fg-secondary">{subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="fx-tap -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
              >
                <CloseIcon width={17} height={17} />
              </button>
            </div>
          )}
        </div>
        <div className="px-3 pb-4 pt-1">{children}</div>
      </div>
    </div>
  );
}
