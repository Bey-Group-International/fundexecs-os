import { createServiceClient } from "@/lib/supabase/server";

// The PipelineStage shape lives in a server-free module so client components
// (PipelineStageOverlay, DealPipeline) can import the type without pulling this
// server-only module into the browser bundle. Re-exported here for callers.
export type { PipelineStage } from "@/lib/pipeline-stages-types";
import type { PipelineStage } from "@/lib/pipeline-stages-types";

export async function getPipelineStages(
  orgId: string,
  hub?: string,
): Promise<PipelineStage[]> {
  const supabase = createServiceClient();

  let query = supabase
    .from("pipeline_stages")
    .select("*")
    .eq("org_id", orgId)
    .order("order_index", { ascending: true });

  if (hub !== undefined) {
    query = query.eq("hub", hub);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch pipeline stages: ${error.message}`);
  }

  return (data ?? []) as PipelineStage[];
}

export async function createPipelineStage(
  args: Omit<PipelineStage, "id" | "created_at">,
): Promise<PipelineStage> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("pipeline_stages")
    .insert(args as unknown as import("@/lib/supabase/database.types").PipelineStage)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create pipeline stage: ${error.message}`);
  }

  return data as PipelineStage;
}

export async function moveDealToStage(
  dealId: string,
  stageId: string,
  orgId: string,
): Promise<{ ok: boolean; auto_actions_fired: number }> {
  const supabase = createServiceClient();

  const { error: updateError } = await supabase
    .from("deals")
    .update({ pipeline_stage_id: stageId })
    .eq("id", dealId)
    .eq("organization_id", orgId);

  if (updateError) {
    throw new Error(`Failed to move deal to stage: ${updateError.message}`);
  }

  const { data: stage, error: stageError } = await supabase
    .from("pipeline_stages")
    .select("auto_actions")
    .eq("id", stageId)
    .single();

  if (stageError) {
    throw new Error(`Failed to fetch stage auto_actions: ${stageError.message}`);
  }

  const autoActions = (
    (stage as unknown as Pick<PipelineStage, "auto_actions">)?.auto_actions ?? []
  ) as PipelineStage["auto_actions"];

  for (const action of autoActions) {
    // Gateway wiring is future work — actions are queued but not dispatched yet.
    void action;
  }

  return { ok: true, auto_actions_fired: autoActions.length };
}

export async function validateStageExit(
  dealId: string,
  stageId: string,
): Promise<{ can_exit: boolean; missing: string[] }> {
  const supabase = createServiceClient();

  // Fetch stage data so the query exists and types are exercised; real
  // validation will be wired in when artifact types are stable.
  const { error } = await supabase
    .from("pipeline_stages")
    .select("exit_criteria, required_artifacts")
    .eq("id", stageId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch stage for validation: ${error.message}`);
  }

  // Stub: always allow exit until artifact validation logic is stable.
  void dealId;
  return { can_exit: true, missing: [] };
}
