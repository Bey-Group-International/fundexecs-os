"use client";

// components/DownloadOS.tsx
// Reusable download card for FundExecs OS native apps. Used in Settings,
// the post-login banner, and the onboarding floating prompt.
import { DOWNLOAD_URLS, PLATFORM_META, type Platform } from "@/lib/download-urls";

const PLATFORMS = Object.keys(DOWNLOAD_URLS) as Platform[];

export function DownloadOSCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "flex flex-col gap-2" : "flex flex-col gap-3"}>
      {!compact && (
        <p className="text-xs leading-relaxed text-fg-secondary">
          Install FundExecs OS on any device for a fully local, offline-capable experience with
          direct access to your workspace, Earn, and all hubs.
        </p>
      )}
      <div className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"}`}>
        {PLATFORMS.map((platform) => {
          const { label, hint, icon } = PLATFORM_META[platform];
          return (
            <a
              key={platform}
              href={DOWNLOAD_URLS[platform]}
              className="fx-card fx-card-hover group flex flex-col gap-1 p-3 transition"
              download={platform === "ios" ? undefined : true}
            >
              <span className="text-xl">{icon}</span>
              <span className="text-sm font-medium text-fg-primary">{label}</span>
              <span className="font-mono text-[10px] text-fg-muted">{hint}</span>
            </a>
          );
        })}
      </div>
      <p className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">
        Self-hosted · no app store required
      </p>
    </div>
  );
}
