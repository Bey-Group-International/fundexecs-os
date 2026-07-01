"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CoachingToastItem {
  id: string;
  title: string;
  body: string;
  /** CTA label + handler — optional. */
  action?: { label: string; onClick: () => void };
  /** Visual tone (default: "info"). */
  tone?: "info" | "success" | "warn";
}

interface CoachingToastContextValue {
  show: (toast: Omit<CoachingToastItem, "id">) => void;
}

const CoachingToastContext = createContext<CoachingToastContextValue | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCoachingToast() {
  const ctx = useContext(CoachingToastContext);
  if (!ctx) throw new Error("useCoachingToast must be used inside CoachingToastProvider");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CoachingToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<CoachingToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (toast: Omit<CoachingToastItem, "id">) => {
      const id = `ct-${Math.random().toString(36).slice(2, 9)}`;
      setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
      const timer = setTimeout(() => dismiss(id), 8000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const TONE_BORDER: Record<NonNullable<CoachingToastItem["tone"]>, string> = {
    info: "border-l-gold-400",
    success: "border-l-status-success",
    warn: "border-l-status-warning",
  };
  const TONE_BADGE: Record<NonNullable<CoachingToastItem["tone"]>, string> = {
    info: "text-gold-400",
    success: "text-status-success",
    warn: "text-status-warning",
  };

  return (
    <CoachingToastContext.Provider value={{ show }}>
      {children}

      {/* Toast stack — bottom-left, above regular content, below EarnCopilotDock */}
      <div
        aria-live="polite"
        aria-label="Coaching tips"
        className="pointer-events-none fixed bottom-6 left-6 z-40 flex flex-col gap-2"
      >
        {toasts.map((toast) => {
          const tone = toast.tone ?? "info";
          return (
            <div
              key={toast.id}
              role="status"
              className={`pointer-events-auto flex w-72 flex-col gap-2 rounded-xl border border-line border-l-4 ${TONE_BORDER[tone]} bg-surface-1/95 px-4 py-3 shadow-lg backdrop-blur-sm animate-coach-slide-up`}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`font-mono text-[9px] uppercase tracking-wider ${TONE_BADGE[tone]}`}
                >
                  {tone === "info" ? "Tip" : tone === "success" ? "Done" : "Heads up"}
                </span>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss tip"
                  className="font-mono text-[10px] text-fg-muted transition hover:text-fg-primary"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs font-medium text-fg-primary">{toast.title}</p>
              <p className="text-xs text-fg-secondary leading-relaxed">{toast.body}</p>
              {toast.action ? (
                <button
                  type="button"
                  onClick={() => {
                    toast.action!.onClick();
                    dismiss(toast.id);
                  }}
                  className="mt-0.5 self-start rounded border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                >
                  {toast.action.label}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </CoachingToastContext.Provider>
  );
}
