import { planPurchaseSummary, packPurchaseSummary, PLAN_BY_KEY, CREDIT_PACKS } from "@/lib/billing";

describe("planPurchaseSummary", () => {
  it("summarizes a monthly plan with its price and monthly credits", () => {
    const plan = PLAN_BY_KEY.pro;
    const s = planPurchaseSummary("pro", "monthly");
    expect(s).toMatchObject({
      kind: "plan",
      planKey: "pro",
      interval: "monthly",
      priceUsd: plan.monthly,
      credits: plan.creditsPerMonth,
    });
    expect(s?.label).toContain(plan.name);
    expect(s?.label).toContain("monthly");
  });

  it("front-loads a full year of credits for annual and uses the annual price", () => {
    const plan = PLAN_BY_KEY.pro;
    const s = planPurchaseSummary("pro", "annual");
    expect(s?.priceUsd).toBe(plan.annual);
    expect(s?.credits).toBe(plan.creditsPerMonth * 12);
    expect(s?.label).toContain("annual");
  });

  it("returns null for an unknown plan", () => {
    // @ts-expect-error deliberately invalid key
    expect(planPurchaseSummary("bogus", "monthly")).toBeNull();
  });
});

describe("packPurchaseSummary", () => {
  it("summarizes a known pack", () => {
    const pack = CREDIT_PACKS[0];
    const s = packPurchaseSummary(pack.key);
    expect(s).toMatchObject({
      kind: "pack",
      packKey: pack.key,
      priceUsd: pack.price,
      credits: pack.credits,
    });
  });

  it("returns null for an unknown pack", () => {
    expect(packPurchaseSummary("nope")).toBeNull();
  });
});
