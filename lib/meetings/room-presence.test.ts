import { EMPTY_ROOM, hostWaitNote, inRoomLine, roomSnapshot } from "./room-presence";

const NOW = new Date("2026-11-06T14:00:00Z").getTime();
const row = (over: Record<string, unknown>) => ({ meeting_id: "m", display_name: "X", joined_at: "2026-11-06T13:50:00Z", left_at: null, ...over });

describe("roomSnapshot", () => {
  it("counts each person once, spots the host and finds when it started", () => {
    const s = roomSnapshot(
      [
        row({ user_id: "host", display_name: "Ana", joined_at: "2026-11-06T13:48:00Z" }),
        row({ user_id: "host", display_name: "Ana (tab 2)" }),
        row({ guest_key: "g1", display_name: "Bo" }),
        row({ guest_key: "g2", display_name: "Gone", left_at: "2026-11-06T13:55:00Z" }),
      ],
      "host",
      { now: NOW, withNames: true },
    );
    expect(s).toEqual({ count: 2, hostPresent: true, startedAt: "2026-11-06T13:48:00.000Z", names: ["Ana", "Bo"] });
  });

  it("gives no names unless asked to", () => {
    expect(roomSnapshot([row({ guest_key: "g" })], null, { now: NOW }).names).toEqual([]);
  });
});

describe("inRoomLine", () => {
  it("says who and since when", () => {
    expect(inRoomLine({ count: 3, hostPresent: true, startedAt: "2026-11-06T13:48:00Z", names: ["Ana", "Bo", "Cy"] }, NOW)).toBe(
      "Ana, Bo and 1 other are in · started 12 min ago",
    );
    expect(inRoomLine({ count: 2, hostPresent: false, startedAt: null, names: ["Ana", "Bo"] }, NOW)).toBe("Ana and Bo are in");
    expect(inRoomLine({ count: 1, hostPresent: false, startedAt: null, names: [] }, NOW)).toBe("1 person is in");
    expect(inRoomLine({ count: 4, hostPresent: false, startedAt: "2026-11-06T12:30:00Z", names: [] }, NOW)).toBe(
      "4 people are in · started 1h 30m ago",
    );
    expect(inRoomLine(EMPTY_ROOM, NOW)).toBe("No one is here yet");
  });
});

describe("hostWaitNote", () => {
  it("tells a waiting guest whether the host is there", () => {
    expect(hostWaitNote(null)).toBeNull();
    expect(hostWaitNote(EMPTY_ROOM)).toMatch(/hasn't joined yet/);
    expect(hostWaitNote({ ...EMPTY_ROOM, count: 1, hostPresent: true })).toMatch(/has been told/);
  });
});
