// Coverage for Earn's prospecting copilot core. Contracts:
//   - interpretGoal maps plain language to a persona + agent + sequence
//   - scoreCandidate scores + gates a candidate
//   - planProspects ranks by priority, segments, gates, and routes

import {
  interpretGoal,
  scoreCandidate,
  planProspects,
  type ProspectCandidate,
} from "./prospecting-copilot";
import type { Mandate } from "./prospect-scoring";

const mandate: Mandate = {
  geographies: ["Texas"],
  assetClasses: ["private credit"],
  targetRoles: ["Chief Investment Officer", "Managing Partner"],
};

describe("interpretGoal", () => {
  it("routes a fundraising goal to the capital raiser + LP sequence", () => {
    const g = interpretGoal("help me raise capital for Fund I");
    expect(g.goal).toBe("raise_capital");
    expect(g.agentKey).toBe("capital_raiser");
    expect(g.sequenceKey).toBe("lp_warm_intro");
  });

  it("routes a deal-sourcing goal to the deal sourcer", () => {
    expect(interpretGoal("source acquisition targets in HVAC").agentKey).toBe("deal_sourcer");
  });

  it("routes lenders to the capital connector", () => {
    expect(interpretGoal("find lenders for this deal").goal).toBe("find_lenders");
  });

  it("falls back to general sourcing for an unmatched goal", () => {
    expect(interpretGoal("do something vague").goal).toBe("general_sourcing");
  });
});

describe("scoreCandidate", () => {
  it("scores a strong candidate high and marks it outreach-ready when verified", () => {
    const c: ProspectCandidate = {
      name: "Mia Reyes", title: "Chief Investment Officer", company: "Cascade FO",
      location: "Austin, Texas", seniority: "c_suite", confidence: 90, email: "mia@cascade.com", verified: true,
    };
    const s = scoreCandidate(c, mandate);
    expect(s.fit).toBeGreaterThanOrEqual(70); // strong mandate fit
    expect(s.eligibleForOutreach).toBe(true);
  });

  it("holds a low-confidence unverified candidate for review", () => {
    const c: ProspectCandidate = { name: "Unknown", title: "Analyst", confidence: 20, verified: false, email: null };
    const s = scoreCandidate(c, mandate);
    expect(s.eligibleForOutreach).toBe(false);
    expect(s.holdReason).toContain("review");
  });

  it("holds a non-contactable candidate regardless of fit", () => {
    const c: ProspectCandidate = {
      name: "Blocked Exec", title: "Managing Partner", seniority: "c_suite", confidence: 95,
      email: "x@y.com", verified: true, contactable: false, contactableReason: "unsubscribed",
    };
    const s = scoreCandidate(c, mandate);
    expect(s.eligibleForOutreach).toBe(false);
    expect(s.holdReason).toBe("unsubscribed");
  });
});

describe("planProspects", () => {
  const candidates: ProspectCandidate[] = [
    { name: "Top Fit", title: "Chief Investment Officer", company: "A", location: "Texas", seniority: "c_suite", confidence: 90, email: "a@a.com", verified: true },
    { name: "Weak Fit", title: "Analyst", company: null, location: "Berlin", seniority: "individual", confidence: 15, verified: false, email: null },
  ];

  it("ranks by priority, segments, gates, and routes to an agent", () => {
    const goal = interpretGoal("raise capital");
    const plan = planProspects({ goal, mandate, candidates });

    expect(plan.status).toBe("draft");
    expect(plan.requiresApproval).toBe(true);
    expect(plan.prospects[0].candidate.name).toBe("Top Fit"); // highest priority first
    expect(plan.readyForOutreach.map((p) => p.candidate.name)).toEqual(["Top Fit"]);
    expect(plan.heldForReview.map((p) => p.candidate.name)).toEqual(["Weak Fit"]);
    expect(plan.routedAgent).toBe("capital_raiser");
    expect(plan.nextActions.length).toBeGreaterThan(0);
  });
});
