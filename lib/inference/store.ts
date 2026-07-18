// lib/inference/store.ts
// Persistence for inference_runs — the inference-run telemetry ledger. Server-
// only, org-scoped, append-only. Every runInference() call's telemetry
// (provider, model, tokens, latency, degraded) is recorded here so provider-
// agnostic model use stays accountable after the fact.
//
// The table is new, so (like lib/skills/store.ts) it is reached through a narrow
// unknown-cast until the generated DB types are regenerated. Best-effort: on any
// failure it returns null and never throws — telemetry must never break a run.

import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import type { InferenceResult } from "./types";

type Db = ReturnType<typeof createServiceClient>;

export interface PersistInferenceRunInput {
  orgId: string;
  actorId?: string | null;
  result: InferenceResult;
  capability?: string | null;
  preferTier?: string | null;
  sensitivity?: string | null;
  purpose?: string | null;
  sessionId?: string | null;
  workflowTaskId?: string | null;
}

/** Persist one inference-gateway run. Best-effort; never throws. */
export async function persistInferenceRun(input: PersistInferenceRunInput): Promise<string | null> {
  if (!hasSupabaseServiceEnv()) return null;
  const supabase = createServiceClient();

  const { result } = input;
  const row = {
    organization_id: input.orgId,
    capability: input.capability ?? null,
    provider: result.provider,
    model: result.model,
    prefer_tier: input.preferTier ?? null,
    sensitivity: input.sensitivity ?? null,
    ok: result.ok,
    degraded: result.degraded,
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    latency_ms: result.latencyMs,
    purpose: input.purpose ?? null,
    session_id: input.sessionId ?? null,
    workflow_task_id: input.workflowTaskId ?? null,
    error: result.error ?? null,
    created_by: input.actorId ?? null,
  };

  try {
    const { data, error } = await (supabase as unknown as { from: (t: string) => ReturnType<Db["from"]> })
      .from("inference_runs")
      .insert(row as never)
      .select("id")
      .maybeSingle();
    if (!error && data) return (data as unknown as { id: string }).id;
  } catch {
    // swallow — telemetry is best-effort and must never break a run.
  }
  return null;
}
