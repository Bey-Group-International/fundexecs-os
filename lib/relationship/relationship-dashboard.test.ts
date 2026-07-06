// Coverage for the pure recommendation logic of the Relationship Command
// Center. Contract: recommendations are derived from the aggregated numbers,
// prioritize live intent, and cap at 5.

import { buildRecommendations } from "./relationship-dashboard";

const empty = {
  contacts: { total: 0, highConfidence: 0, suppressed: 0, lists: 0 },
  campaigns: { total: 0, active: 0, completed: 0, stopped: 0, replied: 0, replyRate: 0 },
  signals: { total: 0, topParties: [] },
};

describe("buildRecommendations", () => {
  it("leads with the highest-intent party when present", () => {
    const recs = buildRecommendations({
      ...empty,
      signals: { total: 3, topParties: [{ party: "Blackstone", events: 3, lastAt: "", intent: 90 }] },
    });
    expect(recs[0]).toContain("Blackstone");
  });

  it("surfaces replies and low-confidence contacts", () => {
    const recs = buildRecommendations({
      contacts: { total: 10, highConfidence: 4, suppressed: 0, lists: 1 },
      campaigns: { total: 8, active: 3, completed: 2, stopped: 0, replied: 2, replyRate: 25 },
      signals: { total: 0, topParties: [] },
    });
    expect(recs.some((r) => /repl/i.test(r))).toBe(true);
    expect(recs.some((r) => /6 contacts below high-confidence/.test(r))).toBe(true);
  });

  it("nudges an empty CRM to start in Prospecting and caps at 5", () => {
    const recs = buildRecommendations(empty);
    expect(recs.some((r) => /Prospecting/.test(r))).toBe(true);
    expect(recs.length).toBeLessThanOrEqual(5);
  });
});
