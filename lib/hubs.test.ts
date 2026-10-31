import { HUB_BY_KEY } from "./hubs";

describe("Run hub modules", () => {
  const keys = HUB_BY_KEY.run.modules.map((m) => m.key);

  it("has Onboarding where Outreach used to be", () => {
    expect(keys).toContain("onboarding");
    expect(keys).not.toContain("outreach");
    expect(HUB_BY_KEY.run.modules.find((m) => m.key === "onboarding")?.label).toBe("Onboarding");
  });

  it("keeps Campaigns, which now hosts the outbound cadence tools", () => {
    expect(keys).toContain("campaigns");
  });

  it("lists each module once", () => {
    expect(new Set(keys).size).toBe(keys.length);
  });
});
