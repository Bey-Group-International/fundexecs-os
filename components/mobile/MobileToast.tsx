"use client";

import { createContext, useContext, useCallback, useRef, useState } from "react";
import { haptic } from "./haptics";

type Tone = "neutral" | "success" | "error";

interface ToastOptions {
  message: string;
  tone?: Tone;
  /** Optional action (e.g. Retry). Dismisses the toast when invoked. */
  action?: { label: string; onClick: () => void };
  /** ms before auto-dismiss. Errors/actionable toasts default longer. */
  duration?: number;
}

interface Toast extends ToastOptions {
  id: number;
}

interface ToastApi {
  toast: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => {} });

const TONE: Record<Tone, string> = {
  neutral: "border-line/70 bg-surface-1 text-fg-primary",
  success: "border-status-success/40 bg-surface-1 text-fg-primary",
  error: "border-status-danger/45 bg-surface-1 text-fg-primary",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-neural-400",
  success: "bg-status-success",
  error: "bg-status-danger",
};

// Lightweight toast system for the mobile app — the channel that makes
// optimistic, on-the-go actions honest: success confirmations and, crucially,
// failure notices with a Retry when the network drops mid-action. Toasts stack
// just above the bottom tab bar and auto-dismiss. `md:hidden`; desktop keeps its
// own (CoachingToast) feedback and is unaffected.
export function MobileToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = ++seq.current;
      const tone = opts.tone ?? "neutral";
      setToasts((list) => [...list.slice(-2), { ...opts, tone, id }]);
      haptic(tone === "error" ? "warn" : "tap");
      const duration = opts.duration ?? (opts.action || tone === "error" ? 6000 : 3200);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-[55] flex flex-col items-center gap-2 px-3 md:hidden print:hidden"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            aria-live={t.tone === "error" ? "assertive" : undefined}
            className={`fx-sheet-enter pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border px-3.5 py-3 shadow-[0_16px_40px_-20px_rgb(0_0_0/0.7)] backdrop-blur-xl ${TONE[t.tone ?? "neutral"]}`}
          >
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[t.tone ?? "neutral"]}`} />
            <span className="min-w-0 flex-1 text-[13px] leading-snug">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
                className="fx-tap shrink-0 rounded-lg border border-gold-500/40 bg-gold-500/[0.08] px-2.5 py-1 text-[12px] font-semibold text-gold-300"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useMobileToast(): ToastApi {
  return useContext(ToastContext);
}
