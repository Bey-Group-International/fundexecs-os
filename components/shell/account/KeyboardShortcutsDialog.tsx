'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SHORTCUT_GROUPS } from './keyboard-shortcuts';

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Keyboard-shortcuts overlay — a labeled modal dialog listing the real
 * shortcuts the app binds (see `keyboard-shortcuts.ts`). Esc + click-outside
 * close; focus moves to the close control on open and is restored to the
 * opener on close by the parent menu.
 */
export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      data-testid="keyboard-shortcuts-dialog"
    >
      <div
        className="absolute inset-0 bg-black/55 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-100"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative z-10 w-full max-w-lg rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-100"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <h2 className="text-[14px] font-semibold text-fg-1">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-4 transition hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
          >
            <X size={15} strokeWidth={1.9} aria-hidden />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.heading}>
              <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                {group.heading}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {group.shortcuts.map((s) => (
                  <li
                    key={s.label}
                    className="flex items-center justify-between gap-4 text-[13px] text-fg-2"
                  >
                    <span className="min-w-0 flex-1">{s.label}</span>
                    <span className="flex flex-none items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="inline-flex min-w-[20px] items-center justify-center rounded border border-hairline bg-surface-1 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-3"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export default KeyboardShortcutsDialog;
