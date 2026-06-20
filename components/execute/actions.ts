"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import type { AssetType } from "@/lib/supabase/database.types";

// Best-effort map a deal's free-text asset class onto the asset_type enum so a
// promoted holding lands with a sensible type; falls back to "other".
function assetTypeFor(assetClass: string | null): AssetType {
  const v = (assetClass ?? "").toLowerCase();
  if (/real\s?estate|property|land|housing|industrial|logistics|office|retail/.test(v)) return "real_estate";
  if (/fund|lp interest|secondary/.test(v)) return "fund_interest";
  if (/venture|growth|tech|portfolio|startup|saas/.test(v)) return "portfolio_company";
  if (/buyout|operating|company|business|pe|control/.test(v)) return "operating_company";
  return "other";
}

// Execute › Closing: turn a closed deal into a portfolio holding in one click.
// Creates an asset seeded from the deal (name, type, cost = target amount, first
// mark = cost) and advances the deal to "owned" — the moment a deal becomes
// something to operate. Idempotent on re-click: if an asset already exists for
// the deal, it just ensures the stage is "owned".
export async function promoteDealToAsset(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const dealId = String(formData.get("deal_id") ?? "");
  if (!dealId) return;

  const supabase = createServerClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, name, asset_class, target_amount, fund_id, stage")
    .eq("id", dealId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!deal) return;

  const { data: existing } = await supabase
    .from("assets")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("deal_id", deal.id)
    .maybeSingle();

  if (!existing) {
    const cost = typeof deal.target_amount === "number" ? deal.target_amount : null;
    await supabase.from("assets").insert({
      organization_id: ctx.orgId,
      deal_id: deal.id,
      fund_id: deal.fund_id,
      name: deal.name,
      asset_type: assetTypeFor(deal.asset_class),
      acquisition_date: new Date().toISOString().slice(0, 10),
      acquisition_cost: cost,
      current_value: cost, // first mark = cost basis
      status: "active",
    });
  }

  await supabase
    .from("deals")
    .update({ stage: "owned" })
    .eq("id", deal.id)
    .eq("organization_id", ctx.orgId);

  revalidatePath("/execute/closing");
  revalidatePath("/execute/asset_management");
}
