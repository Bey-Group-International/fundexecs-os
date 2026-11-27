import {
  inviteQuestions,
  openQuestionCount,
  recommendedAccess,
  suggestInviteNote,
  type InviteContext,
} from "./invite-advice";

function ctx(over: Partial<InviteContext> = {}): InviteContext {
  return {
    meetingType: "internal_strategy",
    title: "Weekly sync",
    attendees: [{ email: "a@fund.com", type: "internal" }],
    unreachableCount: 0,
    objective: "",
    agenda: "",
    preparationRequirements: "",
    guestQuickAccess: true,
    offHoursGuests: 0,
    note: "",
    durationMinutes: 30,
    noteSupported: true,
    ...over,
  };
}

const ids = (c: InviteContext) => inviteQuestions(c).map((q) => q.id);

describe("inviteQuestions", () => {
  it("blocks on an empty guest list", () => {
    const q = inviteQuestions(ctx({ attendees: [] }))[0];
    expect(q).toMatchObject({ id: "guests", blocking: true, open: true });
  });

  it("asks only the essentials for a small internal call", () => {
    expect(ids(ctx())).toEqual(["guests", "note"]);
  });

  it("asks about guests with no address", () => {
    expect(ids(ctx({ unreachableCount: 2 }))).toContain("unreachable");
  });

  it("asks who may join straight in only when outside guests are present", () => {
    expect(ids(ctx())).not.toContain("access");
    expect(ids(ctx({ attendees: [{ email: "x@lp.com", type: "external" }] }))).toContain("access");
  });

  it("recommends a waiting room for confidential meetings, and flags a mismatch", () => {
    expect(recommendedAccess("board_meeting")).toBe("waiting-room");
    expect(recommendedAccess("internal_strategy")).toBe("quick-access");
    const board = ctx({ meetingType: "board_meeting", attendees: [{ email: "x@lp.com", type: "external" }] });
    expect(inviteQuestions(board).find((q) => q.id === "access")!.open).toBe(true);
    expect(inviteQuestions({ ...board, guestQuickAccess: false }).find((q) => q.id === "access")!.open).toBe(false);
  });

  it("asks about prep for board, LP and diligence meetings until it is filled in", () => {
    const base = ctx({ meetingType: "lp_review" });
    expect(inviteQuestions(base).find((q) => q.id === "prep")!.open).toBe(true);
    expect(inviteQuestions({ ...base, preparationRequirements: "Read the Q3 pack" }).find((q) => q.id === "prep")!.open).toBe(false);
  });

  it("asks for an agenda only for a long meeting with outside guests", () => {
    const outside = [{ email: "x@lp.com", type: "external" as const }];
    expect(ids(ctx({ attendees: outside, durationMinutes: 30 }))).not.toContain("agenda");
    expect(ids(ctx({ attendees: outside, durationMinutes: 60 }))).toContain("agenda");
  });

  it("asks about out-of-hours guests", () => {
    expect(ids(ctx({ offHoursGuests: 1 }))).toContain("hours");
  });

  it("does not ask for a note where none can be sent", () => {
    expect(ids(ctx({ noteSupported: false }))).toEqual(["guests"]);
  });

  it("stops asking for a note once one is written", () => {
    expect(inviteQuestions(ctx({ note: "Hi" })).find((q) => q.id === "note")!.open).toBe(false);
  });
});

describe("openQuestionCount", () => {
  it("ignores questions the host has already reviewed", () => {
    const qs = inviteQuestions(ctx({ meetingType: "board_meeting", attendees: [{ email: "x@lp.com", type: "external" }] }));
    const all = openQuestionCount(qs, new Set());
    expect(openQuestionCount(qs, new Set(["access"]))).toBe(all - 1);
  });
});

describe("suggestInviteNote", () => {
  it("builds a note from what the host already wrote", () => {
    const note = suggestInviteNote({
      title: "Q3 LP review",
      objective: "agree the distribution timeline",
      agenda: "Performance\n- Pipeline\nAsks",
      preparationRequirements: "read the Q3 pack",
      offHoursGuests: 0,
    });
    expect(note).toContain('"Q3 LP review"');
    expect(note).toContain("agree the distribution timeline");
    expect(note).toContain("• Pipeline");
    expect(note).toContain("Before we meet: read the Q3 pack");
  });

  it("stays usable with almost nothing filled in, and within the limit", () => {
    expect(suggestInviteNote({ title: "", objective: "", agenda: "", preparationRequirements: "", offHoursGuests: 0 })).toMatch(/invite you to a meeting/);
    expect(suggestInviteNote({ title: "t", objective: "x".repeat(5000), agenda: "", preparationRequirements: "", offHoursGuests: 0 }).length).toBeLessThanOrEqual(1000);
  });
});
