'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TrustDrawer, type TrustDrawerSubject } from './TrustDrawer';
import { trustLayerMeta } from './trust-layers';
import type { TrustEvent } from './emit-trust';

/** A live toast = the emitted event plus a client-side id. */
interface Toast extends TrustEvent {
  id: number;
}

/** Auto-dismiss window per the design handoff (~6.8s). */
const DISMISS_MS = 6800;

let nextId = 1;

function ToastCard({
  toast,
  onOpen,
  onDismiss
}: {
  toast: Toast;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const meta = trustLayerMeta(toast.layer);
  const Icon = meta.icon;
  return (
    <div
      role="status"
      onClick={onOpen}
      className="group pointer-events-auto relative w-[340px] cursor-pointer overflow-hidden rounded-2xl border bg-bg-2/95 p-3.5 shadow-[var(--shadow-lg)] backdrop-blur-md transition-transform duration-200 ease-[cubic-bezier(.22,.61,.36,1)] will-change-transform hover:-translate-y-0.5"
      style={{ borderColor: meta.line }}
    >
      {/* Top edge accent strip in the layer hue */}
      <span
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: meta.color }}
        aria-hidden
      />
      <div className="flex items-start gap-3">
        <span
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl"
          style={{ background: meta.soft, color: meta.color }}
        >
          <Icon size={17} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.11em]"
              style={{ color: meta.color }}
            >
              {meta.short}
            </span>
            {toast.entity && (
              <span className="truncate text-[10.5px] text-fg-5">· {toast.entity}</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[13px] font-semibold tracking-[-0.01em] text-fg-1">
            {toast.title}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fg-3">
            {toast.msg}
          </div>
          {typeof toast.pct === 'number' && (
            <div className="mt-2 flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, toast.pct))}%`,
                    background: meta.color
                  }}
                />
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-fg-4">{toast.pct}%</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-label="Dismiss"
          className="flex h-6 w-6 flex-none items-center justify-center rounded-lg text-fg-5 opacity-0 transition hover:bg-surface-2 hover:text-fg-1 group-hover:opacity-100"
        >
          <X size={14} strokeWidth={1.9} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * TrustToaster — the global Chain-of-Trust toast layer. On mount it installs
 * `window.emitTrust({ layer, title, msg, pct, entity })`; any screen can fire a
 * proof toast on task/approval completion. Toasts stack bottom-right (above the
 * Earn orb), are color-coded by layer, auto-dismiss after ~6.8s, and open the
 * detail drawer when clicked. Animates transform/opacity only — never `color`.
 */
export function TrustToaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [subject, setSubject] = useState<TrustDrawerSubject | undefined>(undefined);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (event: TrustEvent) => {
      const id = nextId++;
      setToasts((list) => [...list, { ...event, id }].slice(-4));
      const timer = setTimeout(() => dismiss(id), DISMISS_MS);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  // Install the global bus on mount.
  useEffect(() => {
    window.emitTrust = push;
    return () => {
      if (window.emitTrust === push) delete window.emitTrust;
    };
  }, [push]);

  // Clear any pending timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const openDrawer = (toast: Toast) => {
    setSubject(
      toast.entity
        ? {
            entity: toast.entity,
            stage: 'Verification in progress',
            pct: toast.pct ?? 0,
            summary: `${toast.title} — ${toast.msg}`
          }
        : undefined
    );
    setDrawerOpen(true);
    dismiss(toast.id);
  };

  return (
    <>
      {/* Toast stack — bottom-right, above the Earn orb (orb sits at z-40). */}
      <div className="pointer-events-none fixed bottom-[88px] right-5 z-50 flex flex-col items-end gap-2.5">
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            onOpen={() => openDrawer(toast)}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </div>

      <TrustDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} subject={subject} />
    </>
  );
}
