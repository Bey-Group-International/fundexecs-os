import {
  bucketTask,
  byDay,
  daysBetween,
  gridRange,
  groupTaskQueue,
  mapWorkspaceSummary,
  monthGrid,
  monthOf,
  shiftMonth,
  utcDay,
  type QueueTask,
  type ScheduleEntry,
} from "@/lib/network-workspace";

const NOW = new Date("2026-09-19T14:00:00.000Z");

function task(over: Partial<QueueTask> = {}): QueueTask {
  return {
    id: "t1",
    title: "Call them back",
    notes: null,
    dueAt: null,
    priority: "normal",
    status: "open",
    assigneeId: null,
    assigneeName: null,
    contactId: null,
    contactName: null,
    opportunityId: null,
    opportunityName: null,
    completedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("utcDay and daysBetween", () => {
  it("reads an instant as the UTC day it falls on", () => {
    expect(utcDay("2026-09-19T23:59:00.000Z")).toBe("2026-09-19");
    expect(utcDay("2026-09-19")).toBe("2026-09-19");
    expect(utcDay("not a date")).toBeNull();
  });

  it("counts whole days regardless of the time of day", () => {
    // The hours must not matter: 23:00 to 01:00 the next day is one day, not
    // "about two hours, so zero".
    expect(daysBetween("2026-09-19T23:00:00Z", "2026-09-20T01:00:00Z")).toBe(1);
    expect(daysBetween("2026-09-19T01:00:00Z", "2026-09-19T23:00:00Z")).toBe(0);
    expect(daysBetween("2026-09-20", "2026-09-19")).toBe(-1);
  });

  it("stays correct across a daylight-saving boundary", () => {
    // Late October is where local-time arithmetic silently gains or loses an
    // hour and a day-count comes back one short.
    expect(daysBetween("2026-10-24T12:00:00Z", "2026-10-26T12:00:00Z")).toBe(2);
    expect(daysBetween("2026-03-28T12:00:00Z", "2026-03-30T12:00:00Z")).toBe(2);
  });

  it("counts a leap day", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2027-02-28", "2027-03-01")).toBe(1);
  });
});

describe("bucketTask", () => {
  it("keeps this morning's work in Today, not Overdue", () => {
    // It is 14:00. A task that was due at 09:00 is still today's work — a queue
    // that reclassifies it as late while somebody is mid-way through it is
    // lying about the day they agreed to.
    expect(bucketTask("2026-09-19T09:00:00Z", NOW)).toBe("today");
    expect(bucketTask("2026-09-19T23:30:00Z", NOW)).toBe("today");
  });

  it("classifies the rest by whole days", () => {
    expect(bucketTask("2026-09-18T23:00:00Z", NOW)).toBe("overdue");
    expect(bucketTask("2026-09-20T00:30:00Z", NOW)).toBe("week");
    expect(bucketTask("2026-09-26T12:00:00Z", NOW)).toBe("week");
    expect(bucketTask("2026-09-27T12:00:00Z", NOW)).toBe("later");
  });

  it("treats an undated task as unscheduled rather than late", () => {
    expect(bucketTask(null, NOW)).toBe("someday");
    expect(bucketTask(undefined, NOW)).toBe("someday");
    expect(bucketTask("nonsense", NOW)).toBe("someday");
  });
});

describe("groupTaskQueue", () => {
  it("drops empty buckets instead of rendering headings with nothing under them", () => {
    const groups = groupTaskQueue([task({ dueAt: "2026-09-19T09:00:00Z" })], NOW);
    expect(groups.map((g) => g.bucket)).toEqual(["today"]);
  });

  it("orders buckets by urgency", () => {
    const groups = groupTaskQueue(
      [
        task({ id: "a", dueAt: "2026-10-30T09:00:00Z" }),
        task({ id: "b", dueAt: "2026-09-10T09:00:00Z" }),
        task({ id: "c", dueAt: null }),
        task({ id: "d", dueAt: "2026-09-19T09:00:00Z" }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["overdue", "today", "later", "someday"]);
  });

  it("sorts by date, then priority, then title", () => {
    const groups = groupTaskQueue(
      [
        task({ id: "late-low", dueAt: "2026-09-10T09:00:00Z", priority: "low" }),
        task({ id: "early", dueAt: "2026-09-08T09:00:00Z", priority: "low" }),
        task({ id: "late-high", dueAt: "2026-09-10T09:00:00Z", priority: "high" }),
      ],
      NOW,
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["early", "late-high", "late-low"]);
  });

  it("orders undated work by priority, since there is no date to use", () => {
    const groups = groupTaskQueue(
      [
        task({ id: "low", priority: "low", title: "A" }),
        task({ id: "high", priority: "high", title: "Z" }),
      ],
      NOW,
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["high", "low"]);
  });
});

describe("monthGrid", () => {
  it("always returns six whole weeks so the grid does not change height", () => {
    for (const month of ["2026-02", "2026-09", "2027-02", "2028-02"]) {
      expect(monthGrid(month)).toHaveLength(42);
    }
  });

  it("starts on the Monday on or before the first of the month", () => {
    // September 2026 starts on a Tuesday, so the grid opens on 31 August.
    const grid = monthGrid("2026-09", "2026-09-19");
    expect(grid[0].date).toBe("2026-08-31");
    expect(grid[0].inMonth).toBe(false);
    expect(grid[1].date).toBe("2026-09-01");
    expect(grid[1].inMonth).toBe(true);
  });

  it("handles a month that itself begins on a Monday without a blank week", () => {
    // June 2026 begins on a Monday: the grid must start on the 1st, not borrow
    // a whole leading week.
    const grid = monthGrid("2026-06");
    expect(grid[0].date).toBe("2026-06-01");
    expect(grid[0].inMonth).toBe(true);
  });

  it("covers every day of the month exactly once", () => {
    const grid = monthGrid("2026-09");
    const inMonth = grid.filter((d) => d.inMonth).map((d) => d.date);
    expect(inMonth).toHaveLength(30);
    expect(new Set(inMonth).size).toBe(30);
    expect(inMonth[0]).toBe("2026-09-01");
    expect(inMonth[29]).toBe("2026-09-30");
  });

  it("includes the leap day in a leap February", () => {
    const inMonth = monthGrid("2028-02").filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth[28].date).toBe("2028-02-29");
  });

  it("marks today and weekends", () => {
    const grid = monthGrid("2026-09", "2026-09-19");
    const today = grid.find((d) => d.isToday);
    expect(today?.date).toBe("2026-09-19");
    // 19 September 2026 is a Saturday.
    expect(today?.isWeekend).toBe(true);
    expect(grid.filter((d) => d.isWeekend)).toHaveLength(12);
  });

  it("refuses a malformed month rather than inventing days", () => {
    expect(monthGrid("2026-13")).toEqual([]);
    expect(monthGrid("nope")).toEqual([]);
    expect(monthGrid("2026-00")).toEqual([]);
  });
});

describe("shiftMonth", () => {
  it("rolls across a year boundary in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-09", 0)).toBe("2026-09");
    expect(shiftMonth("2026-09", 15)).toBe("2027-12");
  });

  it("leaves a malformed month alone", () => {
    expect(shiftMonth("nope", 1)).toBe("nope");
  });
});

