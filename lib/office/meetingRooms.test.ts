import { officeMeetingRoomId, isMeetingRoom, roomOccupants } from "./meetingRooms";
import type { OfficeRoom } from "./layout";
import type { Participant } from "./presence";

// A meeting room rect. `type` is the optional field the sibling change adds; we
// attach it via a widened shape so this file doesn't depend on the field being
// declared on OfficeRoom yet.
const meetingRoom = {
  key: "boardroom",
  label: "Boardroom",
  hub: null,
  x: 10,
  y: 10,
  w: 6,
  h: 4,
  accent: "#d4a82a",
  purpose: "Spatial meeting portal.",
  type: "meeting",
} as unknown as OfficeRoom;

const plainRoom: OfficeRoom = {
  key: "commons",
  label: "The Commons",
  hub: null,
  x: 10,
  y: 10,
  w: 6,
  h: 4,
  accent: "#d4a82a",
  purpose: "Where the team gathers.",
};

function human(id: string, x: number, y: number): Participant {
  return { id, name: id, kind: "human", x, y, color: "#fff", status: "available" };
}

describe("officeMeetingRoomId", () => {
  it("is stable and deterministic for the same org + room key", () => {
    const a = officeMeetingRoomId("org-123", "boardroom");
    const b = officeMeetingRoomId("org-123", "boardroom");
    expect(a).toBe(b);
    expect(a).toBe("office-org-123-boardroom");
  });

  it("differs by org and by room key", () => {
    expect(officeMeetingRoomId("org-a", "boardroom")).not.toBe(
      officeMeetingRoomId("org-b", "boardroom"),
    );
    expect(officeMeetingRoomId("org-a", "boardroom")).not.toBe(
      officeMeetingRoomId("org-a", "huddle"),
    );
  });

  it("produces a URL/room-code safe id (lowercase, [a-z0-9-] only)", () => {
    const id = officeMeetingRoomId("Org 123!", "Board Room");
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(id).toBe("office-org-123-board-room");
  });
});

describe("isMeetingRoom", () => {
  it("detects the optional meeting type defensively", () => {
    expect(isMeetingRoom(meetingRoom)).toBe(true);
  });

  it("is false when the type field is absent or not 'meeting'", () => {
    expect(isMeetingRoom(plainRoom)).toBe(false);
    expect(isMeetingRoom({ ...plainRoom, type: "focus" } as unknown as OfficeRoom)).toBe(false);
  });
});

describe("roomOccupants", () => {
  it("includes humans whose tile is inside the room rect", () => {
    const inside = human("inside", 12, 12);
    const edge = human("edge", 16, 14); // on the inclusive far corner
    const occ = roomOccupants(meetingRoom, [inside, edge]);
    expect(occ.map((p) => p.id)).toEqual(["inside", "edge"]);
  });

  it("excludes humans outside the room rect", () => {
    const outside = human("outside", 5, 5);
    const below = human("below", 12, 20);
    expect(roomOccupants(meetingRoom, [outside, below])).toEqual([]);
  });

  it("excludes agents even when they stand inside the rect", () => {
    const agent: Participant = { ...human("earn", 12, 12), kind: "agent", agentKey: "earn" };
    expect(roomOccupants(meetingRoom, [agent])).toEqual([]);
  });
});
