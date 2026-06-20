// lib/activity.test.ts — pure helpers only (no DB, no react import).
import {
  relativeTime,
  dayLabel,
  groupByDay,
  statusTone,
  statusLabel,
  artifactTypeLabel,
  mergeTimeline,
  type ActivityEntry,
} from "@/lib/activity";

const NOW = new Date("2026-06-20T12:00:00.000Z");

function entry(o: Partial<ActivityEntry> & { id: string; when: string }): ActivityEntry {
  return {
    kind: "workflow",
    title: "Untitled",
    status: "completed",
    ...o,
  };
}

describe("relativeTime", () => {
  it("returns 'just now' for sub-minute and future timestamps", () => {
    expect(relativeTime("2026-06-20T11:59:40.000Z", NOW)).toBe("just now");
    expect(relativeTime("2026-06-20T12:05:00.000Z", NOW)).toBe("just now");
  });

  it("formats minutes and hours", () => {
    expect(relativeTime("2026-06-20T11:30:00.000Z", NOW)).toBe("30m ago");
    expect(relativeTime("2026-06-20T10:00:00.000Z", NOW)).toBe("2h ago");
  });

  it("formats yesterday and days", () => {
    expect(relativeTime("2026-06-19T12:00:00.000Z", NOW)).toBe("yesterday");
    expect(relativeTime("2026-06-17T12:00:00.000Z", NOW)).toBe("3d ago");
  });

  it("formats weeks and months for older entries", () => {
    expect(relativeTime("2026-06-06T12:00:00.000Z", NOW)).toBe("2w ago");
    expect(relativeTime("2026-04-20T12:00:00.000Z", NOW)).toBe("2mo ago");
  });

  it("returns empty string for an invalid timestamp", () => {
    expect(relativeTime("not-a-date", NOW)).toBe("");
  });
});

describe("dayLabel", () => {
  it("labels today and yesterday", () => {
    expect(dayLabel("2026-06-20T08:00:00.000Z", NOW)).toBe("Today");
    expect(dayLabel("2026-06-19T23:00:00.000Z", NOW)).toBe("Yesterday");
  });

  it("returns a formatted date for older days", () => {
    const label = dayLabel("2026-06-10T08:00:00.000Z", NOW);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label.length).toBeGreaterThan(0);
  });
});

describe("groupByDay", () => {
  it("buckets entries by day, newest day and newest entry first", () => {
    const entries: ActivityEntry[] = [
      entry({ id: "a", when: "2026-06-18T09:00:00.000Z" }),
      entry({ id: "b", when: "2026-06-20T09:00:00.000Z" }),
      entry({ id: "c", when: "2026-06-20T11:00:00.000Z" }),
      entry({ id: "d", when: "2026-06-19T09:00:00.000Z" }),
    ];
    const groups = groupByDay(entries, NOW);

    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", expect.any(String)]);
    // Today bucket: newest first → c before b.
    expect(groups[0].entries.map((e) => e.id)).toEqual(["c", "b"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["d"]);
    expect(groups[2].entries.map((e) => e.id)).toEqual(["a"]);
  });

  it("drops entries with unparseable timestamps", () => {
    const groups = groupByDay([entry({ id: "x", when: "garbage" })], NOW);
    expect(groups).toEqual([]);
  });

  it("returns an empty array for no entries", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});

describe("statusTone", () => {
  it("maps statuses to coarse tones", () => {
    expect(statusTone("in_progress")).toBe("active");
    expect(statusTone("awaiting_approval")).toBe("pending");
    expect(statusTone("pending")).toBe("pending");
    expect(statusTone("completed")).toBe("done");
    expect(statusTone("failed")).toBe("blocked");
    expect(statusTone("blocked")).toBe("blocked");
    expect(statusTone("cancelled")).toBe("muted");
  });
});

describe("label helpers", () => {
  it("humanizes status labels", () => {
    expect(statusLabel("awaiting_approval")).toBe("Awaiting approval");
    expect(statusLabel("completed")).toBe("Completed");
  });

  it("humanizes artifact type labels with special-cases", () => {
    expect(artifactTypeLabel("ic_memo")).toBe("IC memo");
    expect(artifactTypeLabel("lp_update")).toBe("LP update");
    expect(artifactTypeLabel("risk_report")).toBe("Risk report");
    expect(artifactTypeLabel("model")).toBe("Model");
  });
});

describe("mergeTimeline", () => {
  it("merges, sorts newest-first, and bounds by limit", () => {
    const workflows: ActivityEntry[] = [
      entry({ id: "w1", when: "2026-06-20T09:00:00.000Z" }),
      entry({ id: "w2", when: "2026-06-18T09:00:00.000Z" }),
    ];
    const artifacts: ActivityEntry[] = [
      entry({ id: "a1", kind: "artifact", when: "2026-06-19T09:00:00.000Z" }),
      entry({ id: "a2", kind: "artifact", when: "2026-06-17T09:00:00.000Z" }),
    ];
    const merged = mergeTimeline(workflows, artifacts, 3);
    expect(merged.map((e) => e.id)).toEqual(["w1", "a1", "w2"]);
  });
});
