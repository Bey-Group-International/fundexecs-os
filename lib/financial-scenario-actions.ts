"use server";

// lib/financial-scenario-actions.ts
// Mutations for saved financial-model scenarios (LBO model, fund-life waterfall).
// Called from the client modeling tools. Org-scoped and defensive; reads live in
// lib/financial-scenarios.ts.
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import type { ScenarioKind } from "@/lib/financial-scenarios";

const REVALIDATE_PATH: Record<ScenarioKind, string> = {
  lbo: "/run/underwriting",
  waterfall: "/execute/waterfall",
};

function isKind(k: string): k is ScenarioKind {
  return k === "lbo" || k === "waterfall";
}

/** Save a named scenario for the caller's org. Returns the new row id. */
export async function saveFinancialScenario(args: {
  kind: ScenarioKind;
  name: string;
  inputs: Record<string, unknown>;
  dealId?: string | null;
}): Promise<{ ok?: true; id?: string; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };

  const name = args.name?.trim();
  if (!name) return { error: "Name is required" };
  if (!isKind(args.kind)) return { error: "Invalid scenario kind" };

  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("financial_scenarios")
      .insert({
        organization_id: auth.ctx.orgId,
        kind: args.kind,
        name,
        inputs: (args.inputs ?? {}) as unknown as Json,
        deal_id: args.dealId ?? null,
        created_by: auth.ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw error;

    revalidatePath(REVALIDATE_PATH[args.kind]);
    return { ok: true, id: data?.id };
  } catch (e) {
    console.error("[saveFinancialScenario] failed", e);
    return { error: "Failed to save scenario" };
  }
}

/** Delete one of the caller's org's scenarios. */
export async function deleteFinancialScenario(
  id: string,
  kind: ScenarioKind,
): Promise<{ ok?: true; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };

  try {
    const supabase = await createServerClient();
    const { error } = await supabase
      .from("financial_scenarios")
      .delete()
      .eq("id", id)
      .eq("organization_id", auth.ctx.orgId);
    if (error) throw error;

    if (isKind(kind)) revalidatePath(REVALIDATE_PATH[kind]);
    return { ok: true };
  } catch (e) {
    console.error("[deleteFinancialScenario] failed", e);
    return { error: "Failed to delete scenario" };
  }
}
