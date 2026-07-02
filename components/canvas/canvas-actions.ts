"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import type { Canvas, CanvasElement } from "@/lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Canvases
// ---------------------------------------------------------------------------

export async function createCanvas(
  formData: FormData,
): Promise<{ id: string } | null> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;

  const name =
    String(formData.get("name") ?? "").trim() || "Untitled Canvas";

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("canvases")
    .insert({ organization_id: ctx.orgId, name, created_by: ctx.userId })
    .select("id")
    .single();

  if (error || !data) return null;
  return { id: data.id };
}

export async function listCanvases(): Promise<Canvas[]> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];

  const supabase = createServerClient();
  const { data } = await supabase
    .from("canvases")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false });

  return (data ?? []) as Canvas[];
}

// ---------------------------------------------------------------------------
// Canvas elements
// ---------------------------------------------------------------------------

export async function listElements(canvasId: string): Promise<CanvasElement[]> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];

  const supabase = createServerClient();
  const { data } = await supabase
    .from("canvas_elements")
    .select("*")
    .eq("canvas_id", canvasId)
    .eq("organization_id", ctx.orgId)
    .order("updated_at", { ascending: true });

  return (data ?? []) as CanvasElement[];
}

export async function upsertElement(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const row = {
    id,
    canvas_id: String(formData.get("canvas_id") ?? ""),
    organization_id: ctx.orgId,
    type: String(formData.get("type") ?? "sticky") as CanvasElement["type"],
    x: Number(formData.get("x") ?? 0),
    y: Number(formData.get("y") ?? 0),
    w: Number(formData.get("w") ?? 200),
    h: Number(formData.get("h") ?? 120),
    content: String(formData.get("content") ?? ""),
    color: String(formData.get("color") ?? "#F59E0B"),
    from_id: (String(formData.get("from_id") ?? "").trim() || null),
    to_id: (String(formData.get("to_id") ?? "").trim() || null),
    shape_kind: (String(formData.get("shape_kind") ?? "").trim() || null),
    created_by: ctx.userId,
    updated_at: new Date().toISOString(),
  };

  const supabase = createServerClient();
  await supabase
    .from("canvas_elements")
    .upsert(row, { onConflict: "id" });
}

export async function deleteElement(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const supabase = createServerClient();
  await supabase
    .from("canvas_elements")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  const canvasId = String(formData.get("canvas_id") ?? "").trim();
  if (canvasId) {
    revalidatePath(`/build/canvas?id=${canvasId}`);
  }
}
