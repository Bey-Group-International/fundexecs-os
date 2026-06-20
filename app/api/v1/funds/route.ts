import { collection, failure, withApiKey } from "@/lib/api-v1";
import type { Fund } from "@/lib/supabase/database.types";

// GET /api/v1/funds — the authenticated org's funds.
//
//   curl https://app.fundexecs.com/api/v1/funds \
//     -H "Authorization: Bearer fxsk_live_…"
export const dynamic = "force-dynamic";

export const GET = withApiKey(async ({ orgId, supabase }) => {
  const { data, error } = await supabase
    .from("funds")
    .select("*")
    .eq("organization_id", orgId)
    .order("vintage_year", { ascending: false, nullsFirst: false });

  if (error) return failure(error.message, 500);

  const funds = ((data as Fund[] | null) ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.fund_type,
    vintage_year: f.vintage_year,
    target_size: f.target_size,
    committed_capital: f.committed_capital,
    called_capital: f.called_capital,
    distributed_capital: f.distributed_capital,
    currency: f.currency,
  }));

  return collection(funds);
});
