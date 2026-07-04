"use server";

// Server actions for the Run › Underwriting module. These sit alongside the
// shared deal actions (we reuse `addUnderwriting` for the add-case form) and
// add the underwriting-specific mutations: probability weighting and the
// inputs-driven returns calculator. Every mutation re-snapshots conviction so
// the Run hub keeps compounding, then revalidates the underwriting surface.
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { recordConvictionSnapshot } from "@/lib/run-war-room";
import { computeReturnsFromInputs } from "@/lib/underwriting-calc";
import type { Underwriting, Json } from "@/lib/supabase/database.types";

function num(formData: FormData, name: string): number | null {
  const v = String(formData.get(name) ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// The `model` column may be null, a scalar, or an object from older rows.
// Always merge into a fresh object so we never clobber sibling keys.
function asModelObject(model: Json | null | undefined): Record<string, Json> {
  return model && typeof model === "object" && !Array.isArray(model)
    ? { ...(model as Record<string, Json>) }
    : {};
}

// Load one case scoped to the org, returning its id, deal, and current model.
async function loadCase(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  orgId: string,
  id: string,
): Promise<Pick<Underwriting, "id" | "deal_id" | "model"> | null> {
  const { data } = await supabase
    .from("underwritings")
    .select("id, deal_id, model")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as Pick<Underwriting, "id" | "deal_id" | "model"> | null) ?? null;
}

function revalidate() {
  revalidatePath("/run/underwriting");
}

export interface UnderwritingActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Assign a probability weight (0..1) to a case, stored in `model.probability`.
 * Merges into the existing model JSON so saved assumptions survive.
 */
export async function setUnderwritingProbability(formData: FormData): Promise<UnderwritingActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing case." };

  let probability = num(formData, "probability");
  if (probability == null) return { ok: false, error: "Enter a probability." };
  if (probability > 1) probability = 1;
  if (probability < 0) probability = 0;

  const supabase = await createServerClient();
  const row = await loadCase(supabase, ctx.orgId, id);
  if (!row) return { ok: false, error: "Case not found." };

  const model = asModelObject(row.model);
  model.probability = probability;

  const { error } = await supabase
    .from("underwritings")
    .update({ model: model as Json })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: error.message };

  await recordConvictionSnapshot(supabase, ctx.orgId, row.deal_id);
  revalidate();
  return { ok: true };
}

/**
 * Save calculator assumptions (entry equity, exit value or multiple, hold years,
 * optional leverage) into `model.assumptions`, compute the implied IRR/MOIC
 * server-side via the pure `computeReturnsFromInputs`, and write the results
 * onto `projected_irr` / `projected_moic` so the case and conviction reflect
 * the inputs. IRR is stored as a fraction (consistent with `toPercent`).
 */
export async function saveUnderwritingInputs(formData: FormData): Promise<UnderwritingActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing case." };

  const equity = num(formData, "equity");
  const exitValue = num(formData, "exitValue");
  const exitMultiple = num(formData, "exitMultiple");
  const holdYears = num(formData, "holdYears");
  const leverage = num(formData, "leverage");

  const supabase = await createServerClient();
  const row = await loadCase(supabase, ctx.orgId, id);
  if (!row) return { ok: false, error: "Case not found." };

  const model = asModelObject(row.model);
  model.assumptions = {
    equity,
    exitValue,
    exitMultiple,
    holdYears,
    leverage,
  } as Json;

  const update: { model: Json; projected_irr?: number | null; projected_moic?: number | null } = {
    model: model as Json,
  };

  // Compute only when we have enough to do so; otherwise just persist inputs.
  if (equity != null && equity > 0 && holdYears != null && (exitValue != null || exitMultiple != null)) {
    const { irr, moic } = computeReturnsFromInputs({ equity, exitValue, exitMultiple, holdYears });
    update.projected_irr = irr; // stored as a fraction (e.g. 0.18)
    update.projected_moic = moic;
  }

  const { error } = await supabase
    .from("underwritings")
    .update(update)
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: error.message };

  await recordConvictionSnapshot(supabase, ctx.orgId, row.deal_id);
  revalidate();
  return { ok: true };
}

/**
 * Set a case's `equity_required` (sources & uses). Kept minimal — equity is a
 * first-class column, not part of `model`.
 */
export async function setUnderwritingEquity(formData: FormData): Promise<UnderwritingActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing case." };

  const supabase = await createServerClient();
  const row = await loadCase(supabase, ctx.orgId, id);
  if (!row) return { ok: false, error: "Case not found." };

  const { error } = await supabase
    .from("underwritings")
    .update({ equity_required: num(formData, "equity_required") })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: error.message };

  await recordConvictionSnapshot(supabase, ctx.orgId, row.deal_id);
  revalidate();
  return { ok: true };
}
