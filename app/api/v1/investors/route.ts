import { collection, failure, withApiKey } from "@/lib/api-v1";
import type { Investor } from "@/lib/supabase/database.types";

// GET /api/v1/investors — the authenticated org's investor CRM records.
//
//   curl https://app.fundexecs.com/api/v1/investors \
//     -H "Authorization: Bearer fxsk_live_…"
//
// Scoped strictly to the key's organization_id. Curated fields only — free-text
// notes are not exposed over the API.
export const dynamic = "force-dynamic";

export const GET = withApiKey(async ({ orgId, supabase }) => {
  const { data, error } = await supabase
    .from("investors")
    .select("id, name, investor_type, pipeline_stage, jurisdiction, typical_check_min, typical_check_max")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });

  if (error) return failure(error.message, 500);

  const investors = ((data as Pick<
    Investor,
    "id" | "name" | "investor_type" | "pipeline_stage" | "jurisdiction" | "typical_check_min" | "typical_check_max"
  >[] | null) ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    type: i.investor_type,
    pipeline_stage: i.pipeline_stage,
    jurisdiction: i.jurisdiction,
    typical_check_min: i.typical_check_min,
    typical_check_max: i.typical_check_max,
  }));

  return collection(investors);
});
