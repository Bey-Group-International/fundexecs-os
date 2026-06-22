// lib/deal-intelligence.test.ts
import {
  SIGNAL_TYPE_LABELS,
  SIGNAL_TYPE_ICONS,
  SIGNAL_TYPE_COLORS,
  ACTIVITY_COLORS,
  formatSignalSize,
  timeAgo,
  buildHeatmap,
  type SignalType,
  type ActivityLevel,
  type DealSignal,
} from "@/lib/deal-intelligence";

// --- Constants ---------------------------------------------------------------
describe("SIGNAL_TYPE_LABELS", () => {
  it("has a label for all signal types", () => {
    const types: SignalType[] = [
      "funding_round", "acquisition", "ipo", "bankruptcy", "exec_change",
      "partnership", "market_entry", "exit", "lp_activity", "regulatory",
    ];
    for (const t of types) {
      expect(SIGNAL_TYPE_LABELS[t]).toBeTruthy();
      expect(SIGNAL_TYPE_ICONS[t]).toBeTruthy();
      expect(SIGNAL_TYPE_COLORS[t]).toBeTruthy();
    }
  });
});

describe("ACTIVITY_COLORS", () => {
  it("has color styles for all activity levels", () => {
    const levels: ActivityLevel[] = ["low", "moderate", "high", "very_high"];
    for (const l of levels) {
      expect(ACTIVITY_COLORS[l].bg).toBeTruthy();
      expect(ACTIVITY_COLORS[l].text).toBeTruthy();
      expect(ACTIVITY_COLORS[l].border).toBeTruthy();
    }
  });
});

// --- formatSignalSize --------------------------------------------------------
describe("formatSignalSize", () => {
  it("returns — when both min and max are null/undefined", () => {
    expect(formatSignalSize(null, null)).toBe("—");
    expect(formatSignalSize(undefined, undefined)).toBe("—");
  });

  it("uses max when both are provided", () => {
    expect(formatSignalSize(50_000_000, 100_000_000)).toBe("$100M");
  });

  it("falls back to min when max is null", () => {
    expect(formatSignalSize(50_000_000, null)).toBe("$50M");
  });

  it("formats billions", () => {
    expect(formatSignalSize(null, 2_000_000_000)).toBe("$2.0B");
  });

  it("formats amounts below a million in K", () => {
    expect(formatSignalSize(null, 500_000)).toBe("$500K");
  });
});

// --- timeAgo -----------------------------------------------------------------
describe("timeAgo", () => {
  it("returns empty string for undefined", () => {
    expect(timeAgo(undefined)).toBe("");
  });

  it("returns Today for a date within the same day", () => {
    const now = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    expect(timeAgo(now)).toBe("Today");
  });

  it("returns Yesterday for ~1 day ago", () => {
    const yesterday = new Date(Date.now() - 86400000 - 3600000).toISOString();
    expect(timeAgo(yesterday)).toBe("Yesterday");
  });

  it("returns Nd ago for 2-6 days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000 - 3600000).toISOString();
    expect(timeAgo(threeDaysAgo)).toBe("3d ago");
  });

  it("returns Nw ago for 7-29 days ago", () => {
    const twoWeeks = new Date(Date.now() - 14 * 86400000 - 3600000).toISOString();
    expect(timeAgo(twoWeeks)).toBe("2w ago");
  });

  it("returns Nmo ago for 30+ days ago", () => {
    const twoMonths = new Date(Date.now() - 60 * 86400000 - 3600000).toISOString();
    expect(timeAgo(twoMonths)).toBe("2mo ago");
  });
});

// --- buildHeatmap ------------------------------------------------------------
describe("buildHeatmap", () => {
  function makeSignal(overrides: Partial<DealSignal> = {}): DealSignal {
    return {
      id: "s1",
      signalType: "funding_round",
      title: "Test Signal",
      relevanceScore: 80,
      thesisMatchScore: 70,
      sector: "Technology",
      dealStage: "Series A",
      dealSizeMax: 10_000_000,
      ...overrides,
    };
  }

  it("returns empty array for no signals", () => {
    expect(buildHeatmap([])).toEqual([]);
  });

  it("skips signals without sector or dealStage", () => {
    const cells = buildHeatmap([makeSignal({ sector: undefined, dealStage: "Series A" })]);
    expect(cells).toHaveLength(0);
  });

  it("groups signals by sector+stage", () => {
    const signals = [
      makeSignal({ sector: "Tech", dealStage: "Series A" }),
      makeSignal({ id: "s2", sector: "Tech", dealStage: "Series A" }),
      makeSignal({ id: "s3", sector: "Health", dealStage: "Series B" }),
    ];
    const cells = buildHeatmap(signals);
    expect(cells).toHaveLength(2);
    const techCell = cells.find((c) => c.sector === "Tech");
    expect(techCell?.dealCount).toBe(2);
  });

  it("classifies activity level: 1 deal = low, 2 = moderate, 5 = high, 10 = very_high", () => {
    const make = (n: number, stage: string) =>
      Array.from({ length: n }, (_, i) => makeSignal({ id: `s${i}`, dealStage: stage }));

    const cells = buildHeatmap([
      ...make(1, "Seed"),
      ...make(2, "Series A"),
      ...make(5, "Series B"),
      ...make(10, "Series C"),
    ]);

    const byStage = Object.fromEntries(cells.map((c) => [c.stage, c.activityLevel]));
    expect(byStage["Seed"]).toBe("low");
    expect(byStage["Series A"]).toBe("moderate");
    expect(byStage["Series B"]).toBe("high");
    expect(byStage["Series C"]).toBe("very_high");
  });

  it("sums totalValue from dealSizeMax across signals in same bucket", () => {
    const signals = [
      makeSignal({ dealSizeMax: 10_000_000 }),
      makeSignal({ id: "s2", dealSizeMax: 20_000_000 }),
    ];
    const [cell] = buildHeatmap(signals);
    expect(cell.totalValue).toBe(30_000_000);
  });
});
