"use client";

// components/DownloadOSFloat.tsx
// Floating, hideable download prompt shown during onboarding.
import { useState } from "react";
import { DOWNLOAD_URLS, PLATFORM_META, type Platform } from "@/lib/download-urls";

const PLATFORMS = Object.keys(DOWNLOAD_URLS) as Platform[];

export function DownloadOSFloat() {
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (hidden) return null;

  return (
    <div className="fixed bottom-6 right-4 z-30 print:hidden">
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-2 rounded-lg border border-gold-500/30 bg-surface-1 px-3 py-2 shadow-lg shadow-black/20 transition hover:border-gold-500/50"
        >
          <span className="text-base"></span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
            Get the OS
          </span>
        </button>
      ) : (
        <div className="relative w-72 overflow-hidden rounded-lg border border-gold-500/30 bg-surface-1 shadow-xl shadow-black/30">
          <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-gold-500/70" />
          <div className="px-4 py-3 pr-8">
            <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
              Get the OS
            </p>
            <p className="mt-1 text-sm font-medium text-fg-primary">
              Download your local system
            </p>
            <p className="mt-0.5 text-xs leading-snug text-fg-secondary">
              Install FundExecs OS for offline-capable access to your full workspace.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {PLATFORMS.map((platform) => {
                const { label, icon } = PLATFORM_META[platform];
                return (
                  <a
                    key={platform}
                    href={DOWNLOAD_URLS[platform]}
                    download={platform === "ios" ? undefined : true}
                    className="flex items-center gap-1 rounded border border-line bg-surface-0 px-2 py-1 font-mono text-[10px] text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300"
                  >
                    <span>{icon}</span>
                    <span>{label}</span>
                  </a>
                );
              })}
            </div>
          </div>
          <div className="absolute right-1.5 top-1.5 flex gap-0.5">
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
      )}
    </div>
  );
}
