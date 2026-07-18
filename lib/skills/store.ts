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
  /** The artifact this run produced (when run through the session-attached path). */
  artifactId?: string | null;
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
    artifact_id: run.artifactId ?? null,
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

/** A read-model row for the session evidence panel (skill_runs, org-scoped). */
export interface SkillRunView {
  id: string;
  skillId: string;
  skillVersion: string;
  executiveKey: string;
  status: string;
  approvalTier: number;
  requiresApproval: boolean;
  risk: string;
  confidence: number;
  completeness: number;
  missingData: string[];
  sourceCounts: { fact: number; assumption: number; calculation: number; generated: number };
  artifactId: string | null;
  createdAt: string;
}

interface SkillRunRow {
  id: string;
  skill_id: string;
  skill_version: string;
  executive_key: string;
  status: string;
  approval_tier: number;
  requires_approval: boolean;
  risk: string;
  confidence: number;
  completeness: number;
  missing_data: unknown;
  sources: unknown;
  artifact_id: string | null;
  created_at: string;
}

function countSources(sources: unknown): SkillRunView["sourceCounts"] {
  const counts = { fact: 0, assumption: 0, calculation: 0, generated: 0 };
  if (Array.isArray(sources)) {
    for (const s of sources) {
      const kind = (s as { kind?: string })?.kind;
      if (kind && kind in counts) counts[kind as keyof typeof counts] += 1;
    }
  }
  return counts;
}

/** Skill runs for a session — the evidence feed (best-effort; empty on error). */
export async function listSkillRunsForSession(
  supabase: Db,
  orgId: string,
  sessionId: string,
  limit = 50,
): Promise<SkillRunView[]> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => ReturnType<Db["from"]> })
    .from("skill_runs")
    .select("id,skill_id,skill_version,executive_key,status,approval_tier,requires_approval,risk,confidence,completeness,missing_data,sources,artifact_id,created_at")
    .eq("organization_id", orgId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as SkillRunRow[]).map((r) => ({
    id: r.id,
    skillId: r.skill_id,
    skillVersion: r.skill_version,
    executiveKey: r.executive_key,
    status: r.status,
    approvalTier: r.approval_tier,
    requiresApproval: r.requires_approval,
    risk: r.risk,
    confidence: r.confidence,
    completeness: r.completeness,
    missingData: Array.isArray(r.missing_data) ? (r.missing_data as string[]) : [],
    sourceCounts: countSources(r.sources),
    artifactId: r.artifact_id,
    createdAt: r.created_at,
  }));
}
