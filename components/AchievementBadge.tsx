"use client";
// AchievementBadge — badge grid for the wallet page.
// Renders earned hub achievements with a flip-in animation and shows locked
// achievements (greyed) so users know what they're working toward.

import { HUB_ACHIEVEMENTS, type HubAchievement } from "@/lib/gamification";

interface EarnedAchievement {
  key: string;
  label: string;
  hub: string;
  earnedAt: string;
}

interface AchievementBadgeGridProps {
  earned: EarnedAchievement[];
  /** If true, locked (unearned) achievements are rendered as ghost tiles. */
  showLocked?: boolean;
}

const HUB_ACCENT: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  build:   { border: "border-neural-400/40",       bg: "bg-neural-400/10",      text: "text-neural-300",    dot: "bg-neural-400"     },
  source:  { border: "border-cyan-400/40",          bg: "bg-cyan-400/10",        text: "text-cyan-300",      dot: "bg-cyan-400"       },
  run:     { border: "border-amber-400/40",         bg: "bg-amber-400/10",       text: "text-amber-300",     dot: "bg-amber-400"      },
  execute: { border: "border-emerald-400/40",       bg: "bg-emerald-400/10",     text: "text-emerald-300",   dot: "bg-emerald-400"    },
};

const HUB_LABEL: Record<string, string> = {
  build: "Build", source: "Source", run: "Run", execute: "Execute",
};

function BadgeTile({
  achievement,
  isEarned,
  earnedAt,
  index,
}: {
  achievement: HubAchievement;
  isEarned: boolean;
  earnedAt?: string;
  index: number;
}) {
  const accent = HUB_ACCENT[achievement.hub] ?? HUB_ACCENT.build;

  if (!isEarned) {
    return (
      <div className="flex flex-col gap-1.5 rounded-xl border border-line/25 bg-surface-1/15 p-3 opacity-40">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${accent.dot} opacity-30`} />
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-fg-muted">
            {HUB_LABEL[achievement.hub]}
          </span>
        </div>
        <p className="text-xs font-medium text-fg-muted">{achievement.label}</p>
        <p className="text-[10px] leading-4 text-fg-muted">{achievement.description}</p>
        <p className="mt-auto font-mono text-[9px] text-fg-muted">
          +{achievement.bonus} cr
        </p>
      </div>
    );
  }

  return (
    <div
      className={[
        "flex flex-col gap-1.5 rounded-xl border p-3",
        accent.border,
        accent.bg,
        "animate-badge-reveal",
      ].join(" ")}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${accent.dot} shadow-[0_0_8px_rgba(118,185,0,0.8)]`} />
        <span className={`font-mono text-[9px] uppercase tracking-[0.2em] ${accent.text}`}>
          {HUB_LABEL[achievement.hub]}
        </span>
      </div>
      <p className={`text-xs font-semibold ${accent.text}`}>{achievement.label}</p>
      <p className="text-[10px] leading-4 text-fg-secondary">{achievement.description}</p>
      <div className="mt-auto flex items-center justify-between">
        <span className={`font-mono text-[9px] ${accent.text}`}>+{achievement.bonus} cr</span>
        {earnedAt && (
          <span className="font-mono text-[9px] text-fg-muted">
            {new Date(earnedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
      </div>
    </div>
  );
}

export function AchievementBadgeGrid({ earned, showLocked = true }: AchievementBadgeGridProps) {
  const earnedKeys = new Set(earned.map((e) => e.key));
  const earnedMap  = new Map(earned.map((e) => [e.key, e]));

  // Group by hub for a cleaner layout
  const hubs: Array<"build" | "source" | "run" | "execute"> = ["build", "source", "run", "execute"];

  return (
    <div className="space-y-6">
      {hubs.map((hub) => {
        const hubAchs = HUB_ACHIEVEMENTS.filter((a) => a.hub === hub);
        const earnedInHub = hubAchs.filter((a) => earnedKeys.has(a.key));
        if (!showLocked && earnedInHub.length === 0) return null;

        return (
          <div key={hub}>
            <div className="mb-2.5 flex items-center gap-2">
              <span className={`font-mono text-[10px] uppercase tracking-[0.24em] ${HUB_ACCENT[hub]?.text ?? "text-neural-300"}`}>
                {HUB_LABEL[hub]}
              </span>
              <span className="font-mono text-[10px] text-fg-muted">
                {earnedInHub.length}/{hubAchs.length}
              </span>
              <div className="h-px flex-1 bg-line/30" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {hubAchs.map((ach, i) => {
                const e = earnedMap.get(ach.key);
                return (
                  <BadgeTile
                    key={ach.key}
                    achievement={ach}
                    isEarned={!!e}
                    earnedAt={e?.earnedAt}
                    index={i}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
