"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Markdown } from "@/components/Markdown";

// Full-screen overlay for an artifact's deliverable. Reuses the same Markdown
// rendering as the rest of Earn's output so the expanded read matches the inline
// one. Dismisses on Esc, the close button, or a click outside the panel.
export function ArtifactModal({
  title,
  label,
  content,
  toolbar,
  onClose,
}: {
  title: string;
  label?: string;
  content: string;
  toolbar?: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock background scroll while the overlay is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-8"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-line px-5 py-3">
          {label ? (
            <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
              {label}
            </span>
          ) : null}
          <span className="truncate text-sm font-medium text-fg-primary">{title}</span>
          <div className="ml-auto flex items-center gap-2">
            {toolbar}
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-fg-primary"
            >
              Close ✕
            </button>
          </div>
        </header>
        <div className="overflow-y-auto px-5 py-4">
          <Markdown>{content}</Markdown>
        </div>
      </div>
    </div>
  );
}
