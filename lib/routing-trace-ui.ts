// lib/routing-trace-ui.ts
// Pure (no DB, no I/O) UI helpers for the routing trace and outcome receipt.
// Safe to import from client components.

import type { Task, Approval } from "@/lib/supabase/database.types";
import {
  routingFromTask,
  executiveForAgent,
  EXECUTIVE_LABEL,
  type RoutingObject,
} from "@/lib/intelligence";

export type TraceState = "done" | "active" | "pending";

export interface TraceNode {
  key: "intent" | "engine" | "hub" | "desk" | "gate";
  label: string;
  value: string;
  detail?: string;
  at: string | null;
  state: TraceState;
}

export type OutcomeKind = "approved" | "accepted" | "declined" | "pending" | "none";

export interface OutcomeSummary {
  kind: OutcomeKind;
  headline: string;
  detail: string;
  at: string | null;
  automationId: string | null;
  stepsDone: number;
  stepsTotal: number;
}

interface BundleLike {
  workflow: Task;
  steps: Task[];
  approval: Approval | null;
}

function routingFor(workflow: Task, steps: Task[]): RoutingObject {
  return routingFromTask({
    prompt: workflow.description || workflow.title,
    hub: workflow.hub,
    agents: steps.map((s) => s.assigned_agent),
    stage: workflow.lifecycle_stage,
  });
}

export function desksForSteps(steps: Task[], routing: RoutingObject): string[] {
  const seen = new Set<string>();
  const desks: string[] = [];
  for (const step of steps) {
    const label = EXECUTIVE_LABEL[executiveForAgent(step.assigned_agent)];
    if (!seen.has(label)) {
      seen.add(label);
      desks.push(label);
    }
  }
  if (desks.length === 0) desks.push(EXECUTIVE_LABEL[routing.assigned_to]);
  return desks;
}

export function buildRoutingTrace(bundle: BundleLike): TraceNode[] {
  const { workflow, steps, approval } = bundle;
  const routing = routingFor(workflow, steps);
  const routedAt = workflow.created_at;
  const desks = desksForSteps(steps, routing);

  const gated = workflow.requires_approval;
  const decided = !!approval && approval.decision !== "pending";
  const gateState: TraceState = !gated ? "done" : decided ? "done" : "pending";
  const gateValue = !gated
    ? "Internal — auto-run"
    : decided
      ? decisionVerb(approval!.decision)
      : "Your sign-off";
  const gateDetail = !gated
    ? "Tier 1 · Earn proceeds on its own"
    : "Needs the operator before it acts";

  return [
    { key: "intent", label: "Intent", value: capitalize(routing.lifecycle_stage), detail: routing.intent || undefined, at: routedAt, state: "done" },
    { key: "engine", label: "Engine", value: routing.target_engine, at: routedAt, state: "done" },
    { key: "hub", label: "Hub", value: capitalize(workflow.hub), at: routedAt, state: "done" },
    { key: "desk", label: "Desk", value: desks[0], detail: desks.length > 1 ? `+${desks.length - 1} more` : undefined, at: routedAt, state: "done" },
    { key: "gate", label: "Gate", value: gateValue, detail: gateDetail, at: decided ? approval!.decided_at : null, state: gateState },
  ];
}

function decisionVerb(decision: Approval["decision"]): string {
  switch (decision) {
    case "approved": return "Approved";
    case "accepted": return "Accepted";
    case "rejected": return "Declined";
    case "regenerate": return "Re-routing";
    default: return "Pending";
  }
}

export function fmtClockTime(at: string | null, fallback = ""): string {
  if (!at) return fallback;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? fallback : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function buildOutcome(bundle: BundleLike): OutcomeSummary {
  const { workflow, steps, approval } = bundle;
  const stepsTotal = steps.length;
  const stepsDone = steps.filter((s) => s.status === "completed").length;
  const base = { at: approval?.decided_at ?? null, automationId: workflow.automation_id, stepsDone, stepsTotal };

  if (!approval || approval.decision === "pending") {
    return approval
      ? { kind: "pending", headline: "Awaiting your decision", detail: stepsTotal ? `${stepsTotal} step${stepsTotal === 1 ? "" : "s"} planned` : "Plan ready for review", ...base }
      : { kind: "none", headline: "", detail: "", ...base };
  }

  if (approval.decision === "approved") {
    const ran = stepsTotal ? `${stepsDone} of ${stepsTotal} steps complete` : "Automation running";
    return { kind: "approved", headline: "Approved & automated", detail: workflow.automation_id ? `${ran} · automation saved` : ran, ...base };
  }

  if (approval.decision === "accepted") {
    return { kind: "accepted", headline: "Accepted as recommendation", detail: "Captured as a deliverable — no agents ran", ...base };
  }

  if (approval.decision === "rejected") {
    return { kind: "declined", headline: "Declined", detail: "This plan was dismissed", ...base };
  }

  return { kind: "pending", headline: "Refining the plan", detail: "Earn is rebuilding from your input", ...base };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
