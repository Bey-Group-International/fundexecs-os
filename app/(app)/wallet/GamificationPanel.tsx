// app/(app)/wallet/GamificationPanel.tsx
// Server component — renders the execution-driven gamification section of the
// wallet page: streak status, milestone progress, earned credits from execution,
// and the full hub achievement badge grid.
import { getSessionContext } from "@/lib/auth";
import {
  getGamificationSummary,
  currentRank,
  nextMilestone,
  milestoneProgress,
  streakMultiplier,
  streakLabel,
  EXECUTION_MILESTONES,
} from "@/lib/gamification";
import { formatCredits } from "@/lib/billing";
import { AchievementBadgeGrid } from "@/components/AchievementBadge";

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-2/50 ${className}`}>
      <div
        className="h-full rounded-full bg-neural-400 transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export async function GamificationPanel() {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return null;

    const summary = await getGamificationSummary(ctx.orgId);
    const { streak, totalTasks, lastMilestone, earnedFromExecution, achievements } = summary;

    const rank    = currentRank(totalTasks);
    const next    = nextMilestone(totalTasks);
    const progress = milestoneProgress(totalTasks);
    const mult     = streakMultiplier(streak.current);
    const sLabel   = streakLabel(streak.current);

    // Streak risk: last activity was not today
    const lastDay = streak.lastActivityAt
      ? new Date(streak.lastActivityAt).toISOString().slice(0, 10)
      : null;
    const today     = new Date().toISOString().slice(0, 10);
    const atRisk    = lastDay !== null && lastDay !== today;

    return (
      <div className="space-y-8">
        {/* ── Execution earnings banner ───────────────────────────────── */}
        {earnedFromExecution > 0 && (
          <div className="flex items-center justify-between rounded-2xl border border-neural-400/25 bg-neural-400/[0.05] px-5 py-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-neural-300">
                Earned from execution
              </p>
              <p className="mt-1 font-display text-3xl font-semibold text-fg-primary">
                <span className="text-neural-400">◆</span>{" "}
                {formatCredits(earnedFromExecution)}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
                credits earned by completing tasks across all hubs
              </p>
            </div>
            <div className="hidden text-right sm:block">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-muted">
                Tasks completed
              </p>
              <p className="mt-1 font-display text-2xl font-semibold text-fg-primary">
                {totalTasks.toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* ── Streak + Milestone row ──────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2">

          {/* Streak card */}
          <div className={[
            "rounded-2xl border p-5",
            atRisk
              ? "border-orange-500/40 bg-orange-500/[0.04]"
              : streak.current >= 7
              ? "border-neural-400/30 bg-neural-400/[0.05]"
              : "border-line/30 bg-surface-1/20",
          ].join(" ")}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-neural-300">
                  Execution streak
                </p>
                <div className="mt-2 flex items-end gap-2">
                  <span className={`font-display text-4xl font-semibold leading-none ${atRisk ? "text-orange-300" : "text-fg-primary"}`}>
                    {streak.current}
                  </span>
                  <span className="mb-0.5 font-mono text-xs text-fg-muted">
                    day{streak.current !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-neural-300">
                  {sLabel}
                </p>
              </div>
              <div className="text-right">
                <span className="text-2xl">{streak.current >= 14 ? "🔥" : streak.current >= 3 ? "⚡" : "○"}</span>
                {mult > 1.0 && (
                  <div className="mt-1">
                    <span className="rounded-full border border-neural-400/40 bg-neural-400/10 px-2 py-0.5 font-mono text-[11px] text-neural-300">
                      {mult.toFixed(2)}× credits
                    </span>
                  </div>
                )}
              </div>
            </div>

            {atRisk && (
              <p className="mt-3 rounded-lg border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
                Complete a task today to protect your streak.
              </p>
            )}

            <div className="mt-4 flex items-center justify-between text-[10px] text-fg-muted font-mono">
              <span>Best: {streak.longest}d</span>
              {mult > 1.0 && (
                <span className="text-neural-300">
                  +{Math.round((mult - 1) * 100)}% bonus credits on each task
                </span>
              )}
            </div>
          </div>

          {/* Milestone card */}
          <div className="rounded-2xl border border-line/30 bg-surface-1/20 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-neural-300">
              Execution rank
            </p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div>
                <p className="font-display text-xl font-semibold text-fg-primary">
                  {rank?.rank ?? "Unranked"}
                </p>
                <p className="mt-0.5 text-xs text-fg-secondary">
                  {rank?.description ?? "Complete your first 10 tasks to earn a rank."}
                </p>
              </div>
              {rank && (
                <span className="mb-0.5 rounded-full border border-neural-400/30 bg-neural-400/10 px-2 py-0.5 font-mono text-[10px] text-neural-300">
                  {totalTasks} tasks
                </span>
              )}
            </div>

            {next && (
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between font-mono text-[9px] text-fg-muted">
                  <span>{totalTasks} done</span>
                  <span>{next.rank} at {next.threshold} · +{formatCredits(next.bonus)} cr</span>
                </div>
                <ProgressBar value={progress} />
                <p className="mt-1.5 text-[10px] text-fg-muted">
                  {next.threshold - totalTasks} task{next.threshold - totalTasks !== 1 ? "s" : ""} to next milestone
                </p>
              </div>
            )}

            {!next && (
              <p className="mt-3 font-mono text-[10px] text-neural-300">
                Maximum rank achieved ◆
              </p>
            )}
          </div>
        </div>

        {/* ── Milestone ladder ────────────────────────────────────────── */}
        <div>
          <h3 className="mb-3 font-mono text-xs uppercase tracking-[0.24em] text-neural-300">
            Milestone ladder
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {EXECUTION_MILESTONES.map((m) => {
              const reached = totalTasks >= m.threshold;
              return (
                <div
                  key={m.threshold}
                  className={[
                    "rounded-xl border p-3 text-center",
                    reached
                      ? "border-neural-400/35 bg-neural-400/[0.07]"
                      : "border-line/25 bg-surface-1/15 opacity-50",
                  ].join(" ")}
                >
                  <p className="font-display text-lg font-semibold text-fg-primary">
                    {reached ? "★" : "○"}
                  </p>
                  <p className={`mt-0.5 font-mono text-[9px] ${reached ? "text-neural-300" : "text-fg-muted"}`}>
                    {m.rank}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] text-fg-muted">
                    {m.threshold} tasks
                  </p>
                  <p className={`mt-0.5 font-mono text-[9px] ${reached ? "text-neural-300" : "text-fg-muted"}`}>
                    +{formatCredits(m.bonus)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Hub achievements ────────────────────────────────────────── */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-mono text-xs uppercase tracking-[0.24em] text-neural-300">
              Hub achievements
            </h3>
            <span className="font-mono text-[11px] text-fg-muted">
              {achievements.length} earned
            </span>
          </div>
          <AchievementBadgeGrid earned={achievements} showLocked />
        </div>
      </div>
    );
  } catch {
    return null;
  }
}
