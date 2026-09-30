import { PAYWALL_EFFECTIVE_FROM } from "@/lib/paywall";
import {
  evaluateFeatureAccess,
  featureLockedMessage,
  gatedFeatureForHub,
  paidPlan,
} from "@/lib/feature-access";
import { planPurchasable } from "@/lib/live-readiness";

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
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: "free", orgCreatedAt: NEW_ORG, planPurchasable: true })).toEqual({
      unlocked: false,
      viaAdmin: false,
      grandfathered: false,
      unsellable: false,
      plan: null,
    });
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: null, orgCreatedAt: NEW_ORG, planPurchasable: true }).unlocked).toBe(false);
  });

  it("unlocks a member on a paid plan", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: "pro", orgCreatedAt: NEW_ORG, planPurchasable: true })).toEqual({
      unlocked: true,
      viaAdmin: false,
      grandfathered: false,
      unsellable: false,
      plan: "pro",
    });
  });

  it("grandfathers a free org created before the paywall", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: "free", orgCreatedAt: OLD_ORG, planPurchasable: true })).toEqual({
      unlocked: true,
      viaAdmin: false,
      grandfathered: true,
      unsellable: false,
      plan: null,
    });
  });

  it("does not grandfather an org created exactly when the paywall took effect", () => {
    expect(
      evaluateFeatureAccess({ isPlatformAdmin: false, plan: null, orgCreatedAt: PAYWALL_EFFECTIVE_FROM, planPurchasable: true }).unlocked,
    ).toBe(false);
  });

  it("fails closed when the org's age is unknown", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: null, orgCreatedAt: null, planPurchasable: true }).unlocked).toBe(false);
    expect(evaluateFeatureAccess({ isPlatformAdmin: false, plan: null, orgCreatedAt: "garbage", planPurchasable: true }).unlocked).toBe(false);
  });

  it("unlocks a platform admin regardless of plan", () => {
    expect(evaluateFeatureAccess({ isPlatformAdmin: true, plan: null, orgCreatedAt: null, planPurchasable: true })).toEqual({
      unlocked: true,
      viaAdmin: true,
      grandfathered: false,
      unsellable: false,
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

// A lock whose only remedy cannot be bought.
//
// Production shipped this gate while the Stripe key was a TEST key: checkout
// completed, no money moved, and wallets.plan stayed 'free' for all 14 orgs.
// Nobody was locked out only because every org happened to predate the paywall
// by a few days — an accident of timing, not a safeguard. The first new signup
// would have been stranded, pointed at a Wallet that could not sell them
// anything.
describe("when no plan can be bought", () => {
  it("opens the gate for a new org rather than stranding it", () => {
    expect(
      evaluateFeatureAccess({
        isPlatformAdmin: false,
        plan: "free",
        orgCreatedAt: NEW_ORG,
        planPurchasable: false,
      }),
    ).toEqual({
      unlocked: true,
      viaAdmin: false,
      grandfathered: false,
      unsellable: true,
      plan: null,
    });
  });

  it("reports unsellable separately from grandfathered", () => {
    // Conflating them would hide a broken payment rail behind a legitimate
    // exemption, and the two clear up in completely different ways.
    const old = evaluateFeatureAccess({
      isPlatformAdmin: false,
      plan: "free",
      orgCreatedAt: OLD_ORG,
      planPurchasable: false,
    });
    expect(old.grandfathered).toBe(true);
    expect(old.unsellable).toBe(false);
  });

  it("still credits a paid plan rather than calling it unsellable", () => {
    const paid = evaluateFeatureAccess({
      isPlatformAdmin: false,
      plan: "pro",
      orgCreatedAt: NEW_ORG,
      planPurchasable: false,
    });
    expect(paid.plan).toBe("pro");
    expect(paid.unsellable).toBe(false);
  });

  it("does not resurrect the fail-closed rule for an unknown org age", () => {
    // predatesPaywall refuses to exempt an unreadable date, and that stays
    // true — but an unbuyable plan opens the gate for its own reason, which is
    // about the deployment and not about this org at all.
    const unknown = evaluateFeatureAccess({
      isPlatformAdmin: false,
      plan: null,
      orgCreatedAt: null,
      planPurchasable: false,
    });
    expect(unknown.unlocked).toBe(true);
    expect(unknown.unsellable).toBe(true);
    expect(unknown.grandfathered).toBe(false);
  });

  it("closes again the moment a plan becomes buyable", () => {
    expect(
      evaluateFeatureAccess({
        isPlatformAdmin: false,
        plan: "free",
        orgCreatedAt: NEW_ORG,
        planPurchasable: true,
      }).unlocked,
    ).toBe(false);
  });

  it("shows members no lock banner, because nothing is locked", () => {
    // FeatureLockBanner returns null whenever access.unlocked, so this state
    // says nothing to members rather than pointing them at a Wallet that cannot
    // sell them a plan. The operator sees it on /admin instead.
    expect(
      evaluateFeatureAccess({
        isPlatformAdmin: false,
        plan: "free",
        orgCreatedAt: NEW_ORG,
        planPurchasable: false,
      }).unlocked,
    ).toBe(true);
  });
});

// What makes a plan buyable at all.
describe("planPurchasable", () => {
  const REMITTANCE = {
    FUNDEXECS_REMITTANCE_BANK_NAME: "First Bank",
    FUNDEXECS_REMITTANCE_ACCOUNT_NAME: "FundExecs LLC",
    FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER: "123456789",
  };

  it("a live Stripe key is enough", () => {
    expect(planPurchasable({ STRIPE_SECRET_KEY: "sk_live_abc" })).toBe(true);
  });

  it("remittance details alone are enough — an invoice is real money", () => {
    expect(planPurchasable(REMITTANCE)).toBe(true);
  });

  it("a TEST key is not, which is the case that caused this", () => {
    // Checkout completes and collects nothing, so a plan bought that way is
    // free and a gate demanding one is theatre.
    expect(planPurchasable({ STRIPE_SECRET_KEY: "sk_test_abc" })).toBe(false);
  });

  it("a test key plus remittance is buyable, via the transfer rail", () => {
    expect(planPurchasable({ STRIPE_SECRET_KEY: "sk_test_abc", ...REMITTANCE })).toBe(true);
  });

  it("half-set remittance is not enough, matching what the code requires", () => {
    const { FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER: _n, ...partial } = REMITTANCE;
    expect(planPurchasable(partial)).toBe(false);
  });

  it("nothing configured is not buyable", () => {
    expect(planPurchasable({})).toBe(false);
  });
});
