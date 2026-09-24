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
  });
});

describe("evaluateFeatureAccess", () => {
  it("locks a member without a paid plan", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: "free" })).toEqual({
      unlocked: false,
      viaAdmin: false,
      plan: null,
    });
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: null }).unlocked).toBe(false);
  });

  it("unlocks a member on a paid plan", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: "pro" })).toEqual({
      unlocked: true,
      viaAdmin: false,
      plan: "pro",
    });
  });

  it("unlocks a platform admin regardless of plan", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: true, plan: null })).toEqual({
      unlocked: true,
      viaAdmin: true,
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
