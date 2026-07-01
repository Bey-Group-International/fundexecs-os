import { createServerClient } from "@/lib/supabase/server";

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

// ---------------------------------------------------------------------------
// Canvas persistence
// ---------------------------------------------------------------------------

/**
 * Persists the visual canvas layout for a given automation record.
 * Updates automations.canvas_json in place.
 */
export async function saveAutomationCanvas(
  automationId: string,
  layout: CanvasLayout,
): Promise<void> {
  const supabase = createServerClient();

  const { error } = await supabase
    .from("automations")
    .update({ canvas_json: layout as unknown as Record<string, unknown> })
    .eq("id", automationId);

  if (error) {
    throw new Error(`Failed to save automation canvas: ${error.message}`);
  }
}

/**
 * Loads the visual canvas layout for a given automation record.
 * Returns null if the automation does not exist or has no canvas_json.
 */
export async function loadAutomationCanvas(
  automationId: string,
): Promise<CanvasLayout | null> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("automations")
    .select("canvas_json")
    .eq("id", automationId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No rows returned
      return null;
    }
    throw new Error(`Failed to load automation canvas: ${error.message}`);
  }

  if (!data?.canvas_json) {
    return null;
  }

  return data.canvas_json as unknown as CanvasLayout;
}

// ---------------------------------------------------------------------------
// Workflow templates
// ---------------------------------------------------------------------------

/**
 * Lists workflow templates visible to an organisation: those owned by the org
 * or flagged as global templates, ordered alphabetically by name.
 */
export async function listWorkflowTemplates(
  orgId: string,
): Promise<WorkflowTemplate[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("workflow_templates")
    .select("*")
    .or(`org_id.eq.${orgId},is_global.eq.true`)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list workflow templates: ${error.message}`);
  }

  return (data ?? []) as unknown as WorkflowTemplate[];
}

/**
 * Creates a new workflow template and returns the persisted record.
 */
export async function createWorkflowTemplate(
  args: Omit<WorkflowTemplate, "id" | "created_at">,
): Promise<WorkflowTemplate> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("workflow_templates")
    .insert(args as unknown as Record<string, unknown>)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create workflow template: ${error.message}`);
  }

  return data as unknown as WorkflowTemplate;
}
