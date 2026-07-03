import { collection, failure, withApiKey } from "@/lib/api-v1";
import type { Deal } from "@/lib/supabase/database.types";

// GET /api/v1/deals — the authenticated org's deals (most recently updated first).
//
//   curl https://app.fundexecs.com/api/v1/deals \
//     -H "Authorization: Bearer fxsk_live_…"
//
// Scoped strictly to the key's organization_id. Curated pipeline fields only —
// free-text notes and internal session links are not exposed.
export const dynamic = "force-dynamic";

export const GET = withApiKey(async ({ orgId, supabase }) => {
  const { data, error } = await supabase
    .from("deals")
    .select("id, name, stage, asset_class, geography, target_amount, expected_close, updated_at")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false });

  if (error) return failure(error.message, 500);

  const deals = ((data as Pick<
    Deal,
    "id" | "name" | "stage" | "asset_class" | "geography" | "target_amount" | "expected_close" | "updated_at"
  >[] | null) ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    stage: d.stage,
    asset_class: d.asset_class,
    geography: d.geography,
    target_amount: d.target_amount,
    expected_close: d.expected_close,
    updated_at: d.updated_at,
  }));

  return collection(deals);
});
