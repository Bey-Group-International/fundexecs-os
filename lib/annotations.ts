import { createServerClient } from "@/lib/supabase/server";

export type EntityType =
  | "document"
  | "envelope"
  | "deal"
  | "artifact"
  | "session";

export interface Annotation {
  id: string;
  org_id: string;
  entity_type: EntityType;
  entity_id: string;
  author_id?: string;
  content: string;
  position_json?: {
    page?: number;
    x_pct?: number;
    y_pct?: number;
    selection_text?: string;
  };
  resolved: boolean;
  resolved_at?: string;
  resolved_by?: string;
  parent_id?: string;
  created_at: string;
  updated_at: string;
}

export async function createAnnotation(args: {
  orgId: string;
  entityType: EntityType;
  entityId: string;
  authorId: string;
  content: string;
  positionJson?: Annotation["position_json"];
  parentId?: string;
}): Promise<Annotation> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("annotations")
    .insert({
      org_id: args.orgId,
      entity_type: args.entityType,
      entity_id: args.entityId,
      author_id: args.authorId,
      content: args.content,
      position_json: args.positionJson ?? null,
      parent_id: args.parentId ?? null,
      resolved: false,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create annotation: ${error.message}`);
  }

  return data as Annotation;
}

export async function listAnnotations(
  entityType: EntityType,
  entityId: string,
): Promise<Annotation[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("annotations")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("resolved", false)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list annotations: ${error.message}`);
  }

  return (data ?? []) as Annotation[];
}

export async function resolveAnnotation(
  id: string,
  userId: string,
): Promise<void> {
  const supabase = createServerClient();

  const { error } = await supabase
    .from("annotations")
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to resolve annotation: ${error.message}`);
  }
}

export async function deleteAnnotation(id: string): Promise<void> {
  const supabase = createServerClient();

  const { error } = await supabase.from("annotations").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete annotation: ${error.message}`);
  }
}

export async function getAnnotationThread(
  parentId: string,
): Promise<Annotation[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("annotations")
    .select("*")
    .or(`id.eq.${parentId},parent_id.eq.${parentId}`)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to get annotation thread: ${error.message}`);
  }

  return (data ?? []) as Annotation[];
}
