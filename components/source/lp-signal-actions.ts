"use server";

// components/source/lp-signal-actions.ts
// Server action backing the inline LP-signal editor on the LP Intelligence
// board. It writes the three enrichable allocator signals the lib/lp-scoring
// model reads — sectors, emerging-manager openness, and the allocation-signal
// note — so an operator can fill the gaps that otherwise degrade an LP's fit
// score (see LpIntelligenceBoard's "why this score" breakdown). Org-scoped:
// the update only touches investors that belong to the caller's organization.
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

/** The three scoring signals this action lets the user enrich. */
export interface LpSignalFields {
  /** Comma-separated sector focus, parsed into a text[] (e.g. "SaaS, Fintech"). */
  sectors: string;
  /** "yes" | "no" | "unknown" — maps to boolean | null on the row. */
  openToEmergingManagers: string;
  /** Free-text allocation-activity note (e.g. "Actively deploying 2026"). */
  allocationSignal: string;
}

/** Parse a comma-separated string into a de-duped, trimmed text[]. */
function parseSectors(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const s = part.trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
}

/** Map the tri-state select onto the nullable boolean the column stores. */
function parseOpenness(raw: string): boolean | null {
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return null;
}

/**
 * Update an investor's LP-fit signals. Verifies the investor belongs to the
 * caller's org by scoping the write on organization_id, then revalidates the
 * LP Intelligence route so the board re-scores with the fresh signals.
 */
export async function updateLpSignals(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing investor id" };

  const fields: LpSignalFields = {
    sectors: String(formData.get("sectors") ?? ""),
    openToEmergingManagers: String(formData.get("openToEmergingManagers") ?? ""),
    allocationSignal: String(formData.get("allocationSignal") ?? ""),
  };

  const allocation = fields.allocationSignal.trim();
  const update = {
    sectors: parseSectors(fields.sectors),
    open_to_emerging_managers: parseOpenness(fields.openToEmergingManagers),
    allocation_signal: allocation || null,
  };

  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("investors")
      .update(update as never)
      .eq("id", id)
      .eq("organization_id", auth.ctx.orgId)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { error: "Investor not found" };
    revalidatePath("/source/lp_intelligence");
    return { ok: true };
  } catch (e) {
    console.error("[updateLpSignals] failed", e);
    return { error: "Failed to update LP signals" };
  }
}
