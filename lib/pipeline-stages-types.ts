// Client-safe pipeline-stage types.
//
// This module intentionally has NO server-only imports. lib/pipeline-stages.ts
// imports createServiceClient (which pulls in next/headers) and cannot be
// imported from client components. The PipelineStage shape lives here so the
// client-side PipelineStageOverlay and DealPipeline can type against it without
// dragging server code into the browser bundle. lib/pipeline-stages.ts
// re-exports this type for its server-side callers.

export interface PipelineStage {
  id: string;
  org_id: string;
  hub: string;
  name: string;
  entry_conditions: Record<string, unknown>;
  exit_criteria: Record<string, unknown>;
  required_artifacts: string[];
  auto_actions: Array<{ action_type: string; config: Record<string, unknown> }>;
  order_index: number;
  created_at: string;
}
