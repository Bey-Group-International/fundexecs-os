// lib/gamification-server.ts
// Server-only DB helpers for the gamification system. Imports next/headers
// (via createServiceClient) so must NEVER be imported from client components.
// Pure math/types live in lib/gamification.ts instead.

import { createServiceClient } from "@/lib/supabase/server";
import {
  baseCredits,
  achievementsUnlockedAt,
  type Hub,
  type TaskRewardPayload,
  type GamificationSummary,
  type StreakState,
} from "@/lib/gamification";
import type { TeamTaskPriority } from "@/lib/supabase/database.types";

// The new tables and RPCs added by 20260701120000_gamification.sql are not yet
// in the generated database.types.ts. Using `any` casts here until the types
// are regenerated after the migration lands in the main branch.
type AnyClient = ReturnType<typeof createServiceClient> & Record<string, any>; // new RPCs/tables not yet in generated types

export async function awardTaskCompletion(args: {
  orgId: string;
  taskId: string;
  hub: Hub;
  priority: TeamTaskPriority;
}): Promise<TaskRewardPayload | null> {
  const service = createServiceClient() as AnyClient;
  const base = baseCredits(args.hub, args.priority);

  try {
    const { data, error } = await service.rpc("award_task_credits", {
      p_org:          args.orgId,
      p_task_id:      args.taskId,
      p_hub:          args.hub,
      p_priority:     args.priority,
      p_base_credits: base,
    });

    if (error || !data) return null;

    const d = data as {
      base: number;
      streak_bonus: number;
      streak: number;
      streak_mult: number;
      milestone_hit: number | null;
      milestone_bonus: number;
      total_earned: number;
      new_balance: number;
      hub: string;
    };

    const achievementsEarned = await checkHubAchievements(service, args.orgId, args.hub, args.taskId);

    return {
      base:               d.base,
      streakBonus:        d.streak_bonus,
      streak:             d.streak,
      streakMult:         d.streak_mult,
      milestoneHit:       d.milestone_hit,
      milestoneBonus:     d.milestone_bonus,
      achievementsEarned,
      totalEarned:        d.total_earned + achievementsEarned.reduce((s, a) => s + a.bonus, 0),
      newBalance:         d.new_balance,
      hub:                args.hub,
    };
  } catch {
    return null;
  }
}

async function checkHubAchievements(
  service: AnyClient,
  orgId: string,
  hub: Hub,
  _taskId: string,
): Promise<{ key: string; label: string; bonus: number }[]> {
  const { count } = await service
    .from("team_tasks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("hub", hub)
    .eq("status", "completed");

  const hubCount = (count as number | null) ?? 0;
  const priorCount = hubCount - 1;

  const toUnlock = achievementsUnlockedAt(hub, hubCount, priorCount);
  const earned: { key: string; label: string; bonus: number }[] = [];

  for (const ach of toUnlock) {
    const { data } = await service.rpc("record_hub_achievement", {
      p_org:           orgId,
      p_key:           ach.key,
      p_hub:           hub,
      p_label:         ach.label,
      p_bonus_credits: ach.bonus,
    });
    if (data) {
      earned.push({ key: ach.key, label: ach.label, bonus: ach.bonus });
    }
  }

  return earned;
}

export async function getGamificationSummary(orgId: string): Promise<GamificationSummary> {
  const supabase = createServiceClient() as AnyClient;

  const [streakRes, milestoneRes, ledgerRes, achievementsRes] = await Promise.all([
    supabase
      .from("execution_streaks")
      .select("current_streak, longest_streak, last_activity_at, freeze_used_at")
      .eq("organization_id", orgId)
      .maybeSingle(),

    supabase
      .from("execution_milestones")
      .select("total_tasks, last_milestone")
      .eq("organization_id", orgId)
      .maybeSingle(),

    supabase
      .from("credit_ledger")
      .select("amount")
      .eq("organization_id", orgId)
      .in("reason", ["task_complete", "streak_bonus", "milestone_bonus", "hub_achievement", "quest_complete"])
      .gt("amount", 0),

    supabase
      .from("hub_achievements")
      .select("id, key, hub, label, bonus_credits, earned_at")
      .eq("organization_id", orgId)
      .order("earned_at", { ascending: false }),
  ]);

  const streakData = streakRes.data as {
    current_streak: number;
    longest_streak: number;
    last_activity_at: string | null;
    freeze_used_at: string | null;
  } | null;

  const milestoneData = milestoneRes.data as {
    total_tasks: number;
    last_milestone: number;
  } | null;

  const ledgerRows = (ledgerRes.data ?? []) as { amount: number | null }[];
  const achievementRows = (achievementsRes.data ?? []) as {
    id: string;
    key: string;
    hub: string;
    label: string;
    bonus_credits: number;
    earned_at: string;
  }[];

  const streak: StreakState = {
    current:        streakData?.current_streak    ?? 0,
    longest:        streakData?.longest_streak    ?? 0,
    lastActivityAt: streakData?.last_activity_at  ?? null,
    freezeUsedAt:   streakData?.freeze_used_at    ?? null,
  };

  return {
    streak,
    totalTasks:          milestoneData?.total_tasks    ?? 0,
    lastMilestone:       milestoneData?.last_milestone ?? 0,
    earnedFromExecution: ledgerRows.reduce((s, r) => s + (r.amount ?? 0), 0),
    achievements: achievementRows.map((a) => ({
      id:       a.id,
      key:      a.key,
      hub:      a.hub,
      label:    a.label,
      bonus:    a.bonus_credits,
      earnedAt: a.earned_at,
    })),
  };
}
