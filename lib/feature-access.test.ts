import { PAYWALL_EFFECTIVE_FROM } from "@/lib/paywall";
import {
  evaluateFeatureAccess,
  featureLockedMessage,
  gatedFeatureForHub,
  paidPlan,
} from "@/lib/feature-access";

describe("paidPlan", () => {
  it("accepts real plan keys only", () => {
    expect(paidPlan("starter")).toBe("starter");
    expect(paidPlan("scale")).toBe("scale");
    // 'free' is the signup marker, not a plan.
    expect(paidPlan("free")).toBeNull();
    expect(paidPlan(null)).toBeNull();
    expect(paidPlan("enterprise")).toBeNull();
    // Inherited object keys must not count as a plan.
    expect(paidPlan("constructor")).toBeNull();
    expect(paidPlan("toString")).toBeNull();
    expect(paidPlan("__proto__")).toBeNull();
  });
});

const NEW_ORG = "2026-10-01T00:00:00.000Z";
const OLD_ORG = "2026-08-01T00:00:00.000Z";

describe("evaluateFeatureAccess", () => {
  it("locks a new org without a paid plan", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: "free", orgCreatedAt: NEW_ORG })).toEqual({
      unlocked: false,
      viaAdmin: false,
      grandfathered: false,
      plan: null,
    });
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: null, orgCreatedAt: NEW_ORG }).unlocked).toBe(false);
  });

  it("unlocks a member on a paid plan", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: "pro", orgCreatedAt: NEW_ORG })).toEqual({
      unlocked: true,
      viaAdmin: false,
      grandfathered: false,
      plan: "pro",
    });
  });

  it("grandfathers a free org created before the paywall", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: "free", orgCreatedAt: OLD_ORG })).toEqual({
      unlocked: true,
      viaAdmin: false,
      grandfathered: true,
      plan: null,
    });
  });

  it("does not grandfather an org created exactly when the paywall took effect", () => {
    expect(
      evaluateFeatureAccess({ isPlatformAdmin: false, plan: null, orgCreatedAt: PAYWALL_EFFECTIVE_FROM }).unlocked,
    ).toBe(false);
  });

  it("fails closed when the org's age is unknown", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: null, orgCreatedAt: null }).unlocked).toBe(false);
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: null, orgCreatedAt: "garbage" }).unlocked).toBe(false);
  });

  it("unlocks a platform admin regardless of plan", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: true, plan: null, orgCreatedAt: null })).toEqual({
      unlocked: true,
      viaAdmin: true,
      grandfathered: false,
      plan: null,
    });
  });
});

describe("gatedFeatureForHub", () => {
  it("gates Run and Execute only", () => {
    expect(gatedFeatureForHub("run")).toBe("run");
    expect(gatedFeatureForHub("execute")).toBe("execute");
    expect(gatedFeatureForHub("build")).toBeNull();
    expect(gatedFeatureForHub("source")).toBeNull();
  });
});

describe("featureLockedMessage", () => {
  it("names the feature and where to unlock it", () => {
    expect(featureLockedMessage("marketplace")).toBe(
      "Marketplace requires a paid plan. Choose a plan in Wallet to unlock it.",
    );
  });
});
