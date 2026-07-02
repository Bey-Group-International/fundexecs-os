// Coupon redemption: admins create codes in `coupons`; users redeem once per org
// for a free credit grant. Validation and the credit write both use the service
// role so RLS on `coupons` can stay read-only for authenticated users.
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

  const service = createServiceClient();

  const { data: coupon } = await service
    .from("coupons")
    .select("id, credits, max_uses_per_org, expires_at, is_active")
    .eq("code", clean)
    .maybeSingle();

  if (!coupon) return { ok: false, error: "That coupon code is not valid." };
  if (!coupon.is_active) return { ok: false, error: "This coupon is no longer active." };
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return { ok: false, error: "This coupon has expired." };
  }

  const { count } = await service
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", coupon.id)
    .eq("organization_id", orgId);

  if ((count ?? 0) >= coupon.max_uses_per_org) {
    return { ok: false, error: "You have already redeemed this coupon." };
  }

  const { error: insertErr } = await service.from("coupon_redemptions").insert({
    coupon_id: coupon.id,
    organization_id: orgId,
  });
  if (insertErr) return { ok: false, error: "Could not redeem coupon. Please try again." };

  await grantCredits(service, orgId, coupon.credits, "coupon_redemption", {
    note: `Coupon ${clean}`,
  });

  return { ok: true, credits: coupon.credits };
}
