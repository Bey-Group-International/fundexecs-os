import { couponRedeemError, type CouponRecord } from "@/lib/coupons";

const NOW = new Date("2026-07-06T00:00:00.000Z");

function coupon(overrides: Partial<CouponRecord> = {}): CouponRecord {
  return { is_active: true, expires_at: null, ...overrides };
}

describe("couponRedeemError", () => {
  it("rejects an unknown coupon", () => {
    expect(couponRedeemError(null, NOW)).toBe("That coupon code is not valid.");
  });

  it("rejects an inactive coupon", () => {
    expect(couponRedeemError(coupon({ is_active: false }), NOW)).toBe(
      "This coupon is no longer active.",
    );
  });

  it("rejects an expired coupon", () => {
    expect(couponRedeemError(coupon({ expires_at: "2026-07-05T00:00:00.000Z" }), NOW)).toBe(
      "This coupon has expired.",
    );
  });

  it("accepts an active, unexpired coupon", () => {
    expect(couponRedeemError(coupon(), NOW)).toBeNull();
    expect(couponRedeemError(coupon({ expires_at: "2026-07-07T00:00:00.000Z" }), NOW)).toBeNull();
  });

  it("treats an expiry exactly at now as still valid", () => {
    expect(couponRedeemError(coupon({ expires_at: NOW.toISOString() }), NOW)).toBeNull();
  });
});
