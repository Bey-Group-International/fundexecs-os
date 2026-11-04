// lib/skills/planning-candidates.ts
// The candidate set the workflow planner hands to the sourcing skills
// (source-deals, target-screen). Until now the engine never supplied one, so those
// skills could not fire mid-workflow. The source is the org's own catalog
// (sourcing_entities, kind = company): real records an operator or an import put
// there, never generated ones.
//
// Mapping discipline (same as the rest of the runtime): forward only what a row
// actually carries. Sector is the row's category tags; geography is the row's
// geography; revenue / EBITDA come from metadata ONLY when stored as finite
// numbers. Anything else stays absent and the skill reports it as needs-data.

import type { PlanningCandidate } from "./skill-planner";

/** A bound on how many catalog rows one workflow step will screen. */
export const MAX_PLANNING_CANDIDATES = 50;

export interface EntityRow {
  name: string | null;
  categories: string[] | null;
  geography: string | null;
  metadata: unknown;
  provenance: string | null;
}

function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function candidatesFromEntities(rows: EntityRow[] | null | undefined): PlanningCandidate[] {
  const out: PlanningCandidate[] = [];
  const seen = new Set<string>();
  for (const r of rows ?? []) {
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    const cats = (r.categories ?? []).filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim());
    const meta = r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata) ? (r.metadata as Record<string, unknown>) : {};
    const c: PlanningCandidate = { name };
    // Joined tags: the screens match by substring, so "software / fintech" satisfies "software".
    if (cats.length) c.sector = cats.join(" / ");
    if (typeof r.geography === "string" && r.geography.trim()) c.geography = r.geography.trim();
    const revenue = finite(meta.revenue);
    const ebitda = finite(meta.ebitda);
    if (revenue !== undefined) c.revenue = revenue;
    if (ebitda !== undefined) c.ebitda = ebitda;
    if (typeof r.provenance === "string" && r.provenance.trim()) c.source = r.provenance.trim();
    out.push(c);
    if (out.length >= MAX_PLANNING_CANDIDATES) break;
  }
  return out;
}

/** Minimal slice of the Supabase client this loader needs. */
interface EntityReader {
  from(table: "sourcing_entities"): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          order(col: string, opts: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: unknown }> };
        };
      };
    };
  };
}

/** The org's most recently updated company entities as planner candidates. Best-effort: [] on any failure. */
export async function loadPlanningCandidates(supabase: unknown, orgId: string): Promise<PlanningCandidate[]> {
  try {
    const { data } = await (supabase as EntityReader)
      .from("sourcing_entities")
      .select("name, categories, geography, metadata, provenance")
      .eq("organization_id", orgId)
      .eq("kind", "company")
      .order("updated_at", { ascending: false })
      .limit(MAX_PLANNING_CANDIDATES * 2); // headroom for de-duplication
    return candidatesFromEntities(data as EntityRow[] | null);
  } catch {
    return [];
  }
}
