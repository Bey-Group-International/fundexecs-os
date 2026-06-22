// The Execution Grid (spec section 8): every routed workflow surfaced in the
// pane of the engine it was routed to. Pure + deterministic so it's unit-tested
// and renders identically on server and client.
import type { Hub } from "@/lib/supabase/database.types";
import { TARGET_ENGINES, routingFromTask, type TargetEngine } from "@/lib/intelligence";

// The minimal workflow shape the grid needs (a parent task row).
export interface GridWorkflow {
  id: string;
  title: string;
  status: string;
  session_id: string | null;
  created_at: string;
  hub: Hub;
  description: string | null;
  lifecycle_stage: string | null;
  target_engine: string | null;
}

export interface EnginePane {
  engine: TargetEngine;
  workflows: GridWorkflow[];
  total: number;
  active: number; // awaiting approval or in progress
  done: number; // completed
}

const ACTIVE_STATUSES = new Set(["awaiting_approval", "in_progress", "pending"]);

// The engine a workflow belongs to — its persisted target_engine, with a
// deterministic fallback for rows written before routing was persisted.
export function engineOfWorkflow(w: GridWorkflow): TargetEngine {
  return routingFromTask({
    prompt: w.description || w.title,
    hub: w.hub,
    agents: [],
    stage: w.lifecycle_stage,
  }).target_engine;
}

// URL-safe slug for an engine pane (e.g. "Diligence Engine" → "diligence-engine").
export function engineSlug(engine: TargetEngine): string {
  return engine.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Resolve a slug back to its engine, or null if it matches none of the seven.
export function engineFromSlug(slug: string): TargetEngine | null {
  return TARGET_ENGINES.find((e) => engineSlug(e) === slug) ?? null;
}

/**
 * Group workflows into the seven Execution Grid panes. Every engine is present
 * (empty panes included) and in canonical order; within a pane, input order is
 * preserved (callers pass newest-first).
 */
export function groupByEngine(workflows: GridWorkflow[]): EnginePane[] {
  const byEngine = new Map<TargetEngine, GridWorkflow[]>();
  for (const e of TARGET_ENGINES) byEngine.set(e, []);
  for (const w of workflows) byEngine.get(engineOfWorkflow(w))!.push(w);
  return TARGET_ENGINES.map((engine) => {
    const list = byEngine.get(engine)!;
    return {
      engine,
      workflows: list,
      total: list.length,
      active: list.filter((w) => ACTIVE_STATUSES.has(w.status)).length,
      done: list.filter((w) => w.status === "completed").length,
    };
  });
}
