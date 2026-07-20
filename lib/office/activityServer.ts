// Server-only: fetch live agent activity for the Virtual Office.
//
// Reads the org's recent tasks + task_events and folds them into per-agent
// activity via the pure `deriveAgentActivity`. Fully defensive — a missing
// Supabase env or any query error returns an all-resting map rather than
// throwing, so the office always renders.
import "server-only";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { AGENTS } from "@/lib/agents";
import type { AgentKey } from "@/lib/supabase/database.types";
import {
  deriveAgentActivity,
  restingActivity,
  type AgentActivity,
  type TaskRow,
  type TaskEventRow,
} from "./activity";

// Every agent key this module guarantees an entry for. Callers can rely on
// each of these being present in the returned map.
export const ACTIVITY_AGENT_KEYS: AgentKey[] = AGENTS.map((a) => a.key);

// How many recent rows to scan per table. Bounded so a busy org stays cheap;
// the derivation only needs the freshest signal per agent.
const RECENT_LIMIT = 50;

/** An all-resting map — the safe fallback for every failure path. */
function allResting(): Record<string, AgentActivity> {
  const out: Record<string, AgentActivity> = {};
  for (const key of ACTIVITY_AGENT_KEYS) out[key] = restingActivity(key);
  return out;
}

/**
 * Live activity for every agent in `orgId`, keyed by agent key. Returns an
 * all-resting map when Supabase env is absent or on any query error; never
 * throws.
 */
export async function fetchAgentActivity(
  orgId: string,
): Promise<Record<string, AgentActivity>> {
  if (!hasSupabaseServerEnv()) return allResting();

  try {
    const supabase = await createServerClient();
    const [tasksRes, eventsRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT),
      supabase
        .from("task_events")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT),
    ]);

    if (tasksRes.error || eventsRes.error) return allResting();

    return deriveAgentActivity({
      tasks: (tasksRes.data ?? []) as TaskRow[],
      events: (eventsRes.data ?? []) as TaskEventRow[],
    });
  } catch {
    return allResting();
  }
}
