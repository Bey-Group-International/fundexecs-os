import {
  ACTION_LABEL,
  dayLabel,
  groupByDay,
  inWeek,
  initialsOf,
  isToday,
  matchesQuery,
  needsAction,
  parseTab,
  rowChips,
  weekLabel,
  weekRange,
  type WorkspaceMeeting,
} from "@/lib/meetings/workspace";

// Thursday 2 October 2026, 09:00 UTC.
const NOW = Date.UTC(2026, 9, 2, 9, 0);
const at = (days: number, hour = 10) => new Date(Date.UTC(2026, 9, 2 + days, hour)).toISOString();
const m = (id: string, over: Partial<WorkspaceMeeting> = {}): WorkspaceMeeting => ({
  id,
  title: `Meeting ${id}`,
  scheduled_at: at(0),
  ...over,
});
const TZ = "UTC";

describe("parseTab", () => {
  it("accepts the four tabs and nothing else", () => {
    expect(parseTab("needs")).toBe("needs");
    expect(parseTab("past")).toBe("past");
    expect(parseTab("logs")).toBeNull();
    expect(parseTab(null)).toBeNull();
  });
});

describe("days", () => {
  it("labels today, tomorrow, and later days by name", () => {
    expect(dayLabel("2026-10-02", NOW, TZ)).toBe("Today");
    expect(dayLabel("2026-10-03", NOW, TZ)).toBe("Tomorrow");
    expect(dayLabel("2026-10-09", NOW, TZ)).toBe("Fri, Oct 9");
    expect(dayLabel("2027-01-04", NOW, TZ)).toBe("Mon, Jan 4, 2027");
  });

  it("groups by day in time order, with unscheduled meetings last", () => {
    const groups = groupByDay(
      [m("b", { scheduled_at: at(1) }), m("tbd", { scheduled_at: null }), m("a", { scheduled_at: at(0, 14) }), m("c", { scheduled_at: at(0, 9) })],
      NOW,
      TZ,
    );
    expect(groups.map((g) => [g.label, g.meetings.map((x) => x.id)])).toEqual([
      ["Today", ["c", "a"]],
      ["Tomorrow", ["b"]],
      ["Time TBD", ["tbd"]],
    ]);
  });

  it("knows what is today in the reader's zone", () => {
    // 23:30 UTC on the 2nd is already the 3rd in Tokyo.
    const late = m("x", { scheduled_at: new Date(Date.UTC(2026, 9, 2, 23, 30)).toISOString() });
    expect(isToday(late, NOW, "UTC")).toBe(true);
    expect(isToday(late, NOW, "Asia/Tokyo")).toBe(false);
  });
});

describe("weeks", () => {
  it("runs Monday to Sunday", () => {
    expect(weekRange(NOW, 0, TZ)).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(weekRange(NOW, 1, TZ)).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });

  it("names the near weeks and dates the rest", () => {
    expect(weekLabel(weekRange(NOW, 0, TZ), 0)).toBe("This week");
    expect(weekLabel(weekRange(NOW, 1, TZ), 1)).toBe("Next week");
    expect(weekLabel(weekRange(NOW, 2, TZ), 2)).toBe("Oct 12 – Oct 18");
  });

  it("filters to a week, inclusive of Sunday", () => {
    const range = weekRange(NOW, 0, TZ);
    expect(inWeek(m("sun", { scheduled_at: at(2, 22) }), range, TZ)).toBe(true);
    expect(inWeek(m("mon", { scheduled_at: at(3) }), range, TZ)).toBe(false);
    expect(inWeek(m("tbd", { scheduled_at: null }), range, TZ)).toBe(false);
  });
});

describe("matchesQuery", () => {
  const meeting = m("1", {
    title: "Atlas IC",
    meeting_type: "investment_committee",
    tags: ["fund-iii"],
    attendees: [{ name: "Jane Doe", email: "jane@lp.test" }],
  });

  it("matches every word across title, type, tags and people", () => {
    expect(matchesQuery(meeting, "atlas jane")).toBe(true);
    expect(matchesQuery(meeting, "investment committee")).toBe(true);
    expect(matchesQuery(meeting, "fund-iii")).toBe(true);
    expect(matchesQuery(meeting, "lp.test")).toBe(true);
    expect(matchesQuery(meeting, "atlas mark")).toBe(false);
  });

  it("matches everything when the box is empty", () => {
    expect(matchesQuery(meeting, "  ")).toBe(true);
  });
});

