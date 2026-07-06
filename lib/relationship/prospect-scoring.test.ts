// Coverage for unified prospect scoring. Contracts:
//   - fitScore rewards geography match, seniority, role/asset-class relevance
//   - priorityScore blends signals with fit + confidence dominant
//   - needsReview gates low-confidence / unverified / email-less contacts
//   - bulkOutboundEligibility combines the compliance + review gates

import {
  fitScore,
  priorityScore,
  needsReview,
  bulkOutboundEligibility,
  scoreBand,
} from "./prospect-scoring";

describe("scoreBand", () => {
  it("bands by threshold", () => {
    expect(scoreBand(85)).toBe("high");
    expect(scoreBand(55)).toBe("medium");
    expect(scoreBand(20)).toBe("low");
  });
});

describe("fitScore", () => {
  const mandate = {
    geographies: ["Texas", "US"],
    assetClasses: ["private credit"],
    targetRoles: ["Managing Partner", "Chief Investment Officer"],
  };

  it("scores a senior, in-geo, on-role contact high", () => {
    const r = fitScore(
      { seniority: "c_suite", title: "Chief Investment Officer", company: "Cascade FO", location: "Austin, Texas" },
      mandate,
    );
    expect(r.band).toBe("high");
    expect(r.reasons).toEqual(expect.arrayContaining([expect.stringContaining("target geography")]));
  });

  it("scores an off-geo, junior, unrelated contact lower", () => {
    const strong = fitScore(
      { seniority: "c_suite", title: "Managing Partner", company: "X", location: "Texas" },
      mandate,
    ).score;
    const weak = fitScore(
      { seniority: "individual", title: "Analyst", company: null, location: "Berlin" },
      mandate,
    ).score;
    expect(weak).toBeLessThan(strong);
  });
});

describe("priorityScore", () => {
  it("ranks a high-fit, high-confidence prospect above a low one", () => {
    const hot = priorityScore({ fit: 90, confidence: 85, engagement: 60, strength: 50 }).score;
    const cold = priorityScore({ fit: 20, confidence: 10 }).score;
    expect(hot).toBeGreaterThan(cold);
  });

  it("treats missing signals as 0, not a penalty", () => {
    const r = priorityScore({ fit: 80 });
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("needsReview", () => {
  it("passes a verified contact", () => {
    expect(needsReview({ verified: true, confidence: 10 })).toBe(false);
  });
  it("flags low confidence, missing email, or unverified", () => {
    expect(needsReview({ confidence: 30, email: "a@b.com" })).toBe(true);
    expect(needsReview({ confidence: 80, email: null })).toBe(true);
    expect(needsReview({ confidence: 80, email: "a@b.com" })).toBe(false);
  });
});

describe("bulkOutboundEligibility", () => {
  it("blocks when not contactable", () => {
    const r = bulkOutboundEligibility({ contactable: false, contactableReason: "unsubscribed", needsReview: false });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("unsubscribed");
  });
  it("blocks a review-needed contact unless override", () => {
    expect(bulkOutboundEligibility({ contactable: true, needsReview: true }).eligible).toBe(false);
    expect(bulkOutboundEligibility({ contactable: true, needsReview: true, allowUnreviewed: true }).eligible).toBe(true);
  });
  it("allows a clean, reviewed contact", () => {
    expect(bulkOutboundEligibility({ contactable: true, needsReview: false }).eligible).toBe(true);
  });
});
