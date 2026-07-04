"use server";

// Server actions for the Run › Diligence module: applying checklist templates,
// capturing findings inline, bulk status changes, and owner/due assignment.
// Each mutation re-snapshots conviction (so momentum keeps compounding) and
// revalidates the diligence surface, mirroring app/(app)/deal/[id]/actions.ts.
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { recordConvictionSnapshot } from "@/lib/run-war-room";
import type { DiligenceItem, DiligenceStatus } from "@/lib/supabase/database.types";
import {
  templateItemsFor,
  newTemplateItems,
  isDiligenceCategory,
  type DiligenceCategory,
} from "@/lib/diligence-templates";

function text(formData: FormData, name: string): string | null {
  const v = String(formData.get(name) ?? "").trim();
  return v === "" ? null : v;
}

const STATUSES = new Set<DiligenceStatus>(["open", "in_review", "cleared", "flagged", "waived"]);

function revalidateDiligence(dealId?: string) {
  if (dealId) revalidatePath(`/deal/${dealId}`);
  revalidatePath("/run/diligence");
}

export interface DiligenceActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Materialise a category's (or "all") standard checklist as open diligence_items
 * for a deal — idempotent: titles already present on the deal are skipped.
 */
export async function applyDiligenceTemplate(formData: FormData): Promise<DiligenceActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const dealId = String(formData.get("deal_id") ?? "");
  const categoryRaw = String(formData.get("category") ?? "all");
  if (!dealId) return { ok: false, error: "Choose a deal." };
  const category: DiligenceCategory | "all" =
    categoryRaw === "all" || isDiligenceCategory(categoryRaw) ? categoryRaw : "all";

  const supabase = await createServerClient();
  const { data: existing, error: readError } = await supabase
    .from("diligence_items")
    .select("title")
    .eq("organization_id", ctx.orgId)
    .eq("deal_id", dealId);
  if (readError) return { ok: false, error: readError.message };

  const existingTitles = ((existing ?? []) as { title: string }[]).map((r) => r.title);
  const fresh = newTemplateItems(templateItemsFor(category), existingTitles);
  if (fresh.length === 0) {
    revalidateDiligence(dealId);
    return { ok: true };
  }

  const { error } = await supabase.from("diligence_items").insert(
    fresh.map((r) => ({
      organization_id: ctx.orgId,
      deal_id: dealId,
      title: r.title,
      category: r.category,
      status: "open" as DiligenceStatus,
    })),
  );
  if (error) return { ok: false, error: error.message };

  await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateDiligence(dealId);
  return { ok: true };
}

/** Write/edit the free-text `finding` note on a single item. */
export async function updateDiligenceFinding(formData: FormData): Promise<DiligenceActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const id = String(formData.get("id") ?? "");
  const dealId = String(formData.get("deal_id") ?? "");
  if (!id) return { ok: false, error: "Missing diligence item." };

  const patch: Partial<Pick<DiligenceItem, "finding">> = { finding: text(formData, "finding") };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("diligence_items")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: error.message };

  if (dealId) await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateDiligence(dealId);
  return { ok: true };
}

/** Set owner and/or due date on a single item. */
export async function setDiligenceOwnerDue(formData: FormData): Promise<DiligenceActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const id = String(formData.get("id") ?? "");
  const dealId = String(formData.get("deal_id") ?? "");
  if (!id) return { ok: false, error: "Missing diligence item." };

  const patch: Partial<Pick<DiligenceItem, "owner" | "due_date">> = {
    owner: text(formData, "owner"),
    due_date: text(formData, "due_date"),
  };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("diligence_items")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: error.message };

  // Owner/due don't move conviction, but re-snapshot is harmless (no-op when
  // the score is unchanged) and keeps the surface consistent.
  if (dealId) await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateDiligence(dealId);
  return { ok: true };
}

/**
 * Apply one target status to many selected items at once (clear or flag in
 * bulk). `ids` arrives as repeated form fields; `status` is the target.
 */
export async function bulkUpdateDiligence(formData: FormData): Promise<DiligenceActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  const statusRaw = String(formData.get("status") ?? "");
  if (ids.length === 0 || !STATUSES.has(statusRaw as DiligenceStatus)) {
    return { ok: false, error: "Select at least one item and a target status." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("diligence_items")
    .update({ status: statusRaw as DiligenceStatus })
    .in("id", ids)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: error.message };

  // Re-snapshot conviction for every distinct deal the bulk edit touched.
  const { data: touched } = await supabase
    .from("diligence_items")
    .select("deal_id")
    .in("id", ids)
    .eq("organization_id", ctx.orgId);
  const dealIds = [...new Set(((touched ?? []) as { deal_id: string }[]).map((r) => r.deal_id))];
  for (const dealId of dealIds) {
    await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
    revalidatePath(`/deal/${dealId}`);
  }
  revalidatePath("/run/diligence");
  return { ok: true };
}
