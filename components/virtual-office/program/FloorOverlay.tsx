"use client";

import type { ReactNode } from "react";

/**
 * Shared modal shell for the in-world floor overlays (listing detail, list
 * something, delegate a task). It owns the click-away backdrop, the accent
 * card, the gradient top bar, the standardized header (eyebrow / title /
 * subtitle + close), the scrolling body, and the bordered footer — so every
 * overlay reads as one system and each caller only supplies its own content.
 */
export function FloorOverlay({
  accent,
  onClose,
  ariaLabel,
  maxWidth = 360,
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  /** Accent color that themes the border, gradient, and close button. */
  accent: string;
  onClose: () => void;
  ariaLabel: string;
  maxWidth?: number;
  /** Small-caps label above the title. A string is auto-styled; a node renders as-is (e.g. a type badge). */
  eyebrow?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Scrolling body content. */
  children: ReactNode;
  /** Optional bordered footer (actions). */
  footer?: ReactNode;
}) {
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center p-4"
      style={{ background: "rgba(4,6,10,0.55)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92%] w-full flex-col overflow-hidden rounded-xl border backdrop-blur-sm"
        style={{ maxWidth, borderColor: `${accent}59`, background: "rgba(10,8,6,0.97)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={ariaLabel}
      >
        <div className="h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />

        {/* Standardized header */}
        <div className="flex items-start justify-between gap-2 border-b px-4 py-3" style={{ borderColor: `${accent}2e` }}>
          <div className="min-w-0">
            {eyebrow != null &&
              (typeof eyebrow === "string" ? (
                <span
                  className="text-[10px] uppercase tracking-[0.22em]"
                  style={{ color: accent, fontFamily: "Georgia, serif" }}
                >
                  {eyebrow}
                </span>
              ) : (
                eyebrow
              ))}
            {title != null && (
              <h2 className="mt-1 text-[15px] font-semibold leading-tight text-slate-100" style={{ fontFamily: "Georgia, serif" }}>
                {title}
              </h2>
            )}
            {subtitle != null && <p className="mt-0.5 text-[10px] text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-[13px] leading-none text-slate-400 transition-colors hover:text-slate-100"
            style={{ border: `1px solid ${accent}40` }}
          >
            ✕
          </button>
        </div>

        {/* Scrolling body */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">{children}</div>

        {footer != null && (
          <div className="border-t px-4 py-3" style={{ borderColor: `${accent}2e` }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
