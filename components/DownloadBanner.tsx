"use client";

// components/DownloadBanner.tsx
// Post-login prompt to download FundExecs OS. Resurfaces every 30 days.
import { useEffect, useState } from "react";
import { DOWNLOAD_URLS, PLATFORM_META, type Platform } from "@/lib/download-urls";
import { PlatformIcon } from "@/components/PlatformIcon";

const STORAGE_KEY = "fx:download-banner-dismissed-at";
const RESURFACE_MS = 30 * 24 * 60 * 60 * 1000;
const EXIT_MS = 250;
const PLATFORMS = Object.keys(DOWNLOAD_URLS) as Platform[];

export function DownloadBanner() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const dismissedAt = parseInt(raw, 10);
        if (Date.now() - dismissedAt < RESURFACE_MS) return;
      }
    } catch {
      // private mode — show anyway
    }
    setOpen(true);
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  function dismiss() {
    setShown(false);
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // non-fatal
    }
    setTimeout(() => setOpen(false), EXIT_MS);
  }

  if (!open) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-4 z-40 print:hidden">
      <div
        role="complementary"
        aria-label="Download FundExecs OS"
        className={`pointer-events-auto relative w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gold-500/25 bg-surface-1/90 shadow-2xl shadow-black/40 backdrop-blur-xl transition-all duration-250 ${
          shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
      >
        {/* Top-edge glow line */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/50 to-transparent"
        />
        {/* Left accent rail */}
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-gold-400/80 via-gold-500/40 to-transparent" />

        {/* Header */}
        <div className="relative overflow-hidden px-5 pt-4 pb-3">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_80%_at_10%_50%,rgb(var(--fx-accent-rgb)/0.12),transparent_70%)]"
          />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold-400">
                FundExecs OS · Native App
              </p>
              <p className="mt-1 text-sm font-semibold text-fg-primary">
                Get the OS
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-fg-secondary">
                Download your local / remote system — offline‑capable, always current.
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
            >
              ×
            </button>
          </div>
        </div>

        {/* Platform strip */}
        <div className="border-t border-line/50 px-5 py-3">
          <div className="grid grid-cols-5 gap-1">
            {PLATFORMS.map((platform) => {
              const { label } = PLATFORM_META[platform];
              return (
                <a
                  key={platform}
                  href={DOWNLOAD_URLS[platform]}
                  download={platform === "ios" ? undefined : true}
                  onClick={dismiss}
                  title={label}
                  className="group flex flex-col items-center gap-1.5 rounded-lg border border-line/60 bg-surface-0/60 px-2 py-2.5 transition duration-200 hover:border-gold-500/40 hover:bg-gold-500/[0.06]"
                >
                  <PlatformIcon
                    platform={platform}
                    className="h-4 w-4 text-fg-muted transition duration-200 group-hover:text-gold-400"
                  />
                  <span className="font-mono text-[8px] uppercase tracking-wider text-fg-muted transition duration-200 group-hover:text-gold-400/80">
                    {label}
                  </span>
                </a>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-line/40 px-5 py-2">
          <p className="font-mono text-[8px] uppercase tracking-widest text-fg-muted">
            Self-hosted · no app store required
          </p>
        </div>
      </div>
    </div>
  );
}
