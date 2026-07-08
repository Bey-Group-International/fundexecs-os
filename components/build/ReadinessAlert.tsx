"use client";
// ReadinessAlert — wraps the Build hub's Investor Readiness panel in a
// dismissable floating alert. It shows in the bottom-right corner by default,
// can be closed with the ✕, and re-summoned (or hidden again) with the "i"
// keyboard shortcut. The dismissed/shown state persists in localStorage so it
// stays out of the way across navigations until the user asks for it back.
//
// This component only mounts on the Build hub, so the "i" shortcut is scoped
// there naturally.

import { useCallback, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "build-readiness-alert-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(dismissed: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, dismissed ? "1" : "0");
  } catch {
    // Ignore — private mode / storage disabled just means it won't persist.
  }
}

export function ReadinessAlert({ children }: { children: ReactNode }) {
  // Start hidden on both server and first client render to keep hydration
  // stable; the effect resolves the real visibility from localStorage.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setMounted(true);
    setVisible(!readDismissed());
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    writeDismissed(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "i" && e.key !== "I") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setVisible((v) => {
        const next = !v;
        writeDismissed(!next);
        return next;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!mounted || !visible) return null;

  return (
    <div
      role="complementary"
      aria-label="Investor readiness"
      className="fixed bottom-4 right-4 z-40 w-[min(92vw,380px)] max-h-[calc(100vh-2rem)] overflow-y-auto"
    >
      <div className="relative">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss investor readiness (press i to reopen)"
          title="Dismiss (press i to reopen)"
          className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface-2 text-fg-muted transition hover:bg-surface-3 hover:text-fg-primary"
        >
          <span aria-hidden className="text-xs leading-none">✕</span>
        </button>
        {children}
        <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-widest text-fg-muted">
          Press{" "}
          <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 text-fg-secondary">
            i
          </kbd>{" "}
          to toggle
        </p>
      </div>
    </div>
  );
}
