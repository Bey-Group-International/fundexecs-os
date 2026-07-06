import { createServerClient } from "@/lib/supabase/server";

// Types and client-safe constants live in a separate, server-free module so
// they can be imported by the client-side WorkflowCanvas component without
// pulling next/headers (via createServerClient) into the browser bundle. We
// re-export them here so existing server-side importers of this module are
// unaffected.
export type {
  CanvasNode,
  CanvasEdge,
  CanvasLayout,
  WorkflowTemplate,
} from "@/lib/automation-canvas-types";
export { DEFAULT_NODE_TYPES } from "@/lib/automation-canvas-types";

import type {
  CanvasLayout,
  WorkflowTemplate,
} from "@/lib/automation-canvas-types";

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
  const supabase = await createServerClient();

  const { error } = await supabase
    .from("automations")
    .update({ canvas_json: layout as unknown as import("@/lib/supabase/database.types").Json })
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
  const supabase = await createServerClient();

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
  const supabase = await createServerClient();

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
  const supabase = await createServerClient();

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
