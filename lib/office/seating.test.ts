import { AGENTS } from "@/lib/agents";
import {
  ROOMS,
  ROOM_BY_KEY,
  OFFICE_COLS,
  OFFICE_ROWS,
  agentDesks,
  type OfficeRoom,
} from "./layout";
import {
  agentSeats,
  nearestFreeSeat,
  seatKey,
  seatsForRoom,
  seatsForRooms,
  type Seat,
} from "./seating";

function inRoom(seat: Seat, room: OfficeRoom): boolean {
  return (
    seat.x >= room.x &&
    seat.x <= room.x + room.w &&
    seat.y >= room.y &&
    seat.y <= room.y + room.h
  );
}

const FACINGS = ["down", "up", "left", "right"];

describe("seatsForRoom", () => {
  it("yields in-bounds seats for a hub, a meeting, a lounge, and reception", () => {
    const rooms: OfficeRoom[] = [
      ROOM_BY_KEY.build, // hub
      { ...ROOM_BY_KEY.lounge, key: "mtg", type: "meeting" }, // meeting table
      ROOM_BY_KEY.lounge, // lounge / soft seating
      ROOM_BY_KEY.reception, // reception couch
    ];
    for (const room of rooms) {
      const seats = seatsForRoom(room);
      expect(seats.length).toBeGreaterThan(0);
      for (const seat of seats) {
        expect(seat.roomKey).toBe(room.key);
        expect(FACINGS).toContain(seat.facing);
        // Inside the room rectangle...
        expect(inRoom(seat, room)).toBe(true);
        // ...and inside the whole office floor.
        expect(seat.x).toBeGreaterThanOrEqual(0);
        expect(seat.x).toBeLessThanOrEqual(OFFICE_COLS);
        expect(seat.y).toBeGreaterThanOrEqual(0);
        expect(seat.y).toBeLessThanOrEqual(OFFICE_ROWS);
      }
    }
  });

  it("gives a hub desk seats that face up toward the desks", () => {
    const seats = seatsForRoom(ROOM_BY_KEY.build);
    const deskSeats = seats.filter((s) => s.kind === "desk");
    expect(deskSeats.length).toBeGreaterThan(0);
    for (const s of deskSeats) expect(s.facing).toBe("up");
  });

  it("rings a meeting table with seats facing inward", () => {
    const room: OfficeRoom = { ...ROOM_BY_KEY.lounge, key: "mtg", type: "meeting" };
    const seats = seatsForRoom(room).filter((s) => s.kind === "table");
    expect(seats.length).toBeGreaterThanOrEqual(4);
    // A ring faces in all four directions.
    const facings = new Set(seats.map((s) => s.facing));
    expect(facings.size).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic — same room in, same seats out", () => {
    for (const room of ROOMS) {
      expect(seatsForRoom(room)).toEqual(seatsForRoom(room));
    }
  });

  it("reads room.objects when present instead of re-furnishing", () => {
    const room: OfficeRoom = {
      ...ROOM_BY_KEY.build,
      key: "custom",
      objects: [{ id: "d1", kind: "desk", x: 5, y: 5 }],
    };
    const seats = seatsForRoom(room);
    expect(seats).toHaveLength(1);
    expect(seats[0].kind).toBe("desk");
    expect(seats[0].facing).toBe("up");
  });
});

describe("seatsForRooms", () => {
  it("flattens seats across all rooms and keeps them in bounds", () => {
    const seats = seatsForRooms(ROOMS);
    expect(seats.length).toBeGreaterThan(0);
    for (const seat of seats) {
      const room = ROOM_BY_KEY[seat.roomKey];
      expect(room).toBeDefined();
      expect(inRoom(seat, room)).toBe(true);
    }
  });
});

describe("seatKey", () => {
  it("is stable and distinguishes seats", () => {
    const a: Seat = { x: 3.04, y: 5.02, facing: "up", roomKey: "build", kind: "desk" };
    const b: Seat = { x: 3.01, y: 4.98, facing: "up", roomKey: "build", kind: "desk" };
    expect(seatKey(a)).toBe(seatKey(b)); // both round to the same tenth
    const c: Seat = { ...a, x: 4 };
    expect(seatKey(a)).not.toBe(seatKey(c));
    const d: Seat = { ...a, roomKey: "run" };
    expect(seatKey(a)).not.toBe(seatKey(d)); // room-scoped
  });
});

describe("agentSeats", () => {
  it("returns a seat for every agent, inside that agent's room", () => {
    const seats = agentSeats(ROOMS);
    const deskRoom = new Map(agentDesks(ROOMS).map((d) => [d.agent.key, d.room]));

    expect(Object.keys(seats)).toHaveLength(AGENTS.length); // all 15
    for (const agent of AGENTS) {
      const seat = seats[agent.key];
      expect(seat).toBeDefined();
      const room = deskRoom.get(agent.key)!;
      expect(seat.roomKey).toBe(room.key);
      expect(inRoom(seat, room)).toBe(true);
    }
  });

  it("gives each hub agent a distinct seat and is deterministic", () => {
    const seats = agentSeats(ROOMS);
    const keys = Object.values(seats).map(seatKey);
    expect(new Set(keys).size).toBe(keys.length); // no two agents share a seat
    expect(agentSeats(ROOMS)).toEqual(agentSeats(ROOMS));
  });
});

describe("nearestFreeSeat", () => {
  const seats: Seat[] = [
    { x: 0, y: 0, facing: "up", roomKey: "r", kind: "chair" },
    { x: 3, y: 0, facing: "up", roomKey: "r", kind: "chair" },
    { x: 10, y: 10, facing: "up", roomKey: "r", kind: "chair" },
  ];

  it("returns the closest seat within maxDist", () => {
    const s = nearestFreeSeat({ x: 0.5, y: 0 }, seats, new Set(), 5);
    expect(s).not.toBeNull();
    expect(s!.x).toBe(0);
  });

  it("skips occupied seats", () => {
    const occupied = new Set([seatKey(seats[0])]);
    const s = nearestFreeSeat({ x: 0.5, y: 0 }, seats, occupied, 5);
    expect(s!.x).toBe(3);
  });

  it("respects maxDist and returns null when nothing is reachable", () => {
    const s = nearestFreeSeat({ x: 100, y: 100 }, seats, new Set(), 5);
    expect(s).toBeNull();
  });

  it("is deterministic on ties", () => {
    const tied: Seat[] = [
      { x: 1, y: 0, facing: "up", roomKey: "b", kind: "chair" },
      { x: -1, y: 0, facing: "up", roomKey: "a", kind: "chair" },
    ];
    const first = nearestFreeSeat({ x: 0, y: 0 }, tied, new Set(), 5);
    const second = nearestFreeSeat({ x: 0, y: 0 }, tied, new Set(), 5);
    expect(first).toEqual(second);
  });
});