describe("gridRange", () => {
  it("covers the whole grid, not just the month", () => {
    // The query has to fetch the borrowed days too, or the first row of the
    // calendar renders empty when it isn't.
    expect(gridRange("2026-09")).toEqual({ start: "2026-08-31", end: "2026-10-11" });
  });

  it("is null for a month that cannot be drawn", () => {
    expect(gridRange("2026-13")).toBeNull();
  });
});

describe("byDay", () => {
  const entry = (over: Partial<ScheduleEntry>): ScheduleEntry => ({
    kind: "task",
    id: "e1",
    title: "Something",
    onDate: "2026-09-19",
    status: "open",
    priority: "normal",
    assigneeId: null,
    contactId: null,
    opportunityId: null,
    amount: null,
    currency: null,
    overdue: false,
    ...over,
  });

  it("keeps several entries on the same day", () => {
    const map = byDay([
      entry({ id: "a" }),
      entry({ id: "b" }),
      entry({ id: "c", onDate: "2026-09-20" }),
    ]);
    expect(map.get("2026-09-19")?.map((e) => e.id)).toEqual(["a", "b"]);
    expect(map.get("2026-09-20")?.map((e) => e.id)).toEqual(["c"]);
    expect(map.get("2026-09-21")).toBeUndefined();
  });
});

describe("mapWorkspaceSummary", () => {
  it("maps the RPC row, keeping currencies apart", () => {
    const summary = mapWorkspaceSummary({
      tasks_overdue: "3",
      tasks_due_today: 1,
      tasks_due_week: 4,
      tasks_unassigned: 2,
      tasks_mine: 5,
      contacts_cold: 7,
      activities_week: 12,
      closing_soon: [
        { currency: "USD", deal_count: 2, target_total: "10000000.00", weighted_total: "5000000.5" },
        { currency: "EUR", deal_count: 1, target_total: 5000000, weighted_total: 4000000 },
      ],
    });
    expect(summary.tasksOverdue).toBe(3);
    expect(summary.closingSoon).toHaveLength(2);
    expect(summary.closingSoon[0]).toEqual({
      currency: "USD",
      dealCount: 2,
      targetTotal: 10_000_000,
      weightedTotal: 5_000_001,
    });
    // The two currencies stay separate rows — there is no combined total to read.
    expect(summary.closingSoon.map((c) => c.currency)).toEqual(["USD", "EUR"]);
  });

  it("returns zeroes for a missing row rather than throwing", () => {
    const summary = mapWorkspaceSummary(null);
    expect(summary.tasksOverdue).toBe(0);
    expect(summary.closingSoon).toEqual([]);
  });

  it("survives a malformed closing_soon", () => {
    expect(mapWorkspaceSummary({ closing_soon: "not an array" }).closingSoon).toEqual([]);
    expect(mapWorkspaceSummary({ closing_soon: [null] }).closingSoon[0].currency).toBe("USD");
  });
});
