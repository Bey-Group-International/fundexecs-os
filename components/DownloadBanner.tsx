"use client";

// components/DownloadBanner.tsx
// Post-login prompt to download FundExecs OS. Shows on first login and
// resurfaces every 30 days. Dismissed state is stored in localStorage.
import { useEffect, useState } from "react";
import { DOWNLOAD_URLS, PLATFORM_META, type Platform } from "@/lib/download-urls";

const STORAGE_KEY = "fx:download-banner-dismissed-at";
const RESURFACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EXIT_MS = 200;
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
        className={`pointer-events-auto relative w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-gold-500/30 bg-surface-1 shadow-xl shadow-black/30 transition-all duration-200 ${
          shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-gold-500/70" />
        <div className="px-4 py-3 pr-8">
          <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
            Get the OS
          </p>
          <p className="mt-1 text-sm font-medium text-fg-primary">
            Download your local / remote system
          </p>
          <p className="mt-0.5 text-xs leading-snug text-fg-secondary">
            Install FundExecs OS on any device for offline-capable access to your full workspace.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PLATFORMS.map((platform) => {
              const { label, icon } = PLATFORM_META[platform];
              return (
                <a
                  key={platform}
                  href={DOWNLOAD_URLS[platform]}
                  download={platform === "ios" ? undefined : true}
                  onClick={dismiss}
                  className="flex items-center gap-1 rounded border border-line bg-surface-0 px-2 py-1 font-mono text-[10px] text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300"
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                </a>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
        >
          ×
        </button>
      </div>
    </div>
  );
}
