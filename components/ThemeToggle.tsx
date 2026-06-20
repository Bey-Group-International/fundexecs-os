"use client";

import { useEffect, useState } from "react";

type ThemeMode = "day" | "night";

const STORAGE_KEY = "fx-theme";

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle("theme-day", mode === "day");
  root.classList.toggle("theme-night", mode === "night");
  root.dataset.theme = mode;
  root.style.colorScheme = mode === "day" ? "light" : "dark";
}

function getInitialTheme(): ThemeMode {
  if (typeof document === "undefined") return "night";
  return document.documentElement.classList.contains("theme-day") ? "day" : "night";
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>("night");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const initial = getInitialTheme();
    setMode(initial);
    applyTheme(initial);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(mode);
  }, [hydrated, mode]);

  function toggleTheme() {
    setMode((current) => {
      const next = current === "day" ? "night" : "day";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage can be unavailable in hardened browsers; visual toggle still works.
      }
      return next;
    });
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${mode === "day" ? "night" : "day"} mode`}
      className="group inline-flex items-center gap-2 rounded-full border border-line bg-surface-1/80 px-2 py-1 text-xs text-fg-secondary shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] backdrop-blur transition hover:border-gold-500/45 hover:text-fg-primary"
    >
      <span className="relative h-5 w-9 rounded-full bg-surface-2 ring-1 ring-line transition group-hover:ring-gold-500/40">
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-gold-400 shadow-[0_0_14px_rgb(var(--fx-accent-rgb)/0.55)] transition-transform ${
            mode === "day" ? "translate-x-0.5" : "translate-x-4"
          }`}
        />
      </span>
      {compact ? null : (
        <span className="font-mono text-[10px] uppercase tracking-wider">
          {mode === "day" ? "Day" : "Night"}
        </span>
      )}
    </button>
  );
}
