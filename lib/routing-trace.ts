// lib/routing-trace.ts
// Feature 01 — Agent Routing Console
//
// Records agent routing decisions to `routing_events` and exposes query
// helpers that back the Routing Console UI. All operations use the
// service-role client so they succeed regardless of the calling user's RLS
// context. Errors are non-fatal: callers receive null / empty arrays.
//
// NOTE: This file replaces the earlier pure-UI routing-trace module. The
// UI helpers (buildRoutingTrace, buildOutcome, etc.) have been moved to
// lib/routing-trace-ui.ts so existing imports continue to work.

import { createServiceClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoutingEvent {
  id: string;
  task_id: string;
  step_id?: string;
  org_id: string;
  agent_key: string;
  rationale_json?: Record<string, unknown>;
  confidence?: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// recordRoutingDecision
// ---------------------------------------------------------------------------

/**
 * Inserts a routing decision into `routing_events`.
 * Returns the inserted row on success, or null on any error (non-fatal).
 */
export async function recordRoutingDecision(args: {
  taskId: string;
  stepId?: string;
  orgId: string;
  agentKey: string;
  rationale?: Record<string, unknown>;
  confidence?: number;
}): Promise<RoutingEvent | null> {
  try {
    const db = createServiceClient();

    const payload: Record<string, unknown> = {
      task_id: args.taskId,
      org_id: args.orgId,
      agent_key: args.agentKey,
    };
    if (args.stepId !== undefined) payload.step_id = args.stepId;
    if (args.rationale !== undefined) payload.rationale_json = args.rationale;
    if (args.confidence !== undefined) payload.confidence = args.confidence;

    const { data, error } = await db
      .from("routing_events")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error(
        "[routing-trace] recordRoutingDecision error:",
        error.message,
      );
      return null;
    }

    return data as RoutingEvent;
  } catch (err) {
    console.error(
      "[routing-trace] recordRoutingDecision unexpected error:",
      err,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// getRoutingTrace
// ---------------------------------------------------------------------------

/**
 * Fetches all routing_events for a given task, ordered by created_at
 * ascending (oldest first so the UI can render the decision timeline).
 */
export async function getRoutingTrace(
  taskId: string,
): Promise<RoutingEvent[]> {
  try {
    const db = createServiceClient();

    const { data, error } = await db
      .from("routing_events")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[routing-trace] getRoutingTrace error:", error.message);
      return [];
    }

    return (data ?? []) as RoutingEvent[];
  } catch (err) {
    console.error("[routing-trace] getRoutingTrace unexpected error:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// getAgentWorkload
// ---------------------------------------------------------------------------

/**
 * Returns per-agent event counts for the last 24 hours within an org,
 * sorted descending by active_count. Used by the Routing Console workload
 * panel.
 *
 * Counting is done in JS rather than SQL to avoid dependency on a
 * PostgREST groupBy RPC — keeps the query simple and the code portable.
 */
export async function getAgentWorkload(
  orgId: string,
): Promise<Array<{ agent_key: string; active_count: number }>> {
  try {
    const db = createServiceClient();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await db
      .from("routing_events")
      .select("agent_key")
      .eq("org_id", orgId)
      .gte("created_at", since);

    if (error) {
      console.error("[routing-trace] getAgentWorkload error:", error.message);
      return [];
    }

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const key = (row as { agent_key: string }).agent_key;
      counts[key] = (counts[key] ?? 0) + 1;
    }

    return Object.entries(counts)
      .map(([agent_key, active_count]) => ({ agent_key, active_count }))
      .sort((a, b) => b.active_count - a.active_count);
  } catch (err) {
    console.error("[routing-trace] getAgentWorkload unexpected error:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// overrideStepAgent
// ---------------------------------------------------------------------------

/**
 * Writes an agent override onto a task_step row so the engine respects the
 * operator's manual reassignment. Silently ignored when the table or
 * `agent_override` column does not exist (migration may not have run yet).
 */
export async function overrideStepAgent(
  stepId: string,
  agentKey: string,
): Promise<void> {
  try {
    const db = createServiceClient();

    const { error } = await db
      .from("task_steps")
      .update({ agent_override: agentKey })
      .eq("id", stepId);

    if (error) {
      // Non-fatal: table or column may not exist in the current migration set.
      console.warn(
        "[routing-trace] overrideStepAgent skipped (table/column may be missing):",
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      "[routing-trace] overrideStepAgent unexpected error (ignored):",
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// Re-export pure UI helpers from routing-trace-ui.ts so existing imports
// from "@/lib/routing-trace" continue to work without pulling next/headers
// into client bundles. Consumers that import from this file in a server
// context are fine; the build error arose because Copilot.tsx (client)
// imported from here transitively.
// ---------------------------------------------------------------------------
export {
  desksForSteps,
  buildRoutingTrace,
  buildOutcome,
  fmtClockTime,
} from "@/lib/routing-trace-ui";
export type { TraceState, TraceNode, OutcomeKind, OutcomeSummary } from "@/lib/routing-trace-ui";
