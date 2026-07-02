"use client";

// components/DownloadOS.tsx
// Institutional download card for FundExecs OS native apps — Settings surface.
import { DOWNLOAD_URLS, PLATFORM_META, type Platform } from "@/lib/download-urls";
import { PlatformIcon } from "@/components/PlatformIcon";

const PLATFORMS = Object.keys(DOWNLOAD_URLS) as Platform[];

export function DownloadOSCard() {
  return (
    <div className="fx-glass overflow-hidden p-0">
      {/* Header band */}
      <div className="relative overflow-hidden border-b border-line/60 px-6 py-5">
        {/* Ambient glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgb(var(--fx-accent-rgb)/0.18),transparent_70%)]"
        />
        {/* Subtle grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(rgb(var(--fx-accent-rgb)/0.07) 1px,transparent 1px),linear-gradient(90deg,rgb(var(--fx-accent-rgb)/0.07) 1px,transparent 1px)",
            backgroundSize: "32px 32px",
            maskImage: "radial-gradient(ellipse 90% 80% at 50% 0%,black,transparent 75%)",
          }}
        />
        <div className="relative">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400/80">
            Native Application
          </span>
          <h3 className="mt-1 font-display text-lg font-semibold tracking-tight text-fg-primary">
            FundExecs OS
          </h3>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-fg-secondary">
            Install directly on any device — fully local, offline-capable, with persistent access to
            your workspace, Earn, and all hubs. No app store required.
          </p>
        </div>
      </div>

      {/* Platform grid */}
      <div className="grid grid-cols-2 divide-x divide-y divide-line/50 sm:grid-cols-3 lg:grid-cols-5">
        {PLATFORMS.map((platform) => {
          const { label, sub, hint } = PLATFORM_META[platform];
          return (
            <a
              key={platform}
              href={DOWNLOAD_URLS[platform]}
              download={platform === "ios" ? undefined : true}
              className="group relative flex flex-col gap-2.5 px-4 py-5 transition duration-200 hover:bg-gold-500/[0.04]"
            >
              {/* Hover top-edge accent */}
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-gold-400/60 to-transparent transition-transform duration-300 group-hover:scale-x-100"
              />
              <PlatformIcon
                platform={platform}
                className="h-6 w-6 text-fg-muted transition duration-200 group-hover:text-gold-400"
              />
              <div>
                <p className="text-sm font-semibold text-fg-primary">{label}</p>
                <p className="mt-0.5 text-xs text-fg-secondary">{sub}</p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {hint}
                </p>
              </div>
              <span className="mt-auto font-mono text-[9px] uppercase tracking-wider text-gold-400/60 transition duration-200 group-hover:text-gold-400">
                Download ↓
              </span>
            </a>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-line/60 px-6 py-3">
        <p className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">
          Self-hosted · enterprise-grade · always current
        </p>
        <span className="h-1.5 w-1.5 rounded-full bg-status-success" title="Downloads live" />
      </div>
    </div>
  );
}
