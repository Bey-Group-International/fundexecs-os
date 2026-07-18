// lib/skills/session-run.ts
// Run a governed skill INSIDE a session / workflow with EXPLICIT structured input,
// and surface it through the existing artifact system. Server-only.
//
// This is the safe realization of "skills run in a workflow, reuse existing UI":
// the skill's output becomes a normal `artifacts` row (so it renders wherever
// artifacts already render) and a `skill_runs` row (the evidence feed), both
// linked to the session + workflow. It runs ONLY on the structured input the
// caller supplies — never fabricated input — so the "never invent financial
// values" guarantee holds end to end.

import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { EXECUTIVE_BY_KEY, type ExecutiveKey } from "@/lib/executives/registry";
import { getSkill } from "./registry";
import { executeSkillCore } from "./runner";
import { persistSkillRun } from "./store";
import type { SkillContext, SkillResult } from "./types";

// Only these values exist in the artifact_type enum; fall back to 'analysis'.
const ARTIFACT_TYPES = new Set(["ic_memo", "model", "analysis", "risk_report", "lp_update", "memo", "summary", "other"]);

export interface RunSkillAttachedInput {
  orgId: string;
  actorId: string;
  skillId: string;
  input: unknown;
  executive: ExecutiveKey;
  sessionId?: string | null;
  workflowTaskId?: string | null;
}

export interface RunSkillAttachedResult {
  result: SkillResult;
  artifactId: string | null;
  skillRunId: string | null;
}

/** Render the skill result as a reviewable markdown artifact body. */
function artifactBody(result: SkillResult): string {
  const parts: string[] = [];
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

/**
 * Execute a skill and attach its output to the session/workflow as an artifact +
 * skill_run. Best-effort persistence: the computed result is always returned even
 * if a write fails. Never throws.
 */
export async function runSkillAttached(input: RunSkillAttachedInput): Promise<RunSkillAttachedResult> {
  const ctx: SkillContext = {
    workspaceId: input.orgId,
    principalId: input.actorId,
    executive: input.executive,
    sessionId: input.sessionId ?? null,
    workflowTaskId: input.workflowTaskId ?? null,
  };

  const result = executeSkillCore(input.skillId, input.input, ctx);
  const skill = getSkill(input.skillId);
  const backingAgent = EXECUTIVE_BY_KEY[input.executive]?.backingAgent ?? null;

  let artifactId: string | null = null;
  let skillRunId: string | null = null;

  if (!hasSupabaseServiceEnv()) return { result, artifactId, skillRunId };
  const supabase = createServiceClient();

  // Write the artifact only for a successful run that produced structured output.
  if (result.ok && result.structured != null) {
    const declared = skill?.manifest.artifactTypes?.[0];
    const artifactType = declared && ARTIFACT_TYPES.has(declared) ? declared : "analysis";
    try {
      const { data } = await supabase
        .from("artifacts")
        .insert({
          organization_id: input.orgId,
          workflow_id: input.workflowTaskId ?? null,
          title: `${skill?.manifest.name ?? input.skillId}`,
          artifact_type: artifactType,
          agent: backingAgent,
          content: artifactBody(result),
          created_by: input.actorId,
          provenance: "ai",
          verification_status: "unverified",
        } as never)
        .select("id")
        .maybeSingle();
      artifactId = (data as { id: string } | null)?.id ?? null;
    } catch {
      // best-effort
    }
  }

  try {
    skillRunId = await persistSkillRun(ctx, {
      skillId: input.skillId,
      skillVersion: result.version,
      backingAgent,
      risk: skill?.manifest.riskClassification ?? "low",
      input: input.input,
      result,
      artifactId,
    });
  } catch {
    // best-effort
  }

  // Surface as an artifact.created event so live session views update.
  if (artifactId && input.workflowTaskId) {
    try {
      await supabase.from("task_events").insert({
        task_id: input.workflowTaskId,
        organization_id: input.orgId,
        type: "artifact.created",
        agent: backingAgent,
        payload: { artifact_id: artifactId, skill_id: input.skillId, source: "skill" } as Json,
      } as never);
    } catch {
      // best-effort
    }
  }

  return { result, artifactId, skillRunId };
}
