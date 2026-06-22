// Routing Review queue: the workflows a human should confirm or fix the route
// for. Two signals put a workflow here — the Intelligence Layer routed it with
// LOW confidence (it fell back to the hub default, no positive classification),
// or an operator ESCALATED it (a stuck workflow, surfaced as an
// operator_feedback row with signal "escalate"). Pure + deterministic so it's
// unit-tested and behaves identically on server and client.
import { routingFromTask } from "@/lib/intelligence";
import type { GridWorkflow } from "@/lib/execution-grid";

// Why a workflow landed in the review queue.
export type ReviewReason = "low_confidence" | "escalated" | "both";

// A workflow that needs review, annotated with the reason it surfaced. Carries
// the underlying workflow so the UI can render its current engine, session
// link, and an inline re-route control.
export interface ReviewItem<W extends GridWorkflow = GridWorkflow> {
  workflow: W;
  reason: ReviewReason;
}

// A workflow's route is low-confidence when recomputing it lands on the hub
// default with no rule match. Mirrors the recomputation in ExecutionGrid.
function isLowConfidence(w: GridWorkflow): boolean {
  return (
    routingFromTask({
      prompt: w.description || w.title,
      hub: w.hub,
      agents: [],
      stage: w.lifecycle_stage,
    }).confidence === "low"
  );
}

/**
 * The subset of `workflows` that needs a human to confirm or fix its route:
 * low-confidence routes and/or escalated workflows. Each result is annotated
 * with `reason` ("both" when it is both low-confidence and escalated). Input
 * order is preserved (callers pass newest-first).
 */
export function reviewItems<W extends GridWorkflow>(
  workflows: W[],
  escalatedIds: Set<string>,
): ReviewItem<W>[] {
  const out: ReviewItem<W>[] = [];
  for (const workflow of workflows) {
    const low = isLowConfidence(workflow);
    const escalated = escalatedIds.has(workflow.id);
    if (!low && !escalated) continue;
    const reason: ReviewReason = low && escalated ? "both" : low ? "low_confidence" : "escalated";
    out.push({ workflow, reason });
  }
  return out;
}
