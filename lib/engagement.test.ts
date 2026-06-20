// lib/engagement.test.ts
// Unit tests for the pure helpers behind the relationship feedback loop.
import {
  engagementBoost,
  floorTemperatureByEngagement,
  isEngagingAction,
} from "@/lib/engagement";

describe("engagementBoost", () => {
  it("is zero with no engagement", () => {
    expect(engagementBoost(0)).toBe(0);
    expect(engagementBoost(-3)).toBe(0);
  });

  it("rises with engagement but saturates at 15", () => {
    expect(engagementBoost(1)).toBeGreaterThan(0);
    expect(engagementBoost(100)).toBe(15);
    expect(engagementBoost(2)).toBeGreaterThanOrEqual(engagementBoost(1));
  });

  it("shows diminishing returns", () => {
    const first = engagementBoost(1) - engagementBoost(0);
    const later = engagementBoost(20) - engagementBoost(19);
    expect(first).toBeGreaterThan(later);
  });
});

describe("floorTemperatureByEngagement", () => {
  it("lifts a cold investor to warm once engaged", () => {
    expect(floorTemperatureByEngagement("cold", 1)).toBe("warm");
  });

  it("leaves cold alone with no engagement", () => {
    expect(floorTemperatureByEngagement("cold", 0)).toBe("cold");
  });

  it("never downgrades a hotter temperature", () => {
    expect(floorTemperatureByEngagement("active", 5)).toBe("active");
    expect(floorTemperatureByEngagement("committed", 5)).toBe("committed");
  });
});

describe("isEngagingAction", () => {
  it("recognizes external actions", () => {
    expect(isEngagingAction("send_outreach")).toBe(true);
    expect(isEngagingAction("send_diligence_request")).toBe(true);
  });

  it("ignores internal drafts", () => {
    expect(isEngagingAction("draft_message")).toBe(false);
    expect(isEngagingAction("research")).toBe(false);
  });
});
