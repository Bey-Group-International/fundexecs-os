// lib/routing-trace.ts
// Pure derivation of two operator-facing views over a workflow bundle:
//
//   1. The ROUTING TRACE — the path a request travelled, made legible:
//      Intent → Engine → Hub → Desk (executive) → Gate. Each node carries a
//      timestamp and a state so the UI can show *when* and *where* work was
//      routed, not just a one-line badge.
//
//   2. The OUTCOME — a durable, plain-language receipt of what the operator's
//      decision actually did (approved & automated / accepted / declined),
//      including who-equivalent timing, step completion, and the saved
//      automation. This is what lets the operator know a decision "went
//      through".
//
// Both are pure (no DB, no I/O) so they can be unit-tested and reused.

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
  // Short uppercase label for the node ("Intent", "Engine"…).
  label: string;
  // The routed value ("Diligence", "Diligence Engine"…).
  value: string;
  // Optional secondary line (step count, gate rationale…).
  detail?: string;
  // When this leg happened, ISO. null when not yet reached.
  at: string | null;
  state: TraceState;
}

export type OutcomeKind = "approved" | "accepted" | "declined" | "pending" | "none";

export interface OutcomeSummary {
  kind: OutcomeKind;
  // One-line, plain-language headline ("Approved & automated").
  headline: string;
  // Supporting detail ("4 of 4 steps complete · automation saved").
  detail: string;
  // When the decision landed, ISO.
  at: string | null;
  // The saved automation this decision created, if any (links to Workflows).
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

// The distinct executive desks engaged across a workflow's steps, in first-seen
// order. Falls back to the routed owner when there are no steps yet.
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

// Build the ordered routing trace for a workflow. The first four legs are
// routing decisions (made at creation); the gate leg reflects the approval's
// live state.
export function buildRoutingTrace(bundle: BundleLike): TraceNode[] {
  const { workflow, steps, approval } = bundle;
  const routing = routingFor(workflow, steps);
  const routedAt = workflow.created_at;
  const desks = desksForSteps(steps, routing);

  const gated = workflow.requires_approval;
  const decided = !!approval && approval.decision !== "pending";
  const gateState: TraceState = !gated
    ? "done"
    : decided
      ? "done"
      : "pending";
  const gateValue = !gated
    ? "Internal — auto-run"
    : decided
      ? decisionVerb(approval!.decision)
      : "Your sign-off";
  const gateDetail = !gated
    ? "Tier 1 · Earn proceeds on its own"
    : "Needs the operator before it acts";

  return [
    {
      key: "intent",
      label: "Intent",
      value: capitalize(routing.lifecycle_stage),
      detail: routing.intent || undefined,
      at: routedAt,
      state: "done",
    },
    {
      key: "engine",
      label: "Engine",
      value: routing.target_engine,
      at: routedAt,
      state: "done",
    },
    {
      key: "hub",
      label: "Hub",
      value: capitalize(workflow.hub),
      at: routedAt,
      state: "done",
    },
    {
      key: "desk",
      label: "Desk",
      value: desks[0],
      detail: desks.length > 1 ? `+${desks.length - 1} more` : undefined,
      at: routedAt,
      state: "done",
    },
    {
      key: "gate",
      label: "Gate",
      value: gateValue,
      detail: gateDetail,
      at: decided ? approval!.decided_at : null,
      state: gateState,
    },
  ];
}

function decisionVerb(decision: Approval["decision"]): string {
  switch (decision) {
    case "approved":
      return "Approved";
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Declined";
    case "regenerate":
      return "Re-routing";
    default:
      return "Pending";
  }
}

// Format an ISO timestamp as a short local clock time (e.g. "2:35 PM). Shared by
// the routing trace and the outcome receipt so they read identically. Returns
// `fallback` for a null/invalid timestamp.
export function fmtClockTime(at: string | null, fallback = ""): string {
  if (!at) return fallback;
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? fallback
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Build the durable outcome receipt for a workflow's decision.
export function buildOutcome(bundle: BundleLike): OutcomeSummary {
  const { workflow, steps, approval } = bundle;
  const stepsTotal = steps.length;
  const stepsDone = steps.filter((s) => s.status === "completed").length;
  const base = {
    at: approval?.decided_at ?? null,
    automationId: workflow.automation_id,
    stepsDone,
    stepsTotal,
  };

  if (!approval || approval.decision === "pending") {
    return approval
      ? {
          kind: "pending",
          headline: "Awaiting your decision",
          detail: stepsTotal
            ? `${stepsTotal} step${stepsTotal === 1 ? "" : "s"} planned`
            : "Plan ready for review",
          ...base,
        }
      : { kind: "none", headline: "", detail: "", ...base };
  }

  if (approval.decision === "approved") {
    const ran = stepsTotal ? `${stepsDone} of ${stepsTotal} steps complete` : "Automation running";
    return {
      kind: "approved",
      headline: "Approved & automated",
      detail: workflow.automation_id ? `${ran} · automation saved` : ran,
      ...base,
    };
  }

  if (approval.decision === "accepted") {
    return {
      kind: "accepted",
      headline: "Accepted as recommendation",
      detail: "Captured as a deliverable — no agents ran",
      ...base,
    };
  }

  if (approval.decision === "rejected") {
    return { kind: "declined", headline: "Declined", detail: "This plan was dismissed", ...base };
  }

  // "regenerate" lands the operator back in a fresh pending plan — treat as pending.
  return {
    kind: "pending",
    headline: "Refining the plan",
    detail: "Earn is rebuilding from your input",
    ...base,
  };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
