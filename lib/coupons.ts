// Coupon redemption: admins create codes in `coupons`; users redeem once per org
// for a free credit grant. Validation and the credit write both use the service
// role so RLS on `coupons` can stay read-only for authenticated users.
//
// Once-per-org is enforced atomically by the DB: `coupon_redemptions` has a
// unique (coupon_id, organization_id) constraint, so we INSERT first and treat a
// unique violation as "already redeemed" rather than checking a count then
// inserting (which races — two concurrent redemptions could both pass the check
// and double-grant). Credits are granted only after the row is durably claimed.
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

// The coupon fields redemption validates against. Kept minimal so the pure
// validator below is easy to unit-test.
export interface CouponRecord {
  is_active: boolean;
  expires_at: string | null;
}

// Postgres unique-violation SQLSTATE — the signal that this org already has a
// redemption row for the coupon.
const UNIQUE_VIOLATION = "23505";

// Pure eligibility check (no I/O): returns a user-facing error string, or null
// when the coupon may be redeemed. Race-independent — the once-per-org guard is
// enforced by the DB on insert, not here.
export function couponRedeemError(coupon: CouponRecord | null, now: Date = new Date()): string | null {
  if (!coupon) return "That coupon code is not valid.";
  if (!coupon.is_active) return "This coupon is no longer active.";
  if (coupon.expires_at && new Date(coupon.expires_at) < now) return "This coupon has expired.";
  return null;
}

export async function redeemCoupon(code: string, orgId: string): Promise<RedeemCouponResult> {
  const clean = code.trim().toUpperCase();
  if (!clean) return { ok: false, error: "Enter a coupon code." };

  const db = createServiceClient() as any; // coupons table added after last type-gen run

  const { data: coupon, error: lookupErr } = await db
    .from("coupons")
    .select("id, credits, expires_at, is_active")
    .eq("code", clean)
    .maybeSingle();

  if (lookupErr) return { ok: false, error: "Could not check that coupon. Please try again." };

  const invalid = couponRedeemError(coupon as CouponRecord | null);
  if (invalid) return { ok: false, error: invalid };

  // Claim the redemption atomically. The unique (coupon_id, organization_id)
  // constraint means a duplicate (including a concurrent one) fails here — so the
  // credit grant below runs at most once per org, no TOCTOU window.
  const { error: insertErr } = await db.from("coupon_redemptions").insert({
    coupon_id: coupon.id,
    organization_id: orgId,
  });
  if (insertErr) {
    if (insertErr.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "You have already redeemed this coupon." };
    }
    return { ok: false, error: "Could not redeem coupon. Please try again." };
  }

  const service = createServiceClient();
  await grantCredits(service, orgId, coupon.credits as number, "coupon_redemption", {
    note: `Coupon ${clean}`,
  });

  return { ok: true, credits: coupon.credits as number };
}
