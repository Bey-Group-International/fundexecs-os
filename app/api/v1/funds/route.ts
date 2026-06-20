import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys-verify";
import { createServiceClient } from "@/lib/supabase/server";
import type { Fund } from "@/lib/supabase/database.types";

// GET /api/v1/funds — the authenticated org's funds.
//
//   curl https://app.fundexecs.com/api/v1/funds \
//     -H "Authorization: Bearer fxsk_live_…"
//
// Authenticated by an issued secret key (see lib/api-keys-verify), read with the
// service-role client and scoped strictly to the key's own organization_id.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("funds")
    .select("*")
    .eq("organization_id", auth.key.orgId)
    .order("vintage_year", { ascending: false, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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

  return NextResponse.json({ data: funds, count: funds.length });
}
