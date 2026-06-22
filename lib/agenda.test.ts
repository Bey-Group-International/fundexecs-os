// lib/agenda.test.ts — unit tests for the PURE agenda helpers (no DB / RSC).
import {
  daysUntil,
  bucketFor,
  relativeDue,
  severityRank,
  compareAgendaItems,
  groupAgenda,
  overdueCount,
  agendaCount,
  bucketCounts,
  severityCounts,
  agendaSummaryLine,
  type AgendaItem,
} from "./agenda";

// Fixed reference point: midday on a known date so day-boundary math is stable.
const NOW = new Date("2026-06-20T12:00:00");

function item(partial: Partial<AgendaItem> & { id: string; when: string }): AgendaItem {
  return {
    kind: "diligence",
    title: partial.id,
    category: "general",
    href: "/x",
    ...partial,
  };
}

describe("daysUntil", () => {
  it("is 0 for today and ignores time-of-day", () => {
    expect(daysUntil("2026-06-20T23:30:00", NOW)).toBe(0);
  });
  it("is negative for past dates (overdue)", () => {
    expect(daysUntil("2026-06-17", NOW)).toBe(-3);
  });
  it("is positive for future dates", () => {
    expect(daysUntil("2026-06-22", NOW)).toBe(2);
  });
});

describe("bucketFor", () => {
  it("classifies yesterday as overdue", () => {
    expect(bucketFor("2026-06-19", NOW)).toBe("overdue");
  });
  it("classifies today as today", () => {
    expect(bucketFor("2026-06-20", NOW)).toBe("today");
  });
  it("classifies +1 and +7 as week", () => {
    expect(bucketFor("2026-06-21", NOW)).toBe("week");
    expect(bucketFor("2026-06-27", NOW)).toBe("week");
  });
  it("classifies +8 as later", () => {
    expect(bucketFor("2026-06-28", NOW)).toBe("later");
  });
});

describe("relativeDue", () => {
  it("labels overdue days and weeks", () => {
    expect(relativeDue("2026-06-17", NOW)).toBe("overdue 3d");
    expect(relativeDue("2026-06-06", NOW)).toBe("overdue 2w");
  });
  it("labels today", () => {
    expect(relativeDue("2026-06-20", NOW)).toBe("today");
  });
  it("labels upcoming days and weeks", () => {
    expect(relativeDue("2026-06-22", NOW)).toBe("in 2d");
    expect(relativeDue("2026-07-11", NOW)).toBe("in 3w");
  });
});

describe("severityRank", () => {
  it("orders severities and defaults absent to 0", () => {
    expect(severityRank("critical")).toBeGreaterThan(severityRank("high"));
    expect(severityRank("high")).toBeGreaterThan(severityRank("low"));
    expect(severityRank(undefined)).toBe(0);
    expect(severityRank(null)).toBe(0);
  });
});

describe("compareAgendaItems", () => {
  it("sorts soonest date first", () => {
    const later = item({ id: "later", when: "2026-06-25" });
    const sooner = item({ id: "sooner", when: "2026-06-21" });
    expect([later, sooner].sort(compareAgendaItems).map((i) => i.id)).toEqual([
      "sooner",
      "later",
    ]);
  });
  it("breaks date ties by descending severity", () => {
    const low = item({ id: "low", when: "2026-06-21", severity: "low" });
    const crit = item({ id: "crit", when: "2026-06-21", severity: "critical" });
    expect([low, crit].sort(compareAgendaItems).map((i) => i.id)).toEqual([
      "crit",
      "low",
    ]);
  });
});

describe("groupAgenda", () => {
  const items: AgendaItem[] = [
    item({ id: "od", when: "2026-06-15" }),
    item({ id: "td", when: "2026-06-20" }),
    item({ id: "wk", when: "2026-06-23" }),
    item({ id: "lt", when: "2026-07-30" }),
  ];

  it("produces buckets in fixed order, skipping empties", () => {
    const keys = groupAgenda(items, NOW).map((b) => b.key);
    expect(keys).toEqual(["overdue", "today", "week", "later"]);
  });
  it("omits buckets with no items", () => {
    const only = groupAgenda([item({ id: "td", when: "2026-06-20" })], NOW);
    expect(only).toHaveLength(1);
    expect(only[0].key).toBe("today");
  });
  it("places each item in its bucket", () => {
    const groups = groupAgenda(items, NOW);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.items.map((i) => i.id)]));
    expect(byKey.overdue).toEqual(["od"]);
    expect(byKey.week).toEqual(["wk"]);
  });
});

describe("counts", () => {
  const items: AgendaItem[] = [
    item({ id: "od1", when: "2026-06-10" }),
    item({ id: "od2", when: "2026-06-18" }),
    item({ id: "future", when: "2026-06-25" }),
  ];
  it("agendaCount returns total length", () => {
    expect(agendaCount(items)).toBe(3);
  });
  it("overdueCount counts only past-due items", () => {
    expect(overdueCount(items, NOW)).toBe(2);
  });
});

describe("bucketCounts", () => {
  const items: AgendaItem[] = [
    item({ id: "od1", when: "2026-06-10" }),
    item({ id: "od2", when: "2026-06-18" }),
    item({ id: "td", when: "2026-06-20" }),
    item({ id: "wk", when: "2026-06-23" }),
    item({ id: "lt", when: "2026-07-30" }),
  ];
  it("tallies each bucket relative to now", () => {
    expect(bucketCounts(items, NOW)).toEqual({
      overdue: 2,
      today: 1,
      week: 1,
      later: 1,
    });
  });
  it("returns all-zero for an empty list", () => {
    expect(bucketCounts([], NOW)).toEqual({
      overdue: 0,
      today: 0,
      week: 0,
      later: 0,
    });
  });
});

describe("severityCounts", () => {
  it("tallies by severity and counts absent as none", () => {
    const items: AgendaItem[] = [
      item({ id: "c", when: "2026-06-20", severity: "critical" }),
      item({ id: "h", when: "2026-06-20", severity: "high" }),
      item({ id: "h2", when: "2026-06-20", severity: "high" }),
      item({ id: "plain", when: "2026-06-20" }),
    ];
    expect(severityCounts(items)).toEqual({
      critical: 1,
      high: 2,
      medium: 0,
      low: 0,
      none: 1,
    });
  });
});

describe("agendaSummaryLine", () => {
  it("returns a placeholder when empty", () => {
    expect(agendaSummaryLine([], NOW)).toBe("Nothing scheduled");
  });
  it("joins only non-zero segments", () => {
    const items: AgendaItem[] = [
      item({ id: "od", when: "2026-06-10" }),
      item({ id: "td1", when: "2026-06-20" }),
      item({ id: "td2", when: "2026-06-20" }),
    ];
    expect(agendaSummaryLine(items, NOW)).toBe("1 overdue · 2 due today");
  });
});
