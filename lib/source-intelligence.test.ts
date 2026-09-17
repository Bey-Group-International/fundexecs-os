// lib/source-intelligence.test.ts
// Unit tests for the pure summarizers behind the Source context + learning layer
// (the distillation that turns recorded feedback / activity / portfolio into the
// short strings injected into prompts). No DB is touched here; the DB readers are
// thin wrappers around these helpers.
import { __test } from "@/lib/source-intelligence";
import { __test as engineTest } from "@/lib/source-ai";

const {
  summarizeFeedback,
  summarizeActivity,
  summarizePortfolio,
  summarizeUser,
  topCounts,
  recencyWeight,
  weightedTopCounts,
  feedbackMass,
  PERSONAL_SIGNAL_THRESHOLD,
} = __test;
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

describe("recencyWeight", () => {
  const NOW = Date.parse("2026-09-17T00:00:00Z");
  const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

  it("weighs a signal recorded today at full", () => {
    expect(recencyWeight(daysAgo(0), NOW)).toBe(1);
  });

  it("halves at one half-life and quarters at two", () => {
    expect(recencyWeight(daysAgo(30), NOW)).toBeCloseTo(0.5, 5);
    expect(recencyWeight(daysAgo(60), NOW)).toBeCloseTo(0.25, 5);
  });

  it("never decays a signal to nothing", () => {
    expect(recencyWeight(daysAgo(3650), NOW)).toBeGreaterThan(0);
  });

  it("weighs an undated or unparseable row at full rather than discarding it", () => {
    expect(recencyWeight(null, NOW)).toBe(1);
    expect(recencyWeight(undefined, NOW)).toBe(1);
    expect(recencyWeight("not a date", NOW)).toBe(1);
  });

  it("does not exceed full weight for a future-dated row", () => {
    expect(recencyWeight(daysAgo(-5), NOW)).toBe(1);
  });
});

describe("weightedTopCounts", () => {
  it("ranks by summed weight, not by count", () => {
    const out = weightedTopCounts(
      [
        { value: "private_credit", weight: 1 },
        { value: "private_credit", weight: 1 },
        { value: "family_office", weight: 0.2 },
        { value: "family_office", weight: 0.2 },
        { value: "family_office", weight: 0.2 },
      ],
      1,
    );
    // Three stale family-office signals lose to two fresh private-credit ones.
    expect(out).toEqual(["private credit"]);
  });

  it("skips empty values", () => {
    expect(weightedTopCounts([{ value: null, weight: 1 }, { value: "  ", weight: 1 }], 3)).toEqual([]);
  });
});

describe("summarizeFeedback recency weighting", () => {
  const NOW = Date.parse("2026-09-17T00:00:00Z");
  const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

  it("follows a mandate shift instead of averaging over all history", () => {
    const rows = [
      // This quarter: private credit.
      { signal: "accepted", category: "private_credit", subject_name: "New A", action: null, created_at: daysAgo(2) },
      { signal: "accepted", category: "private_credit", subject_name: "New B", action: null, created_at: daysAgo(5) },
      // Last year: family offices, and more of them.
      { signal: "accepted", category: "family_office", subject_name: "Old A", action: null, created_at: daysAgo(300) },
      { signal: "accepted", category: "family_office", subject_name: "Old B", action: null, created_at: daysAgo(320) },
      { signal: "accepted", category: "family_office", subject_name: "Old C", action: null, created_at: daysAgo(340) },
      { signal: "accepted", category: "family_office", subject_name: "Old D", action: null, created_at: daysAgo(360) },
    ];
    expect(summarizeFeedback(rows, NOW)).toContain("favors private credit");
  });

  it("still remembers the older preference behind the current one", () => {
    const rows = [
      { signal: "accepted", category: "private_credit", subject_name: "New A", action: null, created_at: daysAgo(2) },
      { signal: "accepted", category: "family_office", subject_name: "Old A", action: null, created_at: daysAgo(300) },
    ];
    const out = summarizeFeedback(rows, NOW);
    expect(out).toContain("private credit");
    expect(out).toContain("family office");
  });

  it("names the freshest accepts regardless of the order passed in", () => {
    const rows = [
      { signal: "accepted", category: "lp", subject_name: "Ancient", action: null, created_at: daysAgo(400) },
      { signal: "accepted", category: "lp", subject_name: "Fresh", action: null, created_at: daysAgo(1) },
    ];
    const out = summarizeFeedback(rows, NOW);
    expect(out).toContain("recently accepted Fresh, Ancient");
  });

  it("lets a fresh rejection outweigh stale ones", () => {
    const rows = [
      { signal: "rejected", category: "venture", subject_name: "V1", action: null, created_at: daysAgo(1) },
      { signal: "rejected", category: "real_estate", subject_name: "R1", action: null, created_at: daysAgo(200) },
      { signal: "rejected", category: "real_estate", subject_name: "R2", action: null, created_at: daysAgo(210) },
    ];
    expect(summarizeFeedback(rows, NOW)).toContain("tends to skip venture");
  });

  it("treats undated rows the way it always did", () => {
    const out = summarizeFeedback([
      { signal: "accepted", category: "family_office", subject_name: "Acme FO", action: null },
      { signal: "accepted", category: "family_office", subject_name: "Beta FO", action: null },
    ], NOW);
    expect(out).toContain("favors family office");
    expect(out).toContain("recently accepted Acme FO, Beta FO");
  });
});

