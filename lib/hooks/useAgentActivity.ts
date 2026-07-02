"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AgentKey } from "@/lib/supabase/database.types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentStatus = "idle" | "working" | "awaiting" | "completed";

export type AgentActivityInfo = {
  status: AgentStatus;
  taskTitle?: string;
  taskCount: number;
  since?: string;
};

export type AgentActivityMap = Record<string, AgentActivityInfo>;

// ─── AgentKey → exec id mapping ───────────────────────────────────────────────

const AGENT_KEY_TO_EXEC_ID: Record<string, string> = {
  associate:           "earnest-fundmaker",
  capital_connector:   "capital-connector",
  deal_sourcer:        "deal-sourcer",
  capital_raiser:      "capital-raiser",
  investor_relations:  "investor-relations",
  portfolio_ops:       "automater",
  diligence:           "workflow-instructor",
  fund_admin:          "legal-admin",
  executive_advisor:   "executive-advisor",
  rainmaker:           "rainmaker",
  lead_generator:      "lead-generator",
  pr_director:         "pr-director",
  seo_disruptor:       "seo-disruptor",
  curator:             "curator",
};

export function agentKeyToExecId(agentKey: string): string | null {
  return AGENT_KEY_TO_EXEC_ID[agentKey] ?? null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

type ActiveTask = {
  id: string;
  assigned_agent: AgentKey;
  status: string;
  title: string;
  created_at: string;
};

function buildActivityMap(tasks: ActiveTask[]): AgentActivityMap {
  const map: AgentActivityMap = {};

  for (const task of tasks) {
    const key = task.assigned_agent as string;
    const existing = map[key];
    const status: AgentStatus =
      task.status === "in_progress" ? "working" : "awaiting";

    if (!existing) {
      map[key] = {
        status,
        taskTitle: task.title,
        taskCount: 1,
        since: task.created_at,
      };
    } else {
      // Prefer "working" over "awaiting"; increment count
      map[key] = {
        status: existing.status === "working" ? "working" : status,
        taskTitle: existing.status === "working" ? existing.taskTitle : task.title,
        taskCount: existing.taskCount + 1,
        since: existing.since,
      };
    }
  }

  return map;
}

export function useAgentActivity(): AgentActivityMap {
  const [activityMap, setActivityMap] = useState<AgentActivityMap>({});

  useEffect(() => {
    const supabase = createClient();

    // Initial fetch of active tasks
    supabase
      .from("tasks")
      .select("id, assigned_agent, status, title, created_at")
      .in("status", ["in_progress", "awaiting_approval"])
      .then(({ data }) => {
        if (data) setActivityMap(buildActivityMap(data as ActiveTask[]));
      });

    // Subscribe to realtime changes
    const channel = supabase
      .channel("agent-activity-hq")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks" },
        async () => {
          const { data } = await supabase
            .from("tasks")
            .select("id, assigned_agent, status, title, created_at")
            .in("status", ["in_progress", "awaiting_approval"]);
          if (data) setActivityMap(buildActivityMap(data as ActiveTask[]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks" },
        async () => {
          const { data } = await supabase
            .from("tasks")
            .select("id, assigned_agent, status, title, created_at")
            .in("status", ["in_progress", "awaiting_approval"]);
          if (data) setActivityMap(buildActivityMap(data as ActiveTask[]));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return activityMap;
}
