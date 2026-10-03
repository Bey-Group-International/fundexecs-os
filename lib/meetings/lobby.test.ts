import { roomCodeFromInput, upNextMeeting } from "./lobby";

describe("roomCodeFromInput", () => {
  it.each([
    ["abc-defg-hij", "abc-defg-hij"],
    ["  ABC-DEFG-HIJ ", "abc-defg-hij"],
    ["abc defg hij", "abcdefghij"],
    ["https://app.fundexecs.com/meetings/abc-defg-hij", "abc-defg-hij"],
    ["https://app.fundexecs.com/meetings/abc-defg-hij/report", "abc-defg-hij"],
    ["https://app.fundexecs.com/meeting-invite/abc-defg-hij?ref=email", "abc-defg-hij"],
    ["app.fundexecs.com/meetings/abc-defg-hij", "abc-defg-hij"],
    ["/meetings/abc-defg-hij", "abc-defg-hij"],
    ["https://app.fundexecs.com/join?room=abc-defg-hij", "abc-defg-hij"],
  ])("reads %s", (input, code) => {
    expect(roomCodeFromInput(input)).toBe(code);
  });

  it.each([
    [""],
    ["   "],
    ["https://app.fundexecs.com/dashboard"],
    ["https://app.fundexecs.com/meetings/calls"],
    ["not a code!"],
    ["ab"],
  ])("refuses %p", (input) => {
    expect(roomCodeFromInput(input)).toBeNull();
  });
});

describe("upNextMeeting", () => {
  const NOW = new Date(2026, 9, 3, 10, 0).getTime();
  const at = (h: number, m = 0, day = 3) => new Date(2026, 9, day, h, m).toISOString();
  const m = (id: string, start: string | null, over: Record<string, unknown> = {}) => ({
    id,
    title: `Meeting ${id}`,
    room_code: `room-${id}`,
    status: "waiting",
    scheduled_at: start,
    duration_minutes: 30,
    is_draft: false,
    ...over,
  });

  it("puts a room with people in it first, even over one starting now", () => {
    const next = upNextMeeting([m("a", at(10)), m("b", at(9))], { b: { count: 2, names: ["Rae", "Ana"] } }, NOW);
    expect(next?.meeting.id).toBe("b");
    expect(next?.live).toBe(true);
    expect(next?.inRoom.names).toEqual(["Rae", "Ana"]);
  });

  it("calls a meeting under way by the clock live", () => {
    const next = upNextMeeting([m("a", at(9, 45)), m("b", at(11))], {}, NOW);
    expect(next).toMatchObject({ live: true, meeting: { id: "a" } });
  });

  it("otherwise offers the next one still to start today", () => {
    const next = upNextMeeting([m("late", at(15)), m("soon", at(11))], {}, NOW);
    expect(next).toMatchObject({ live: false, meeting: { id: "soon" } });
  });

  it("says nothing when the rest of the day is clear", () => {
    expect(upNextMeeting([m("tomorrow", at(9, 0, 4)), m("earlier", at(8))], {}, NOW)).toBeNull();
  });

  it("skips drafts, ended meetings and ones with no time", () => {
    const next = upNextMeeting(
      [m("draft", at(11), { is_draft: true }), m("ended", at(9, 45), { status: "ended" }), m("tbd", null)],
      { ended: { count: 1, names: ["X"] } },
      NOW,
    );
    expect(next).toBeNull();
  });
});
