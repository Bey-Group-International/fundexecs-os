// lib/source-intelligence.test.ts
// Unit tests for the pure summarizers behind the Source context + learning layer
// (the distillation that turns recorded feedback / activity / portfolio into the
// short strings injected into prompts). No DB is touched here; the DB readers are
// thin wrappers around these helpers.
import { __test } from "@/lib/source-intelligence";
import { __test as engineTest } from "@/lib/source-ai";

const { summarizeFeedback, summarizeActivity, summarizePortfolio, summarizeUser, topCounts } = __test;
const { operatorContextBlock } = engineTest;

describe("topCounts", () => {
  it("ranks by frequency and humanizes underscores", () => {
    expect(topCounts(["family_office", "family_office", "fund_of_funds", null, ""], 2)).toEqual([
      "family office",
      "fund of funds",
    ]);
  });
  it("limits to the requested size", () => {
    expect(topCounts(["a", "b", "c", "d"], 2)).toHaveLength(2);
  });
});

describe("summarizeFeedback", () => {
  it("returns empty string with no rows", () => {
    expect(summarizeFeedback([])).toBe("");
  });

  it("captures favored, skipped, queued, and recent accepts", () => {
    const out = summarizeFeedback([
      { signal: "accepted", category: "family_office", subject_name: "Acme FO", action: null },
      { signal: "accepted", category: "family_office", subject_name: "Beta FO", action: null },
      { signal: "rejected", category: "fund_of_funds", subject_name: "Gamma FoF", action: null },
      { signal: "queued", category: null, subject_name: "Acme FO", action: "send_outreach" },
    ]);
    expect(out).toContain("favors family office");
    expect(out).toContain("tends to skip fund of funds");
    expect(out).toContain("usually queues send outreach");
    expect(out).toContain("recently accepted Acme FO");
  });

  it("omits sections that have no signal", () => {
    const out = summarizeFeedback([
      { signal: "accepted", category: "lp", subject_name: "Solo LP", action: null },
    ]);
    expect(out).toContain("favors lp");
    expect(out).not.toContain("tends to skip");
    expect(out).not.toContain("usually queues");
  });
});

describe("summarizeActivity", () => {
  it("is empty when nothing is recent or stalling", () => {
    expect(summarizeActivity({ recentAdds: 0, recentNames: [], stalledNames: [] })).toBe("");
  });
  it("reports recent adds and stalls with samples", () => {
    const out = summarizeActivity({
      recentAdds: 3,
      recentNames: ["A", "B", "C", "D"],
      stalledNames: ["X", "Y"],
    });
    expect(out).toContain("3 added recently (A, B, C)");
    expect(out).toContain("2 stalling (X, Y)");
  });
});

describe("summarizePortfolio", () => {
  it("is empty with no deals", () => {
    expect(summarizePortfolio({ deals: 0, owned: 0, dealNames: [] })).toBe("");
  });
  it("pluralizes and includes owned + sample", () => {
    expect(summarizePortfolio({ deals: 4, owned: 2, dealNames: ["D1", "D2", "D3", "D4"] })).toBe(
      "firm tracks 4 deals, 2 owned (D1, D2, D3)",
    );
    expect(summarizePortfolio({ deals: 1, owned: 0, dealNames: ["Solo"] })).toBe(
      "firm tracks 1 deal (Solo)",
    );
  });
});

describe("summarizeUser", () => {
  it("is empty with nothing to say", () => {
    expect(summarizeUser(null, null, null)).toBe("");
  });
  it("combines name, title, and role", () => {
    expect(summarizeUser("Jane Doe", "Managing Partner", "owner")).toBe(
      "Jane Doe (Managing Partner, owner)",
    );
  });
  it("falls back to Operator when only role is known", () => {
    expect(summarizeUser(null, null, "member")).toBe("Operator (member)");
  });
});

describe("operatorContextBlock (engine formatter)", () => {
  it("returns empty for undefined or empty context", () => {
    expect(operatorContextBlock(undefined)).toBe("");
    expect(operatorContextBlock({})).toBe("");
  });
  it("labels each provided signal and trails with a blank line", () => {
    const block = operatorContextBlock({
      user: "Jane (owner)",
      portfolio: "firm tracks 2 deals",
      activity: "1 added recently",
      learned: "favors family office",
    });
    expect(block).toContain("Operator: Jane (owner)");
    expect(block).toContain("Portfolio context: firm tracks 2 deals");
    expect(block).toContain("Recent pipeline activity: 1 added recently");
    expect(block).toContain("Learned preferences");
    expect(block.endsWith("\n\n")).toBe(true);
  });
});
