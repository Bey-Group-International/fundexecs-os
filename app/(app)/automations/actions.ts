"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { runAutomation } from "@/lib/engine";
import { isValidCron, nextRun } from "@/lib/cron";
import type { TriggerType } from "@/lib/supabase/database.types";

// Create a saved automation. Schedule triggers get an initial next_run_at so the
// cron sweep can find them; the run is opt-in unattended via auto_approve.
export async function createAutomation(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const name = String(formData.get("name") ?? "").trim();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const schedule = String(formData.get("schedule") ?? "").trim();
  const autoApprove = formData.get("auto_approve") === "on";
  const triggerType = (String(formData.get("trigger_type") ?? "schedule") || "schedule") as TriggerType;

  if (!name) return { error: "Name is required" };
  if (!prompt) return { error: "Instruction is required" };
  if (triggerType === "schedule" && !isValidCron(schedule)) {
    return { error: "Pick a valid schedule" };
  }

  const supabase = createServerClient();
  const { error } = await supabase.from("automations").insert({
    organization_id: ctx.orgId,
    name,
    prompt,
    trigger_type: triggerType,
    schedule: triggerType === "schedule" ? schedule : null,
    auto_approve: autoApprove,
    enabled: true,
    next_run_at:
      triggerType === "schedule" ? nextRun(schedule, new Date())?.toISOString() ?? null : null,
    created_by: ctx.userId,
  });

  if (error) return { error: error.message };
  revalidatePath("/automations");
  return {};
}

export async function toggleAutomation(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (!id) return;

  const supabase = createServerClient();
  await supabase
    .from("automations")
    .update({ enabled: !enabled })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath("/automations");
}

export async function deleteAutomation(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createServerClient();
  await supabase.from("automations").delete().eq("id", id).eq("organization_id", ctx.orgId);
  revalidatePath("/automations");
}

// Fire an automation immediately from the UI — the "manual" trigger. Runs under
// the operator's session (RLS-scoped), so it works in any environment without
// the cron/service-role setup. Honors the automation's auto_approve setting.
export async function runAutomationNow(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createServerClient();
  const { data } = await supabase
    .from("automations")
    .select("*")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .single();
  if (!data) return;

  await runAutomation(
    { supabase, orgId: ctx.orgId, actorId: ctx.userId },
    { id: data.id, prompt: data.prompt, auto_approve: data.auto_approve },
  );
  await supabase
    .from("automations")
    .update({
      last_run_at: new Date().toISOString(),
      last_run_status: "ok (manual)",
      run_count: data.run_count + 1,
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath("/automations");
}
