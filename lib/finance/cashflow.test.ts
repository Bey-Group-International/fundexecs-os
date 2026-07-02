import {
  bucketKey,
  projectCashflow,
  dailyRunRate,
  projectWithRunRate,
  type CashflowEvent,
} from "./cashflow";

describe("bucketKey", () => {
  it("day granularity: start === end === the date", () => {
    expect(bucketKey("2026-07-02", "day")).toEqual({ start: "2026-07-02", end: "2026-07-02" });
  });

  it("week granularity: Monday..Sunday enclosing the date", () => {
    // 2026-07-02 is a Thursday → week runs Mon 2026-06-29 .. Sun 2026-07-05.
    expect(bucketKey("2026-07-02", "week")).toEqual({ start: "2026-06-29", end: "2026-07-05" });
    // A Monday is its own week start.
    expect(bucketKey("2026-06-29", "week")).toEqual({ start: "2026-06-29", end: "2026-07-05" });
    // A Sunday belongs to the week that started the prior Monday.
    expect(bucketKey("2026-07-05", "week")).toEqual({ start: "2026-06-29", end: "2026-07-05" });
  });

  it("month granularity: 1st..last day, incl. month length / year boundary", () => {
    expect(bucketKey("2026-07-02", "month")).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    // February in a non-leap year ends on the 28th.
    expect(bucketKey("2026-02-15", "month")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    // February 2028 is a leap year.
    expect(bucketKey("2028-02-15", "month")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(bucketKey("2026-12-31", "month")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});

describe("projectCashflow", () => {
  it("carries a continuous running balance across day buckets", () => {
    const events: CashflowEvent[] = [
      { date: "2026-07-01", amount: 100 },
      { date: "2026-07-02", amount: -30 },
      { date: "2026-07-03", amount: -20 },
    ];
    const p = projectCashflow(1000, events, {
      asOf: "2026-07-01",
      horizonDays: 5,
      granularity: "day",
    });
    expect(p.openingBalance).toBe(1000);
    expect(p.buckets).toHaveLength(3);
    expect(p.buckets[0].closingBalance).toBe(1100);
    expect(p.buckets[1].closingBalance).toBe(1070);
    expect(p.buckets[2].closingBalance).toBe(1050);
    expect(p.closingBalance).toBe(1050);
    expect(p.shortfall).toBe(false);
    // Min closing is the last bucket here.
    expect(p.minBalance).toBe(1050);
    expect(p.minBalanceDate).toBe("2026-07-03");
  });

  it("splits inflow and outflow within a bucket and nets them", () => {
    const events: CashflowEvent[] = [
      { date: "2026-07-02", amount: 200 },
      { date: "2026-07-03", amount: -50 },
    ];
    const p = projectCashflow(0, events, {
      asOf: "2026-07-01",
      horizonDays: 7,
      granularity: "week",
    });
    // Both events fall in the same Mon..Sun week.
    expect(p.buckets).toHaveLength(1);
    expect(p.buckets[0].inflow).toBe(200);
    expect(p.buckets[0].outflow).toBe(-50);
    expect(p.buckets[0].net).toBe(150);
    expect(p.buckets[0].closingBalance).toBe(150);
  });

  it("detects a shortfall and reports the min-balance bucket", () => {
    const events: CashflowEvent[] = [
      { date: "2026-07-01", amount: -60 },
      { date: "2026-07-02", amount: -60 }, // dips below zero here
      { date: "2026-07-03", amount: 200 }, // recovers
    ];
    const p = projectCashflow(100, events, {
      asOf: "2026-07-01",
      horizonDays: 5,
      granularity: "day",
    });
    expect(p.buckets[0].closingBalance).toBe(40);
    expect(p.buckets[1].closingBalance).toBe(-20);
    expect(p.buckets[2].closingBalance).toBe(180);
    expect(p.shortfall).toBe(true);
    expect(p.minBalance).toBe(-20);
    expect(p.minBalanceDate).toBe("2026-07-02");
    expect(p.closingBalance).toBe(180);
  });

  it("filters events outside the horizon (both bounds inclusive)", () => {
    const events: CashflowEvent[] = [
      { date: "2026-06-30", amount: 999 }, // before asOf → excluded
      { date: "2026-07-01", amount: 10 }, // == asOf → included
      { date: "2026-07-04", amount: 5 }, // == asOf + horizon → included
      { date: "2026-07-05", amount: 999 }, // past horizon → excluded
    ];
    const p = projectCashflow(0, events, {
      asOf: "2026-07-01",
      horizonDays: 3,
      granularity: "day",
    });
    expect(p.buckets).toHaveLength(2);
    expect(p.closingBalance).toBe(15);
    expect(p.buckets.map((b) => b.periodStart)).toEqual(["2026-07-01", "2026-07-04"]);
  });

  it("keeps the running balance continuous across empty (unemitted) buckets", () => {
    const events: CashflowEvent[] = [
      { date: "2026-07-01", amount: -40 },
      // nothing on the 2nd/3rd — those day buckets are not emitted
      { date: "2026-07-04", amount: -40 },
    ];
    const p = projectCashflow(100, events, {
      asOf: "2026-07-01",
      horizonDays: 6,
      granularity: "day",
    });
    expect(p.buckets).toHaveLength(2);
    // 100 - 40 = 60, then continues 60 - 40 = 20 (no reset over the gap).
    expect(p.buckets[0].closingBalance).toBe(60);
    expect(p.buckets[1].closingBalance).toBe(20);
    expect(p.closingBalance).toBe(20);
  });

  it("emits no buckets for empty / all-out-of-range events", () => {
    const p = projectCashflow(500, [], {
      asOf: "2026-07-01",
      horizonDays: 30,
      granularity: "month",
    });
    expect(p.buckets).toHaveLength(0);
    expect(p.closingBalance).toBe(500);
    expect(p.minBalance).toBe(500);
    expect(p.minBalanceDate).toBeNull();
    expect(p.shortfall).toBe(false);
  });

  it("groups by calendar month across a longer horizon", () => {
    const events: CashflowEvent[] = [
      { date: "2026-07-10", amount: 100 },
      { date: "2026-07-20", amount: -30 },
      { date: "2026-08-05", amount: -50 },
    ];
    const p = projectCashflow(0, events, {
      asOf: "2026-07-01",
      horizonDays: 60,
      granularity: "month",
    });
    expect(p.buckets).toHaveLength(2);
    expect(p.buckets[0]).toMatchObject({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      net: 70,
      closingBalance: 70,
    });
    expect(p.buckets[1]).toMatchObject({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      net: -50,
      closingBalance: 20,
    });
  });
});

describe("dailyRunRate", () => {
  it("averages in-window amounts over windowDays", () => {
    const actuals: CashflowEvent[] = [
      { date: "2026-06-28", amount: -70 }, // before window (asOf - 6) → excluded
      { date: "2026-06-29", amount: -100 }, // asOf - 5 → included (window of 6)
      { date: "2026-07-02", amount: -200 }, // asOf → included
    ];
    // window [2026-06-29, 2026-07-04]? no — trailing 6 ending at asOf 2026-07-04.
    const rate = dailyRunRate(actuals, 6, "2026-07-04");
    // in-window sum: -100 (06-29) + -200 (07-02) = -300; the 06-28 event is out.
    expect(rate).toBe(round(-300 / 6));
  });

  it("includes both the asOf day and the far edge of the window", () => {
    const actuals: CashflowEvent[] = [
      { date: "2026-07-01", amount: 30 }, // far edge (asOf - 6)
      { date: "2026-07-07", amount: 30 }, // asOf
    ];
    const rate = dailyRunRate(actuals, 7, "2026-07-07");
    expect(rate).toBe(round(60 / 7));
  });

  it("returns 0 when windowDays <= 0", () => {
    const actuals: CashflowEvent[] = [{ date: "2026-07-02", amount: -100 }];
    expect(dailyRunRate(actuals, 0, "2026-07-02")).toBe(0);
    expect(dailyRunRate(actuals, -5, "2026-07-02")).toBe(0);
  });

  it("returns 0 when nothing falls in the window", () => {
    const actuals: CashflowEvent[] = [{ date: "2026-01-01", amount: -100 }];
    expect(dailyRunRate(actuals, 7, "2026-07-02")).toBe(0);
  });
});

describe("projectWithRunRate", () => {
  it("overlays a per-day burn on top of scheduled events", () => {
    const scheduled: CashflowEvent[] = [{ date: "2026-07-02", amount: 500 }];
    // horizon 0..3 inclusive = 4 synthetic days at -100 each = -400.
    const p = projectWithRunRate(1000, scheduled, -100, {
      asOf: "2026-07-01",
      horizonDays: 3,
      granularity: "day",
    });
    // 4 days each get a synthetic event; the 2nd also gets the +500 schedule.
    expect(p.buckets).toHaveLength(4);
    // Day 1: 1000 - 100 = 900
    expect(p.buckets[0].closingBalance).toBe(900);
    // Day 2: 900 + 500 - 100 = 1300
    expect(p.buckets[1].net).toBe(400);
    expect(p.buckets[1].closingBalance).toBe(1300);
    // Day 3: 1300 - 100 = 1200 ; Day 4: 1200 - 100 = 1100
    expect(p.buckets[3].closingBalance).toBe(1100);
    expect(p.closingBalance).toBe(1100);
  });

  it("a large enough burn drives the projection into shortfall", () => {
    const p = projectWithRunRate(150, [], -100, {
      asOf: "2026-07-01",
      horizonDays: 2,
      granularity: "day",
    });
    // 150 -100 = 50 -100 = -50 -100 = -150
    expect(p.shortfall).toBe(true);
    expect(p.minBalance).toBe(-150);
    expect(p.minBalanceDate).toBe("2026-07-03");
  });

  it("collapses the run-rate into the same bucket at coarser granularity", () => {
    const p = projectWithRunRate(1000, [], -10, {
      asOf: "2026-07-01",
      horizonDays: 6, // one full Mon..Sun-ish span, but all within bounds
      granularity: "month",
    });
    // All 7 synthetic -10 events land in July → single month bucket, net -70.
    expect(p.buckets).toHaveLength(1);
    expect(p.buckets[0].net).toBe(-70);
    expect(p.buckets[0].closingBalance).toBe(930);
  });
});

// Local mirror of the module's 4dp rounding for expected values.
function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}
