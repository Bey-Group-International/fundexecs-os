// lib/gamification.ts
// Execution-driven gamification engine for FundExecs OS.
//
// Design intent: every credit feels earned, not purchased. Task completion
// triggers a micro-reward (instant credit pop) and accumulates toward macro
// rewards (streak multipliers, milestone bonuses, hub achievements). The
// psychology is: variable-ratio reinforcement (multipliers feel like jackpots)
// + loss-aversion (streaks you don't want to break) + identity formation
// (achievement badges that signal "I'm a serious operator").

import type { Hub, TeamTaskPriority } from "@/lib/supabase/database.types";

// ─── Base reward table ────────────────────────────────────────────────────────
// Credits are nominal but psychologically meaningful. Higher-value hubs (Run,
// Execute) reward more because the underlying work is harder and riskier.
// Priority multipliers push users to tackle urgent items first.

const HUB_BASE: Record<Hub, number> = {
  build:   10,
  source:  20,
  run:     35,
  execute: 50,
};

const PRIORITY_MULT: Record<TeamTaskPriority, number> = {
  low:    0.75,
  normal: 1.0,
  high:   1.5,
  urgent: 2.0,
};

export function baseCredits(hub: Hub, priority: TeamTaskPriority): number {
  return Math.round((HUB_BASE[hub] ?? 10) * (PRIORITY_MULT[priority] ?? 1.0));
}

// ─── Streak model ─────────────────────────────────────────────────────────────
// Streak multipliers compound at natural checkpoints (3, 7, 14, 30, 60 days).
// A "freeze" mechanic allows one missed day per week — mimicking Duolingo's
// streak shield — so users feel forgiven rather than punished by life events.

export interface StreakState {
  current: number;
  longest: number;
  lastActivityAt: string | null;
  freezeUsedAt: string | null;
}

export function streakMultiplier(streakDays: number): number {
  if (streakDays >= 60) return 2.5;
  if (streakDays >= 30) return 2.0;
  if (streakDays >= 14) return 1.75;
  if (streakDays >= 7)  return 1.5;
  if (streakDays >= 3)  return 1.25;
  return 1.0;
}

export function streakLabel(days: number): string {
  if (days >= 60) return "Legendary";
  if (days >= 30) return "Machine";
  if (days >= 14) return "On Fire";
  if (days >= 7)  return "Hot Streak";
  if (days >= 3)  return "Building";
  return "Starting";
}

// ─── Milestone model ──────────────────────────────────────────────────────────
// One-time bonuses at cumulative task counts. Named ranks give users an identity
// to grow into ("I'm a Closer", "I'm a Fund Machine").

export interface ExecutionMilestone {
  threshold: number;
  bonus: number;
  rank: string;
  description: string;
}

export const EXECUTION_MILESTONES: ExecutionMilestone[] = [
  { threshold: 10,  bonus: 100,   rank: "Executor",     description: "You shipped your first 10 tasks." },
  { threshold: 25,  bonus: 250,   rank: "Operator",     description: "25 tasks done. You run tight." },
  { threshold: 50,  bonus: 500,   rank: "Dealmaker",    description: "50 tasks. The machine is humming." },
  { threshold: 100, bonus: 1_000, rank: "Fund Machine", description: "100 tasks. Elite-level throughput." },
  { threshold: 250, bonus: 2_500, rank: "Principal",    description: "250 tasks. The standard bearer." },
  { threshold: 500, bonus: 5_000, rank: "Legend",       description: "500 tasks. You built something real." },
];

export function milestoneAt(total: number, lastMilestone: number): ExecutionMilestone | null {
  return (
    EXECUTION_MILESTONES.find(
      (m) => m.threshold > lastMilestone && m.threshold <= total,
    ) ?? null
  );
}

export function currentRank(totalTasks: number): ExecutionMilestone | null {
  const reached = EXECUTION_MILESTONES.filter((m) => totalTasks >= m.threshold);
  return reached[reached.length - 1] ?? null;
}

export function nextMilestone(totalTasks: number): ExecutionMilestone | null {
  return EXECUTION_MILESTONES.find((m) => m.threshold > totalTasks) ?? null;
}

// 0..1 progress toward next milestone
export function milestoneProgress(totalTasks: number): number {
  const prev = currentRank(totalTasks);
  const next = nextMilestone(totalTasks);
  if (!next) return 1;
  const prevCount = prev?.threshold ?? 0;
  return (totalTasks - prevCount) / (next.threshold - prevCount);
}