describe("feedbackMass", () => {
  const NOW = Date.parse("2026-09-17T00:00:00Z");
  const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();
  const row = (created_at: string | null) => ({
    signal: "accepted",
    category: "lp",
    subject_name: "X",
    action: null,
    created_at,
  });

  it("is zero for no signal at all", () => {
    expect(feedbackMass([], NOW)).toBe(0);
  });

  it("counts fresh signals at face value", () => {
    expect(feedbackMass([row(daysAgo(0)), row(daysAgo(0)), row(daysAgo(0))], NOW)).toBeCloseTo(3, 5);
  });

  it("clears the personalization threshold on three fresh signals", () => {
    const fresh = [row(daysAgo(0)), row(daysAgo(1)), row(daysAgo(2))];
    expect(feedbackMass(fresh, NOW)).toBeGreaterThanOrEqual(PERSONAL_SIGNAL_THRESHOLD);
  });

  it("still clears it for an operator active within the last fortnight", () => {
    const recent = [row(daysAgo(3)), row(daysAgo(8)), row(daysAgo(12))];
    expect(feedbackMass(recent, NOW)).toBeGreaterThanOrEqual(PERSONAL_SIGNAL_THRESHOLD);
  });

  it("does not clear it on two fresh signals — three is still the bar", () => {
    expect(feedbackMass([row(daysAgo(0)), row(daysAgo(0))], NOW)).toBeLessThan(
      PERSONAL_SIGNAL_THRESHOLD,
    );
  });

  it("does not clear it on three year-old signals", () => {
    const stale = [row(daysAgo(365)), row(daysAgo(380)), row(daysAgo(400))];
    expect(feedbackMass(stale, NOW)).toBeLessThan(PERSONAL_SIGNAL_THRESHOLD);
  });

  it("clears it on a dozen signals from two months ago", () => {
    const middling = Array.from({ length: 12 }, () => row(daysAgo(60)));
    expect(feedbackMass(middling, NOW)).toBeGreaterThanOrEqual(PERSONAL_SIGNAL_THRESHOLD);
  });

  it("cannot be reached by dormant history alone within the read limit", () => {
    // The reader caps at 120 rows and no signal weighs less than the floor, so
    // the largest possible mass from an entirely cold history stays under the
    // threshold. If either constant moves, this is the guard that catches it.
    const READ_LIMIT = 120;
    const dormant = Array.from({ length: READ_LIMIT }, () => row(daysAgo(3650)));
    expect(feedbackMass(dormant, NOW)).toBeLessThan(PERSONAL_SIGNAL_THRESHOLD);
  });

  it("treats undated rows as live, matching the old count-based behavior", () => {
    expect(feedbackMass([row(null), row(null), row(null)], NOW)).toBe(3);
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
