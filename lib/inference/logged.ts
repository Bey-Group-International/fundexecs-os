// lib/inference/logged.ts
// The logged inference wrapper — runInference() plus durable telemetry. A caller
// that wants its inference-gateway call recorded in the inference_runs ledger
// uses this instead of runInference() directly: it runs the request, then best-
// effort persists the telemetry (provider, model, tokens, latency, degraded)
// scoped to the org. Persistence is fire-and-record — a store failure never
// affects the returned InferenceResult, and this never throws.

import { runInference } from "./gateway";
import { persistInferenceRun } from "./store";
import type { InferenceRequest, InferenceResult } from "./types";

export interface InferenceRunContext {
  orgId: string;
  actorId?: string | null;
  purpose?: string | null;
  sessionId?: string | null;
  workflowTaskId?: string | null;
}

/**
 * Run a capability request and record its telemetry in the inference_runs
 * ledger. Returns exactly what runInference() returns; the persistence step is
 * best-effort and cannot affect the result. Never throws.
 */
export async function runInferenceLogged(
  ctx: InferenceRunContext,
  req: InferenceRequest,
): Promise<InferenceResult> {
  const result = await runInference(req);

  try {
    await persistInferenceRun({
      orgId: ctx.orgId,
      actorId: ctx.actorId ?? null,
      result,
      capability: req.capability ?? null,
      preferTier: req.preferTier ?? null,
      sensitivity: req.sensitivity ?? null,
      purpose: ctx.purpose ?? null,
      sessionId: ctx.sessionId ?? null,
      workflowTaskId: ctx.workflowTaskId ?? null,
    });
  } catch {
    // swallow — a persistence failure must not affect the returned result.
  }

  return result;
}
