// Brain runtime — the activation primitive.
//
// activateBrain() is what a Workflow step calls: it hands a Brain a goal +
// context + documents + autonomy, the Brain (a) retrieves relevant document
// context, (b) reasons via the LLM (or a deterministic stub when unkeyed), and
// (c) logs a brain_runs row for the session "Brains at work" view and the audit
// trail. This is additive — it sits alongside the existing task engine; the
// engine can call it to execute a step instead of running a module directly.

import type { Json } from "@/lib/supabase/database.types";
import { getBrain } from "@/lib/brains/catalog";
import { complete, brainsLive } from "@/lib/brains/llm";
import { vectorStore } from "@/lib/brains/vector";
import type { BrainContext, BrainGoal, BrainResult, BrainKey } from "@/lib/brains/types";

function buildSystem(preamble: string, reasoningStyle: string): string {
  return `${preamble}\n\nReasoning style: ${reasoningStyle}\nBe concrete and useful. Lead with the outcome. No preamble, no filler.`;
}

function buildPrompt(goal: BrainGoal, retrieved: { source: string; text: string }[]): string {
  const parts: string[] = [`Goal: ${goal.objective}`];
  if (goal.context) parts.push(`\nContext:\n${goal.context}`);
  if (retrieved.length) {
    const ctx = retrieved.map((r) => `[${r.source}]\n${r.text}`).join("\n\n");
    parts.push(`\nRelevant passages from the provided documents:\n${ctx}`);
  }
  parts.push(`\nProduce your deliverable for this goal.`);
  return parts.join("\n");
}

// Deterministic fallback so the loop is demoable with zero spend / no API key.
function stubOutput(brainName: string, goal: BrainGoal, retrieved: { source: string }[]): string {
  const sources = Array.from(new Set(retrieved.map((r) => r.source)));
  const grounding = sources.length
    ? ` Grounded in: ${sources.join(", ")}.`
    : "";
  return (
    `[${brainName}] Goal addressed: ${goal.objective}.${grounding}\n\n` +
    `This is a deterministic preview. Connect ANTHROPIC_API_KEY to have ${brainName} ` +
    `produce a full, document-grounded deliverable.`
  );
}

export interface ActivateOptions {
  // When false, skip persisting the brain_runs row (e.g. dry runs / previews).
  log?: boolean;
}

export async function activateBrain(
  ctx: BrainContext,
  brainKey: BrainKey,
  goal: BrainGoal,
  options: ActivateOptions = {},
): Promise<BrainResult> {
  const brain = getBrain(brainKey);
  if (!brain) {
    return {
      runId: null,
      brainKey,
      status: "failed",
      output: `Unknown brain: ${brainKey}`,
      toolsUsed: [],
      reasoning: "No such brain in the catalog.",
    };
  }

  const docs = goal.documents ?? [];
  const retrieved = docs.length ? vectorStore.retrieve(goal.objective, docs) : [];

  // Tools the Brain "used" this run: its document-retrieval tool when docs were
  // supplied, plus whatever the goal allowed (defaults to all of the Brain's).
  const allowed = goal.allowedTools ?? brain.tools.map((t) => t.id);
  const toolsUsed = brain.tools
    .filter((t) => allowed.includes(t.id))
    .filter((t) => t.id !== "vector_retrieve" || retrieved.length > 0)
    .map((t) => t.id);

  const system = buildSystem(brain.systemPreamble, brain.reasoningStyle);
  const prompt = buildPrompt(goal, retrieved);

  const llmText = await complete({ system, prompt });
  const output = llmText ?? stubOutput(brain.name, goal, retrieved);
  const reasoning = brainsLive()
    ? `${brain.name} reasoned over ${retrieved.length} retrieved passage(s) using a ${brain.riskProfile}-risk profile.`
    : `${brain.name} ran in preview mode (no model key); ${retrieved.length} passage(s) retrieved.`;

  let runId: string | null = null;
  if (options.log !== false) {
    const { data } = await ctx.supabase
      .from("brain_runs")
      .insert({
        organization_id: ctx.orgId,
        session_id: ctx.sessionId ?? null,
        brain_key: brain.key,
        goal: goal.objective.slice(0, 2000),
        autonomy_mode: goal.autonomy ?? "manual",
        status: "completed",
        input: { context: goal.context ?? null, documents: docs.map((d) => d.name) } as Json,
        output: { text: output } as Json,
        tools_used: toolsUsed,
        reasoning,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    runId = data?.id ?? null;
  }

  return {
    runId,
    brainKey: brain.key,
    status: "completed",
    output,
    toolsUsed,
    reasoning,
  };
}
