"use client";
// StreakBar — compact sidebar widget showing current execution streak, the
// active multiplier, and a soft nudge when the user is at risk of breaking it.
// Designed to live in AppSidebar beneath the hub list.

import { streakLabel, streakMultiplier, freezeAvailable } from "@/lib/gamification";

interface StreakBarProps {
  current: number;
  longest: number;
  lastActivityAt: string | null;
  freezeUsedAt: string | null;
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth()    === now.getUTCMonth() &&
    d.getUTCDate()     === now.getUTCDate()
  );
}

function isYesterday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const yesterday = new Date(Date.now() - 86_400_000);
  return (
    d.getUTCFullYear() === yesterday.getUTCFullYear() &&
    d.getUTCMonth()    === yesterday.getUTCMonth() &&
    d.getUTCDate()     === yesterday.getUTCDate()
  );
}

export function StreakBar({ current, longest, lastActivityAt, freezeUsedAt }: StreakBarProps) {
  if (current === 0 && !lastActivityAt) {
    // Never started — render a quiet teaser
    return (
      <div className="mx-2 rounded-xl border border-line/30 bg-surface-1/20 px-3 py-2.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-fg-muted">
          Execution streak
        </p>
        <p className="mt-0.5 text-xs text-fg-secondary">
          Complete a task to start your streak and earn bonus credits.
        </p>
      </div>
    );
  }

  const mult       = streakMultiplier(current);
  const label      = streakLabel(current);
  const actedToday = isToday(lastActivityAt);
  const atRisk     = !actedToday && isYesterday(lastActivityAt);
  const freeze     = freezeAvailable(freezeUsedAt);

  // Risk level drives the border/glow color
  const borderCls = atRisk
    ? "border-orange-500/50"
    : actedToday
    ? "border-neural-400/35"
    : "border-line/30";

  return (
    <div className={`mx-2 rounded-xl border bg-surface-1/20 px-3 py-2.5 ${borderCls}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm ${atRisk ? "animate-streak-flame" : ""}`}>
            {current >= 7 ? "🔥" : "⚡"}
          </span>
          <span className="font-display text-lg font-semibold text-fg-primary leading-none">
            {current}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-fg-muted leading-none">
            day{current !== 1 ? "s" : ""}
          </span>
        </div>

        {mult > 1.0 && (
          <span className="rounded-full border border-neural-400/40 bg-neural-400/10 px-1.5 py-0.5 font-mono text-[10px] text-neural-300">
            {mult.toFixed(2)}×
          </span>
        )}
      </div>

      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-neural-300">
        {label}
      </p>

      {atRisk && (
        <p className="mt-1.5 text-[10px] leading-4 text-orange-300">
          {freeze
            ? "Complete a task today to keep your streak — or use your weekly freeze."
            : "Complete a task today or your streak resets."}
        </p>
      )}

      {longest > current && (
        <p className="mt-1 font-mono text-[9px] text-fg-muted">
          Best: {longest}d
        </p>
      )}
    </div>
  );
}
