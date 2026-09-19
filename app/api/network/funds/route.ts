// The vehicles a deal can be raised into.
//
//   GET — this organization's funds, newest vintage first.
//
// `network_opportunities.fund_id` has existed since the workspace migration and
// nothing has ever been able to set it, because nothing could list the funds to
// choose from. A column no interface can fill is a column that is always null,
// and "pipeline for Fund III" stays unanswerable no matter how good the rollup
// underneath it is.
//
// Read-only and deliberately small: a picker needs a name and enough context to
// tell two vintages of the same strategy apart, not the capital account.

import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export interface FundOption {
  id: string;
  name: string;
  fundType: string | null;
  vintageYear: number | null;
  currency: string;
}

/** Defensive ceiling, not a page size. See the note on the query below. */
const MAX_FUNDS = 1000;

/** This organization's funds, newest vintage first, for the deal form's picker. */
export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = (await createServerClient()) as any;
  const { data, error } = await supabase
    .from("funds")
    .select("id, name, fund_type, vintage_year, currency")
    .eq("organization_id", auth.ctx.orgId)
    .order("vintage_year", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })
    // A picker that silently omits rows is the failure this whole feature is
    // trying to stop making. The old cap of 200 had no cursor and no search
    // behind it, so a fund past the cap could not be chosen at all and nothing
    // said so. This ceiling exists only to bound a pathological query; if it is
    // ever reached the response says so rather than quietly shortening the
    // list. One extra row tells us whether there were more.
    .limit(MAX_FUNDS + 1);

  if (error) {
    console.error("[network/funds] read", error);
    return NextResponse.json({ error: "Failed to load funds" }, { status: 500 });
  }

  const rows = (data ?? []) as Record<string, any>[];
  const truncated = rows.length > MAX_FUNDS;

  const funds: FundOption[] = rows.slice(0, MAX_FUNDS).map((f) => ({
    id: String(f.id),
    name: String(f.name ?? "Untitled fund"),
    fundType: f.fund_type ?? null,
    vintageYear: f.vintage_year === null || f.vintage_year === undefined ? null : Number(f.vintage_year),
    currency: String(f.currency ?? "USD"),
  }));

  return NextResponse.json({ funds, truncated });
}