describe("needsAction", () => {
  const statuses: Record<string, string> = {
    soon: "Prep Needed",
    far: "Prep Needed",
    ran: "Follow-Up Needed",
    ok: "Ready",
  };
  const upcoming = [
    m("far", { scheduled_at: at(10) }),
    m("soon", { scheduled_at: at(2) }),
    m("ran", { scheduled_at: at(-1) }),
    m("ok", { scheduled_at: at(1) }),
  ];

  it("lists prep due within a week, then follow-ups, then unsent drafts", () => {
    const items = needsAction(upcoming, (x) => statuses[x.id], [
      { id: "old", room_code: "r", title: "Old", occurred_at: at(-3) },
      // Already listed as an upcoming follow-up; not listed twice.
      { id: "ran", room_code: "r", title: "Ran", occurred_at: at(-1) },
    ], NOW);
    expect(items.map((i) => [i.reason, i.meeting?.id ?? i.past?.id])).toEqual([
      ["prep", "soon"],
      ["followup", "ran"],
      ["unsent", "old"],
    ]);
  });

  it("lists follow-ups nobody has answered after the unsent ones", () => {
    const items = needsAction([], () => "", [
      { id: "quiet", room_code: "q", title: "Quiet", occurred_at: at(-4), kind: "awaiting", threads: 3 },
      { id: "old", room_code: "r", title: "Old", occurred_at: at(-3) },
    ], NOW);
    expect(items.map((i) => [i.reason, i.past?.id])).toEqual([
      ["unsent", "old"],
      ["awaiting", "quiet"],
    ]);
    expect(ACTION_LABEL.awaiting).toBe("Awaiting reply");
  });
});

describe("rowChips", () => {
  it("raises priority, follow-up state, a linked deal and two tags", () => {
    const chips = rowChips(
      m("1", { priority: "critical", followup_status: "draft", deal_id: "d1", tags: ["a", "b", "c"] }),
    );
    expect(chips.map((c) => c.label)).toEqual(["Critical", "Follow-up drafted", "Deal", "a", "b"]);
  });

  it("says nothing for a plain meeting", () => {
    expect(rowChips(m("1", { priority: "normal" }))).toEqual([]);
  });

  it("shows a follow-up held for approval, and a replied one without loaded counts", () => {
    expect(rowChips(m("1", { followup_status: "pending_approval" })).map((c) => c.label)).toEqual([
      "Follow-up awaiting approval",
    ]);
    expect(rowChips(m("1", { followup_status: "replied" })).map((c) => c.label)).toEqual(["Replied"]);
  });
});

describe("initialsOf", () => {
  it("uses letters only", () => {
    expect(initialsOf("Guest (phone)")).toBe("GP");
    expect(initialsOf("jane.doe@lp.test")).toBe("JD");
    expect(initialsOf("")).toBe("?");
  });
});

describe("reply status on a row", () => {
  it("shows unread replies first, then how many answered, instead of 'Follow-up sent'", () => {
    expect(rowChips(m("1", { followup_status: "done", followup_threads: 3, followup_replies: 2, followup_unread: 1 }))).toEqual([
      { label: "1 new reply", tone: "accent" },
    ]);
    expect(rowChips(m("1", { followup_status: "done", followup_threads: 3, followup_replies: 2, followup_unread: 0 }))).toEqual([
      { label: "Replied 2/3", tone: "success" },
    ]);
  });

  it("falls back to the follow-up state while nobody has replied", () => {
    expect(rowChips(m("1", { followup_status: "done", followup_threads: 3, followup_replies: 0 }))).toEqual([
      { label: "Follow-up sent", tone: "success" },
    ]);
  });
});
