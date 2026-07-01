"use client";

type MediaPermissionBannerProps = {
  onAllow: () => void;
  onDismiss: () => void;
};

export function MediaPermissionBanner({ onAllow, onDismiss }: MediaPermissionBannerProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-sm">
      <span className="text-amber-300">
        Allow mic & camera to join the voice call with nearby teammates.
      </span>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onAllow}
          className="px-3 py-1 rounded bg-amber-500 text-slate-900 text-xs font-semibold hover:bg-amber-400 transition-colors"
        >
          Allow
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1 rounded bg-slate-700 text-slate-300 text-xs hover:bg-slate-600 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
