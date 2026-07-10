"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

// Parse a comma/newline-separated input into a clean string[].
function toList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(raw: FormDataEntryValue | null): number | null {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && String(raw ?? "").trim() !== "" ? n : null;
}

const BUILD = "/build";

// --- Thesis ----------------------------------------------------------------
export async function updateThesis(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const supabase = await createServerClient();
  await supabase
    .from("investment_theses")
    .update({
      title,
      summary: String(formData.get("summary") ?? "").trim() || null,
      asset_classes: toList(String(formData.get("asset_classes") ?? "")),
      geographies: toList(String(formData.get("geographies") ?? "")),
      check_size_min: num(formData.get("check_size_min")),
      check_size_max: num(formData.get("check_size_max")),
      target_irr: num(formData.get("target_irr")),
      target_moic: num(formData.get("target_moic")),
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(`${BUILD}/profile`);
}

// Make one thesis active and deactivate every other thesis for the org.
export async function setActiveThesis(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createServerClient();
  // Deactivate all theses for the org, then activate the chosen one.
  await supabase
    .from("investment_theses")
    .update({ is_active: false })
    .eq("organization_id", ctx.orgId);
  await supabase
    .from("investment_theses")
    .update({ is_active: true })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(`${BUILD}/profile`);
}

// --- Entity ----------------------------------------------------------------
export async function updateEntity(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supabase = await createServerClient();
  await supabase
    .from("entities")
    .update({
      name,
      entity_type: String(formData.get("entity_type") ?? "spv").trim() || "spv",
      jurisdiction: String(formData.get("jurisdiction") ?? "").trim() || null,
      parent_entity_id: String(formData.get("parent_entity_id") ?? "").trim() || null,
      formation_date: String(formData.get("formation_date") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(`${BUILD}/profile`);
}

// --- Track Record ----------------------------------------------------------
export async function updateTrackRecord(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const deal_name = String(formData.get("deal_name") ?? "").trim();
  if (!deal_name) return;
  const supabase = await createServerClient();
  await supabase
    .from("track_records")
    .update({
      deal_name,
      asset_class: String(formData.get("asset_class") ?? "").trim() || null,
      vintage_year: num(formData.get("vintage_year")),
      invested_amount: num(formData.get("invested_amount")),
      realized_value: num(formData.get("realized_value")),
      gross_irr: num(formData.get("gross_irr")),
      gross_moic: num(formData.get("gross_moic")),
      is_realized: formData.get("is_realized") === "on",
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(`${BUILD}/track_record`);
}
