// Client-safe canvas types and constants.
//
// This module intentionally has NO server-only imports (e.g. next/headers via
// lib/supabase/server). It is imported by the client-side WorkflowCanvas
// component, so anything that would drag server code into the browser bundle
// must NOT live here. The server-side persistence helpers live in
// lib/automation-canvas.ts, which re-exports these types for its own callers.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CanvasNode = {
  id: string;
  type: "trigger" | "condition" | "action" | "wait";
  position: { x: number; y: number };
  data: { label: string; config: Record<string, unknown> };
};

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type CanvasLayout = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

export type WorkflowTemplate = {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  canvas_json: CanvasLayout;
  is_global: boolean;
  created_by?: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_NODE_TYPES: Record<CanvasNode["type"], Record<string, unknown>> = {
  trigger: { schedule: null, event: null, webhook: null },
  condition: { field: "", operator: "eq", value: "" },
  action: { action_type: "run_agent", config: {} },
  wait: { delay_days: 1 },
};
