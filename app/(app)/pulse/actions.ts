"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { addPulseItemToPipeline, runPulseForOrg, type AddToPipelineResult, type PulseRunResult } from "@/lib/pulse.server";

/** Manual Refresh: one Pulse run now, within today's search allowance. */
export async function refreshPulse(): Promise<PulseRunResult | { status: "failed"; detail: string; items: 0; searches: 0 }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { status: "failed", detail: "Not authorized.", items: 0, searches: 0 };
  const supabase = await createServerClient();
  const result = await runPulseForOrg(supabase, auth.ctx.orgId, { trigger: "manual", startedBy: auth.ctx.userId });
  revalidatePath("/pulse");
  return result;
}

/** Add a finding to the pipeline as a Deal or an Investor. */
export async function addPulseItem(itemId: string): Promise<AddToPipelineResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (typeof itemId !== "string" || !itemId) return { ok: false, error: "Missing item." };
  const supabase = await createServerClient();
  const result = await addPulseItemToPipeline(supabase, auth.ctx.orgId, auth.ctx.userId, itemId);
  revalidatePath("/pulse");
  return result;
}

/** Dismiss a finding; later sweeps are told to avoid similar items. */
export async function dismissPulseItem(itemId: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (typeof itemId !== "string" || !itemId) return { ok: false, error: "Missing item." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("pulse_items")
    .update({ status: "dismissed", acted_by: auth.ctx.userId, acted_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("organization_id", auth.ctx.orgId)
    .eq("status", "new");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pulse");
  return { ok: true };
}
