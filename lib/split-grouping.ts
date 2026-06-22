// lib/split-grouping.ts
// Pure helper for the Copilot "split prompt" chip. The Intelligence Layer can
// split one operator prompt into several independent sibling workflows; all
// siblings carry the same non-null `prompt_id`. This computes, per workflow,
// its position within its split group (1-of-N) so the UI can surface that a set
// of workflows came from one request. Single-workflow prompts (and any null
// `prompt_id`) are never grouped and get no entry.

// The minimal shape this helper needs from a workflow Task. Kept structural so
// it composes with both `Task` and a workflow bundle without a hard import.
export interface SplitWorkflow {
  id: string;
  prompt_id: string | null;
  created_at: string;
  step_order: number;
}

// A workflow's place within its split group, e.g. { index: 1, total: 2 }.
export interface SplitPosition {
  index: number;
  total: number;
}

// Map each split workflow's id to its 1-based position within its sibling
// group. Workflows whose `prompt_id` is null, or whose group has only one
// member, are omitted — callers treat "no entry" as "show no chip".
export function splitPositions(workflows: SplitWorkflow[]): Map<string, SplitPosition> {
  const groups = new Map<string, SplitWorkflow[]>();
  for (const wf of workflows) {
    if (!wf.prompt_id) continue;
    const group = groups.get(wf.prompt_id);
    if (group) group.push(wf);
    else groups.set(wf.prompt_id, [wf]);
  }

  const positions = new Map<string, SplitPosition>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Stable sibling order: by creation time, then step_order as a tiebreaker.
    const ordered = [...group].sort((a, b) => {
      const byTime = (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0);
      return byTime !== 0 ? byTime : a.step_order - b.step_order;
    });
    ordered.forEach((wf, i) => {
      positions.set(wf.id, { index: i + 1, total: ordered.length });
    });
  }
  return positions;
}
