import {
  daysOverdue,
  agingBucketKey,
  summarizeAging,
  type AgingInput,
} from "./invoice-aging";

describe("daysOverdue", () => {
  it("is negative before the due date and positive after", () => {
    expect(daysOverdue("2026-01-20", "2026-01-10")).toBe(-10);
    expect(daysOverdue("2026-01-10", "2026-01-20")).toBe(10);
    expect(daysOverdue("2026-01-10", "2026-01-10")).toBe(0);
  });

  it("returns 0 for an unparseable date instead of NaN", () => {
    expect(daysOverdue("not-a-date", "2026-01-10")).toBe(0);
    expect(daysOverdue("2026-01-10", "")).toBe(0);
  });
});

describe("agingBucketKey", () => {
  it("classifies each bucket by days overdue", () => {
    expect(agingBucketKey("2026-02-01", "2026-01-01")).toBe("current"); // not due
    expect(agingBucketKey("2026-01-01", "2026-01-01")).toBe("current"); // due today
    expect(agingBucketKey("2026-01-01", "2026-01-15")).toBe("d1_30"); // 14d
    expect(agingBucketKey("2026-01-01", "2026-01-31")).toBe("d1_30"); // 30d
    expect(agingBucketKey("2026-01-01", "2026-02-01")).toBe("d31_60"); // 31d
    expect(agingBucketKey("2026-01-01", "2026-03-02")).toBe("d31_60"); // 60d
    expect(agingBucketKey("2026-01-01", "2026-03-17")).toBe("d61_90"); // 75d
    expect(agingBucketKey("2026-01-01", "2026-05-01")).toBe("d90_plus"); // >90d
  });
});

describe("summarizeAging", () => {
  it("rolls balances into the right buckets and totals them", () => {
    const rows: AgingInput[] = [
      { dueDate: "2026-02-01", outstanding: 100 }, // current
      { dueDate: "2026-01-01", outstanding: 50 }, // 1-30 (14d)
      { dueDate: "2025-12-01", outstanding: 25 }, // 31-60 (45d)
      { dueDate: "2025-09-01", outstanding: 10 }, // 90+ (136d)
    ];
    const s = summarizeAging(rows, "2026-01-15");
    expect(s.current).toBe(100);
    expect(s.d1_30).toBe(50);
    expect(s.d31_60).toBe(25);
    expect(s.d90_plus).toBe(10);
    expect(s.total).toBe(185);
  });

  it("ignores non-positive outstanding balances", () => {
    const rows: AgingInput[] = [
      { dueDate: "2026-01-01", outstanding: 0 },
      { dueDate: "2026-01-01", outstanding: -5 },
      { dueDate: "2026-01-01", outstanding: 40 },
    ];
    const s = summarizeAging(rows, "2026-01-10");
    expect(s.total).toBe(40);
    expect(s.d1_30).toBe(40);
  });

  it("rounds bucket sums to 2 decimals", () => {
    const rows: AgingInput[] = [
      { dueDate: "2026-01-01", outstanding: 10.005 },
      { dueDate: "2026-01-01", outstanding: 0.005 },
    ];
    const s = summarizeAging(rows, "2026-01-10");
    expect(s.d1_30).toBe(10.01);
    expect(s.total).toBe(10.01);
  });

  it("returns an all-zero summary for no rows", () => {
    const s = summarizeAging([], "2026-01-10");
    expect(s).toEqual({
      current: 0,
      d1_30: 0,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 0,
      total: 0,
    });
  });
});