// ─── Hub achievements ─────────────────────────────────────────────────────────
// Per-hub badges that fire when an org crosses specific task-count thresholds
// within that hub. Hub-scoped so users get a meaningful identity in each area.

export interface HubAchievement {
  key: string;
  hub: Hub;
  label: string;
  description: string;
  requiredTasks: number;  // tasks in this hub to unlock
  bonus: number;
}

export const HUB_ACHIEVEMENTS: HubAchievement[] = [
  // Build hub
  { key: "build_first_step",     hub: "build",   label: "Foundation Set",   description: "First Build task complete.",           requiredTasks: 1,  bonus: 50  },
  { key: "build_operator",       hub: "build",   label: "Brand Architect",  description: "5 Build tasks — identity locked in.",  requiredTasks: 5,  bonus: 100 },
  { key: "build_master",         hub: "build",   label: "Build Master",     description: "15 Build tasks. Rock solid.",          requiredTasks: 15, bonus: 200 },
  // Source hub
  { key: "source_first_step",    hub: "source",  label: "Pipeline Opened",  description: "First Source task complete.",          requiredTasks: 1,  bonus: 75  },
  { key: "source_rainmaker",     hub: "source",  label: "Rainmaker",        description: "10 Source tasks — deal flow active.",  requiredTasks: 10, bonus: 200 },
  { key: "source_master",        hub: "source",  label: "Network Effect",   description: "25 Source tasks. Referrals compound.", requiredTasks: 25, bonus: 400 },
  // Run hub
  { key: "run_first_step",       hub: "run",     label: "First Rep",        description: "First Run task complete.",             requiredTasks: 1,  bonus: 100 },
  { key: "run_underwriter",      hub: "run",     label: "Underwriter",      description: "5 Run tasks — diligence engine on.",  requiredTasks: 5,  bonus: 250 },
  { key: "run_master",           hub: "run",     label: "Deal Architect",   description: "15 Run tasks. Decisioning at speed.", requiredTasks: 15, bonus: 500 },
  // Execute hub
  { key: "execute_first_step",   hub: "execute", label: "First Close",      description: "First Execute task complete.",         requiredTasks: 1,  bonus: 150 },
  { key: "execute_closer",       hub: "execute", label: "Closer",           description: "5 Execute tasks — ops in motion.",    requiredTasks: 5,  bonus: 400 },
  { key: "execute_master",       hub: "execute", label: "Portfolio Builder", description: "15 Execute tasks. Capital deployed.", requiredTasks: 15, bonus: 750 },
];

export function achievementsForHub(hub: Hub): HubAchievement[] {
  return HUB_ACHIEVEMENTS.filter((a) => a.hub === hub);
}

// Which achievements unlock at exactly `taskCount` tasks in a hub?
export function achievementsUnlockedAt(hub: Hub, taskCount: number, priorCount: number): HubAchievement[] {
  return HUB_ACHIEVEMENTS.filter(
    (a) => a.hub === hub && a.requiredTasks > priorCount && a.requiredTasks <= taskCount,
  );
}

// ─── Reward payload (returned to client for CreditPopup) ──────────────────────
// Exported here (pure shape, no server imports) so client components can type
// against it without pulling in next/headers.

export interface TaskRewardPayload {
  base: number;
  streakBonus: number;
  streak: number;
  streakMult: number;
  milestoneHit: number | null;
  milestoneBonus: number;
  achievementsEarned: { key: string; label: string; bonus: number }[];
  totalEarned: number;
  newBalance: number;
  hub: Hub;
}

// ─── Wallet-side summary shape ────────────────────────────────────────────────
// Pure interface — the actual DB fetch lives in lib/gamification-server.ts.

export interface GamificationSummary {
  streak: StreakState;
  totalTasks: number;
  lastMilestone: number;
  earnedFromExecution: number;
  achievements: {
    id: string;
    key: string;
    hub: string;
    label: string;
    bonus: number;
    earnedAt: string;
  }[];
}

// Whether this week's streak freeze is still available (pure, safe anywhere)
export function freezeAvailable(freezeUsedAt: string | null): boolean {
  if (!freezeUsedAt) return true;
  const used = new Date(freezeUsedAt).getTime();
  const weekAgo = Date.now() - 7 * 86_400_000;
  return used < weekAgo;
}
