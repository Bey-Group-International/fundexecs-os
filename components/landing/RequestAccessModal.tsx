'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { RequestAccessForm } from '@/components/landing/RequestAccessForm';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * RequestAccessModal — the accessible dialog around RequestAccessForm.
 *
 * Portals to <body> (escapes the landing page's transformed/stacking
 * ancestors, mirroring components/drawers/Drawer.tsx), traps Tab focus across
 * the dialog's controls, closes on Esc and backdrop click, locks body scroll
 * while open, and restores focus to the opener on close.
 */
export function RequestAccessModal({
  open,
  onClose,
  source
}: {
  open: boolean;
  onClose: () => void;
  source: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap focus: cycle within the dialog's focusable controls.
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-100"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-access-title"
        className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-100"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <div className="flex items-center gap-2.5">
            <EarnCoin size={24} />
            <h2 id="request-access-title" className="text-[15px] font-semibold text-fg-1">
              Request access
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close request access dialog"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-4 transition hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
          >
            <X size={15} strokeWidth={1.9} aria-hidden />
          </button>
        </div>
        <div className="px-5 py-5">
          <RequestAccessForm source={source} />
        </div>
      </div>
    </div>,
    document.body
  );
}

export default RequestAccessModal;
