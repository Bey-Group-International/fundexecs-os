// lib/skills/engine-run.ts
// Run a PLANNED skill inside the workflow engine and return its rendered output as
// the step's deliverable text. Server-only, additive, defensive.
//
// Unlike session-run.ts (which creates its own artifact), this helper deliberately
// does NOT persist an artifact: the engine's own step pipeline persists the step
// deliverable exactly as it does for a free-text step, so the skill output flows
// through the same grounding / critique / approval gate as any other deliverable —
// no double artifact, no bypassed review. It only records a best-effort `skill_run`
// evidence row so the governed execution shows in the "Skills at work" feed.

import { EXECUTIVE_BY_KEY } from "@/lib/executives/registry";
import { getSkill } from "./registry";
import { executeSkillCore } from "./runner";
import { persistSkillRun } from "./store";
import type { SkillContext, SkillResult } from "./types";
import type { SkillPlan } from "./skill-planner";

/** Render a skill result as reviewable markdown for the step deliverable. */
function renderOutput(name: string, result: SkillResult): string {
  const parts: string[] = [`# ${name}`];
  if (result.narrative) parts.push(result.narrative);
  parts.push("\n## Structured output\n```json\n" + JSON.stringify(result.structured, null, 2) + "\n```");
  if (result.sources.length) {
    parts.push("\n## Provenance");
    for (const s of result.sources) {
      const val = s.value != null ? ` — ${s.value}` : "";
      parts.push(`- **[${s.kind}]** ${s.label}${val}${s.ref ? ` _(${s.ref})_` : ""}`);
    }
  }
  if (result.missingData.length) {
    parts.push("\n## Missing data (flagged, not invented)\n" + result.missingData.map((m) => `- ${m}`).join("\n"));
  }
  return parts.join("\n");
}

export interface ExecutePlannedSkillInput {
  orgId: string;
  actorId: string;
  plan: SkillPlan;
  sessionId?: string | null;
  workflowTaskId?: string | null;
}

export interface ExecutePlannedSkillResult {
  ok: boolean;
  output: string;
  backingAgent: string | null;
}

/**
 * Execute a planned skill's governed core and return its rendered output. Best-effort
 * evidence persistence; never throws — a failure returns ok:false with a readable
 * message so the caller can treat it as a normal step failure.
 */
export async function executePlannedSkill(input: ExecutePlannedSkillInput): Promise<ExecutePlannedSkillResult> {
  const { plan } = input;
  const skill = getSkill(plan.skillId);
  const backingAgent = EXECUTIVE_BY_KEY[plan.executive]?.backingAgent ?? null;
  const ctx: SkillContext = {
    workspaceId: input.orgId,
    principalId: input.actorId,
    executive: plan.executive,
    sessionId: input.sessionId ?? null,
    workflowTaskId: input.workflowTaskId ?? null,
  };

  const result = executeSkillCore(plan.skillId, plan.input, ctx);

  // Best-effort evidence row; the engine persists the artifact itself.
  try {
    await persistSkillRun(ctx, {
      skillId: plan.skillId,
      skillVersion: result.version,
      backingAgent,
      risk: skill?.manifest.riskClassification ?? "low",
      input: plan.input,
      result,
      artifactId: null,
    });
  } catch {
    // evidence is supplementary; never let it break the step
  }

  if (!result.ok) {
    const why = result.warnings[0] || "skill did not produce output";
    return { ok: false, output: `Skill ${plan.skillId} could not run: ${why}`, backingAgent };
  }
  return { ok: true, output: renderOutput(skill?.manifest.name ?? plan.skillId, result), backingAgent };
}
