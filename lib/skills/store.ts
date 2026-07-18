// lib/skills/store.ts
// Persistence for skill_runs. Server-only, org-scoped. The table is new, so (like
// lib/proactive/items.ts) it is reached through a narrow unknown-cast until the
// generated DB types are regenerated. Each run also writes an immutable audit
// event, so every skill execution is accountable.

import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { writeDashboardAudit } from "@/lib/dashboard/audit";
import type { Json } from "@/lib/supabase/database.types";
import type { RiskClassification, SkillContext, SkillResult } from "./types";

type Db = ReturnType<typeof createServiceClient>;

export interface PersistSkillRunInput {
  skillId: string;
  skillVersion: string;
  backingAgent: string | null;
  risk: RiskClassification;
  input: unknown;
  result: SkillResult;
}

/** Persist one skill run + an audit event. Best-effort; never throws. */
export async function persistSkillRun(ctx: SkillContext, run: PersistSkillRunInput): Promise<string | null> {
  if (!hasSupabaseServiceEnv()) return null;
  const supabase = createServiceClient();

  const row = {
    organization_id: ctx.workspaceId,
    skill_id: run.skillId,
    skill_version: run.skillVersion,
    executive_key: ctx.executive,
    backing_agent: run.backingAgent,
    session_id: ctx.sessionId ?? null,
    workflow_task_id: ctx.workflowTaskId ?? null,
    status: run.result.status,
    approval_tier: run.result.approvalTier,
    risk: run.risk,
    confidence: run.result.confidence,
    completeness: run.result.completeness,
    requires_approval: run.result.requiresApproval,
    input: run.input as Json,
    output: (run.result.structured ?? null) as Json,
    sources: run.result.sources as unknown as Json,
    missing_data: run.result.missingData as unknown as Json,
    validation: { input: run.result.inputValidation, output: run.result.outputValidation } as unknown as Json,
    provider: null,
    model: null,
    artifact_id: null,
    error: run.result.ok ? null : run.result.warnings.join("; "),
    created_by: ctx.principalId,
  };

  let id: string | null = null;
  try {
    const { data, error } = await (supabase as unknown as { from: (t: string) => ReturnType<Db["from"]> })
      .from("skill_runs")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (!error && data) id = (data as unknown as { id: string }).id;
  } catch {
    // swallow
  }

  // Immutable audit trail — every skill run is accountable, pass or fail.
  try {
    await writeDashboardAudit({
      organizationId: ctx.workspaceId,
      principalId: ctx.principalId,
      action: `skill.${run.result.status}`,
      entityType: "skill_run",
      entityId: id,
      afterState: {
        skillId: run.skillId,
        version: run.skillVersion,
        executive: ctx.executive,
        approvalTier: run.result.approvalTier,
        requiresApproval: run.result.requiresApproval,
        confidence: run.result.confidence,
        completeness: run.result.completeness,
      } as Json,
    });
  } catch {
    // swallow
  }

  return id;
}
