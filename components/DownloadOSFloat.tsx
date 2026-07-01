"use client";

// components/DownloadOSFloat.tsx
// Floating, collapsible download prompt shown during onboarding.
import { useState } from "react";
import { DOWNLOAD_URLS, PLATFORM_META, type Platform } from "@/lib/download-urls";
import { PlatformIcon } from "@/components/PlatformIcon";

const PLATFORMS = Object.keys(DOWNLOAD_URLS) as Platform[];

export function DownloadOSFloat() {
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (hidden) return null;

  if (collapsed) {
    return (
      <div className="fixed bottom-6 right-4 z-30 print:hidden">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="group flex items-center gap-2.5 rounded-xl border border-gold-500/25 bg-surface-1/90 px-4 py-2.5 shadow-lg shadow-black/25 backdrop-blur-xl transition duration-200 hover:border-gold-500/45 hover:bg-surface-2/90"
        >
          {/* Mini icon row */}
          <div className="flex -space-x-1">
            {PLATFORMS.slice(0, 3).map((p) => (
              <span
                key={p}
                className="flex h-4 w-4 items-center justify-center rounded-full border border-line/60 bg-surface-0"
              >
                <PlatformIcon platform={p} className="h-2.5 w-2.5 text-fg-muted" />
              </span>
            ))}
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-gold-400">
            Get the OS
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-4 z-30 print:hidden">
      <div className="relative w-72 overflow-hidden rounded-xl border border-gold-500/25 bg-surface-1/90 shadow-2xl shadow-black/35 backdrop-blur-xl">
        {/* Top-edge glow */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/50 to-transparent"
        />
        {/* Left rail */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-gold-400/80 via-gold-500/30 to-transparent"
        />

        {/* Header */}
        <div className="relative overflow-hidden px-4 pt-4 pb-3">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_90%_at_0%_50%,rgb(var(--fx-accent-rgb)/0.10),transparent_70%)]"
          />
          <div className="relative flex items-start justify-between">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold-400">
                Native App
              </p>
              <p className="mt-0.5 text-sm font-semibold text-fg-primary">Get the OS</p>
              <p className="mt-0.5 text-[11px] leading-snug text-fg-secondary">
                Local / remote system — install on any device.
              </p>
            </div>
            <div className="flex shrink-0 gap-0.5 pt-0.5">
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse"
                className="flex h-5 w-5 items-center justify-center rounded text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setHidden(true)}
                aria-label="Hide"
                className="flex h-5 w-5 items-center justify-center rounded text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        {/* Platform grid */}
        <div className="border-t border-line/50 px-4 py-3">
          <div className="grid grid-cols-5 gap-1">
            {PLATFORMS.map((platform) => {
              const { label } = PLATFORM_META[platform];
              return (
                <a
                  key={platform}
                  href={DOWNLOAD_URLS[platform]}
                  download={platform === "ios" ? undefined : true}
                  title={label}
                  className="group flex flex-col items-center gap-1.5 rounded-lg border border-line/60 bg-surface-0/60 px-1.5 py-2 transition duration-200 hover:border-gold-500/40 hover:bg-gold-500/[0.06]"
                >
                  <PlatformIcon
                    platform={platform}
                    className="h-4 w-4 text-fg-muted transition duration-200 group-hover:text-gold-400"
                  />
                  <span className="font-mono text-[7.5px] uppercase tracking-wider text-fg-muted transition duration-200 group-hover:text-gold-400/80">
                    {label}
                  </span>
                </a>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-line/40 px-4 py-2">
          <p className="font-mono text-[8px] uppercase tracking-widest text-fg-muted">
            Self-hosted · no app store required
          </p>
        </div>
      </div>
    </div>
  );
}
