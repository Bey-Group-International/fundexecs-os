// Coupon redemption: admins create codes in `coupons`; users redeem once per org
// for a free credit grant. Validation and the credit write both use the service
// role so RLS on `coupons` can stay read-only for authenticated users.
//
// The `coupons` table was added by migration after the last Supabase type-gen
// run, so we cast the client to `any` for these two tables only rather than
// letting the generated `never` types block compilation.
import { createServiceClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";

export interface RedeemCouponResult {
  ok: boolean;
  credits?: number;
  error?: string;
}

export async function redeemCoupon(
  code: string,
  orgId: string,
): Promise<RedeemCouponResult> {
  const clean = code.trim().toUpperCase();
  if (!clean) return { ok: false, error: "Enter a coupon code." };

  const db = createServiceClient() as any; // coupons table added after last type-gen run

  const { data: coupon, error: lookupErr } = await db
    .from("coupons")
    .select("id, credits, max_uses_per_org, expires_at, is_active")
    .eq("code", clean)
    .maybeSingle();

  if (lookupErr || !coupon) return { ok: false, error: "That coupon code is not valid." };
  if (!coupon.is_active) return { ok: false, error: "This coupon is no longer active." };
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return { ok: false, error: "This coupon has expired." };
  }

  const { count } = await db
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", coupon.id)
    .eq("organization_id", orgId);

  if ((count ?? 0) >= coupon.max_uses_per_org) {
    return { ok: false, error: "You have already redeemed this coupon." };
  }

  const { error: insertErr } = await db.from("coupon_redemptions").insert({
    coupon_id: coupon.id,
    organization_id: orgId,
  });
  if (insertErr) return { ok: false, error: "Could not redeem coupon. Please try again." };

  const service = createServiceClient();
  await grantCredits(service, orgId, coupon.credits as number, "coupon_redemption", {
    note: `Coupon ${clean}`,
  });

  return { ok: true, credits: coupon.credits as number };
}
