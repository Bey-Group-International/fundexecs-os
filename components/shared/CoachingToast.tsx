"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastTone = "info" | "success" | "warn" | "error";

interface CoachingToastItem {
  id: string;
  title: string;
  /** Supporting line — optional; a title alone is a valid toast. */
  body?: string;
  /** CTA label + handler — optional. */
  action?: { label: string; onClick: () => void };
  /** Visual tone (default: "info"). */
  tone?: ToastTone;
  /** True while the exit animation plays; the item unmounts when it ends. */
  leaving?: boolean;
}

interface CoachingToastContextValue {
  show: (toast: Omit<CoachingToastItem, "id" | "leaving">) => void;
}

const CoachingToastContext = createContext<CoachingToastContextValue | null>(null);

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useCoachingToast() {
  const ctx = useContext(CoachingToastContext);
  if (!ctx) throw new Error("useCoachingToast must be used inside CoachingToastProvider");
  return ctx;
}

/**
 * Mutation-feedback ergonomics over the same provider: one call per outcome,
 * so a component acknowledging a server action is a single line —
 * `toast.success("Record verified")` / `toast.error("Save failed", message)` —
 * instead of every call site re-inventing its own confirmation UI.
 *
 * Unlike useCoachingToast this does NOT throw outside the provider — it
 * degrades to a no-op, so shared components can toast unconditionally
 * wherever they happen to be mounted.
 */
export function useToast() {
  const ctx = useContext(CoachingToastContext);
  return useMemo(() => {
    const show = ctx?.show ?? (() => {});
    return {
      info: (title: string, body?: string) => show({ tone: "info", title, body }),
      success: (title: string, body?: string) => show({ tone: "success", title, body }),
      warn: (title: string, body?: string) => show({ tone: "warn", title, body }),
      error: (title: string, body?: string) => show({ tone: "error", title, body }),
    };
  }, [ctx]);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

// Enter 250ms spring, exit 150ms ease-in (the documented motion scale for
// panels/toasts); errors linger longer than tips.
const EXIT_MS = 150;
const AUTO_DISMISS_MS = 8000;
const ERROR_DISMISS_MS = 12000;

export function CoachingToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<CoachingToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  // Two-phase dismiss: flag the toast as leaving so the exit animation plays,
  // then unmount it.
  const dismiss = useCallback(
    (id: string) => {
      clearTimeout(timers.current.get(id));
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      timers.current.set(id, setTimeout(() => remove(id), EXIT_MS));
    },
    [remove],
  );

  const show = useCallback(
    (toast: Omit<CoachingToastItem, "id" | "leaving">) => {
      const id = `ct-${Math.random().toString(36).slice(2, 9)}`;
      setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
      const ttl = toast.tone === "error" ? ERROR_DISMISS_MS : AUTO_DISMISS_MS;
      timers.current.set(id, setTimeout(() => dismiss(id), ttl));
    },
    [dismiss],
  );

  const TONE_BORDER: Record<ToastTone, string> = {
    info: "border-l-gold-400",
    success: "border-l-status-success",
    warn: "border-l-status-warning",
    error: "border-l-status-danger",
  };
  const TONE_BADGE: Record<ToastTone, string> = {
    info: "text-gold-400",
    success: "text-status-success",
    warn: "text-status-warning",
    error: "text-status-danger",
  };
  const TONE_LABEL: Record<ToastTone, string> = {
    info: "Tip",
    success: "Done",
    warn: "Heads up",
    error: "Failed",
  };

  return (
    <CoachingToastContext.Provider value={{ show }}>
      {children}

      {/* Toast stack — bottom-left, above regular content, below EarnCopilotDock */}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-6 left-6 z-40 flex flex-col gap-2"
      >
        {toasts.map((toast) => {
          const tone = toast.tone ?? "info";
          return (
            <div
              key={toast.id}
              // Failures interrupt; everything else waits its turn.
              role={tone === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex w-72 flex-col gap-2 rounded-xl border border-line border-l-4 ${TONE_BORDER[tone]} bg-surface-1/95 px-4 py-3 shadow-lg backdrop-blur-sm ${
                toast.leaving ? "animate-coach-fade-out" : "animate-coach-slide-up"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`font-mono text-[9px] uppercase tracking-wider ${TONE_BADGE[tone]}`}
                >
                  {TONE_LABEL[tone]}
                </span>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                  className="font-mono text-[10px] text-fg-muted transition hover:text-fg-primary"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs font-medium text-fg-primary">{toast.title}</p>
              {toast.body ? (
                <p className="text-xs text-fg-secondary leading-relaxed">{toast.body}</p>
              ) : null}
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
