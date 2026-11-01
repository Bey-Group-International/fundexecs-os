// lib/lp-prefill.server.ts
// Reads the allocator record an LP's link was made from, for the wizard's details
// suggestions (rules in lib/lp-prefill.ts).
//
// It runs on the service role, which bypasses row-level security, so the query
// names the organization: a link can only ever read an allocator in its own
// organization. It selects only the few contact columns it needs.
//
// A convenience, never an obstacle: any failure is logged and the LP simply sees
// a blank form.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PREFILL_INVESTOR_COLUMNS, prefillFromInvestor, type DetailsPrefill, type InvestorForPrefill } from "@/lib/lp-prefill";
import type { LpType } from "@/lib/supabase/database.types";

type Client = SupabaseClient<any, any, any>;

export async function loadDetailsPrefill(
  client: Client,
  args: { orgId: string; investorId: string | null; lpType: LpType },
): Promise<DetailsPrefill> {
  if (!args.investorId) return {};
  try {
    const { data, error } = await client
      .from("investors")
      .select(PREFILL_INVESTOR_COLUMNS)
      .eq("id", args.investorId)
      .eq("organization_id", args.orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return prefillFromInvestor(args.lpType, data as InvestorForPrefill | null);
  } catch (err) {
    console.error("[lp-prefill] could not read the allocator record", err);
    return {};
  }
}
