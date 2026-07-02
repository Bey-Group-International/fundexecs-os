"use client";

import { useEffect, type ReactNode } from "react";

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}

const WIDTH_CLASS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
} as const;

export function SlidePanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "md",
}: SlidePanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute right-0 top-0 flex h-full w-full flex-col border-l border-line bg-surface-0 shadow-2xl animate-slide-in-right ${WIDTH_CLASS[width]}`}
      >
        {/* Header */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="truncate text-sm font-medium text-fg-primary">{title}</h2>
            {subtitle ? (
              <p className="text-xs text-fg-muted">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="shrink-0 rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            ✕
          </button>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {/* Optional footer */}
        {footer ? (
          <div className="shrink-0 border-t border-line px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
