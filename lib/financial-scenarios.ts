// lib/financial-scenarios.ts
// Server-side read helper for saved financial-model scenarios (the LBO model and
// the fund-life waterfall). Mutations live in lib/financial-scenario-actions.ts
// ("use server"); this module is imported by server components to seed the tools
// with the org's saved scenarios.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export type ScenarioKind = "lbo" | "waterfall";

/** A saved scenario as handed to the client tools: name + the stored inputs. */
export interface SavedScenario {
  id: string;
  name: string;
  inputs: Record<string, unknown>;
}

/** List the org's saved scenarios of a kind, newest first. Best-effort ([] on error). */
export async function listFinancialScenarios(kind: ScenarioKind): Promise<SavedScenario[]> {
  const auth = await requireOrgContext();
  if (!auth.ok) return [];

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("financial_scenarios")
    .select("id, name, inputs")
    .eq("organization_id", auth.ctx.orgId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !data) {
    if (error) console.error("[listFinancialScenarios] fetch error:", error.message);
    return [];
  }

  return data.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    inputs: (r.inputs ?? {}) as Record<string, unknown>,
  }));
}
