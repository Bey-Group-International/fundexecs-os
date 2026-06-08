'use client';

import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DrawerProps {
  /** Controlled open/close. */
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Footer slot — typically the submit + cancel buttons. */
  footer?: ReactNode;
  children: ReactNode;
  /** Width on `≥sm`. Default is 480px. Always full-bleed on `<sm`. */
  widthClass?: string;
}

/**
 * Shared right-side drawer used across Phase 4 flows. Full-bleed on mobile
 * (`<sm`), 480px sliding panel from the right on tablet+. Manages focus
 * trapping, focus restore on close, ESC, and click-outside.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  widthClass = 'sm:w-[480px]'
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousActiveRef = useRef<Element | null>(null);

  // Remember the trigger and focus the panel when the drawer opens.
  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = document.activeElement;
    // Move focus into the panel once it's painted.
    const id = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Restore focus to the trigger element when the drawer closes.
  useEffect(() => {
    if (open) return;
    const prev = previousActiveRef.current;
    if (prev instanceof HTMLElement) prev.focus();
  }, [open]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      // Focus trap: keep tabbing inside the panel.
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  // Portal to <body>. The panel is `position: fixed`, but a fixed descendant is
  // anchored to (and clipped by) the nearest ancestor that has a transform,
  // filter, backdrop-filter, perspective, or `contain` — e.g. a dashboard card
  // carrying `.fx-rise` (which keeps `transform: translateY(0)` via fill-mode
  // `both`) plus `overflow-hidden`. Mounted inline there, the drawer renders
  // squashed inside the card. Portaling to <body> escapes any such ancestor so
  // the overlay always fills the viewport, wherever the trigger lives.
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={handleKey}
      className="fixed inset-0 z-[80] flex"
    >
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        className={cn(
          // Solid panel background — surface-* tokens are translucent and let
          // the page bleed through, making drawer content hard to read.
          'relative ml-auto flex h-full w-full flex-col bg-bg-1 shadow-2xl',
          'animate-in slide-in-from-right duration-150',
          widthClass,
          'border-l border-hairline'
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-[-0.015em] text-fg-1">{title}</div>
            {subtitle ? <div className="mt-0.5 text-[12px] text-fg-4">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-hairline text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
          >
            <X size={16} strokeWidth={1.9} aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline bg-surface-2/40 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

export default Drawer;
