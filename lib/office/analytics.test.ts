import {
  aggregatePresence,
  emptyAnalyticsSummary,
  type PresenceEvent,
} from "./analytics";

// A fixed clock so every case is deterministic; minutes are exact multiples.
const T0 = Date.parse("2026-07-20T10:00:00.000Z");
const min = (n: number): number => n * 60_000;

function ev(overrides: Partial<PresenceEvent> & { kind: PresenceEvent["kind"]; at: number }): PresenceEvent {
  return {
    principalId: "alice",
    roomKey: null,
    status: null,
    ...overrides,
  };
}

describe("aggregatePresence — sessions", () => {
  it("measures a closed session from join to leave", () => {
    const out = aggregatePresence(
      [
        ev({ kind: "join", at: T0 }),
        ev({ kind: "leave", at: T0 + min(30) }),
      ],
      T0 + min(60),
    );
    expect(out.activeMembers).toBe(1);
    expect(out.totalPresenceMinutes).toBe(30);
  });

  it("closes a still-open session at `now`", () => {
    const out = aggregatePresence([ev({ kind: "join", at: T0 })], T0 + min(10));
    expect(out.totalPresenceMinutes).toBe(10);
  });

  it("sums multiple sessions and members", () => {
    const out = aggregatePresence(
      [
        ev({ principalId: "alice", kind: "join", at: T0 }),
        ev({ principalId: "alice", kind: "leave", at: T0 + min(20) }),
        ev({ principalId: "bob", kind: "join", at: T0 }),
        ev({ principalId: "bob", kind: "leave", at: T0 + min(15) }),
      ],
      T0 + min(60),
    );
    expect(out.activeMembers).toBe(2);
    expect(out.totalPresenceMinutes).toBe(35);
  });

  it("lets a fresh join supersede a dangling open session", () => {
    const out = aggregatePresence(
      [
        ev({ kind: "join", at: T0 }),
        ev({ kind: "join", at: T0 + min(10) }),
        ev({ kind: "leave", at: T0 + min(25) }),
      ],
      T0 + min(60),
    );
    // First session 0–10 (10), second 10–25 (15) → 25 total, not double-counted.
    expect(out.totalPresenceMinutes).toBe(25);
  });
});

describe("aggregatePresence — rooms", () => {
  it("measures room time and picks the busiest room", () => {
    const out = aggregatePresence(
      [
        ev({ kind: "room_enter", roomKey: "build", at: T0 }),
        ev({ kind: "room_leave", roomKey: "build", at: T0 + min(15) }),
        ev({ kind: "room_enter", roomKey: "source", at: T0 + min(20) }),
        ev({ kind: "room_leave", roomKey: "source", at: T0 + min(50) }),
      ],
      T0 + min(60),
    );
    expect(out.perRoomMinutes).toEqual({ build: 15, source: 30 });
    expect(out.busiestRoom).toBe("source");
  });

  it("closes an open room on leave, then again nothing on now", () => {
    const out = aggregatePresence(
      [
        ev({ kind: "join", at: T0 }),
        ev({ kind: "room_enter", roomKey: "commons", at: T0 + min(5) }),
        ev({ kind: "leave", at: T0 + min(25) }),
      ],
      T0 + min(60),
    );
    // Room closed at the leave (25), not carried to `now`.
    expect(out.perRoomMinutes).toEqual({ commons: 20 });
    expect(out.busiestRoom).toBe("commons");
  });

  it("closes a still-open room at `now`", () => {
    const out = aggregatePresence(
      [ev({ kind: "room_enter", roomKey: "run", at: T0 })],
      T0 + min(12),
    );
    expect(out.perRoomMinutes).toEqual({ run: 12 });
  });

  it("switches rooms without an explicit room_leave", () => {
    const out = aggregatePresence(
      [
        ev({ kind: "room_enter", roomKey: "build", at: T0 }),
        ev({ kind: "room_enter", roomKey: "run", at: T0 + min(10) }),
      ],
      T0 + min(30),
    );
    // build 0–10 (10), run 10–30 closed at now (20).
    expect(out.perRoomMinutes).toEqual({ build: 10, run: 20 });
    expect(out.busiestRoom).toBe("run");
  });
});

describe("aggregatePresence — collaboration", () => {
  it("pairs two members overlapping in the same room", () => {
    const out = aggregatePresence(
      [
        ev({ principalId: "alice", kind: "room_enter", roomKey: "commons", at: T0 }),
        ev({ principalId: "alice", kind: "room_leave", roomKey: "commons", at: T0 + min(40) }),
        ev({ principalId: "bob", kind: "room_enter", roomKey: "commons", at: T0 + min(10) }),
        ev({ principalId: "bob", kind: "room_leave", roomKey: "commons", at: T0 + min(30) }),
      ],
      T0 + min(60),
    );
    // Overlap is 10–30 → 20 minutes, ids sorted alice < bob.
    expect(out.collaborationPairs).toEqual([{ a: "alice", b: "bob", minutes: 20 }]);
  });

  it("does not pair members in the same room at different times", () => {
    const out = aggregatePresence(
      [
        ev({ principalId: "alice", kind: "room_enter", roomKey: "run", at: T0 }),
        ev({ principalId: "alice", kind: "room_leave", roomKey: "run", at: T0 + min(10) }),
        ev({ principalId: "bob", kind: "room_enter", roomKey: "run", at: T0 + min(20) }),
        ev({ principalId: "bob", kind: "room_leave", roomKey: "run", at: T0 + min(30) }),
      ],
      T0 + min(60),
    );
    expect(out.collaborationPairs).toEqual([]);
  });

  it("does not pair members in different rooms at the same time", () => {
    const out = aggregatePresence(
      [
        ev({ principalId: "alice", kind: "room_enter", roomKey: "build", at: T0 }),
        ev({ principalId: "alice", kind: "room_leave", roomKey: "build", at: T0 + min(30) }),
        ev({ principalId: "bob", kind: "room_enter", roomKey: "source", at: T0 }),
        ev({ principalId: "bob", kind: "room_leave", roomKey: "source", at: T0 + min(30) }),
      ],
      T0 + min(60),
    );
    expect(out.collaborationPairs).toEqual([]);
  });

  it("orders pairs by minutes, richest first", () => {
    const out = aggregatePresence(
      [
        // alice+bob overlap 30 min in commons
        ev({ principalId: "alice", kind: "room_enter", roomKey: "commons", at: T0 }),
        ev({ principalId: "alice", kind: "room_leave", roomKey: "commons", at: T0 + min(30) }),
        ev({ principalId: "bob", kind: "room_enter", roomKey: "commons", at: T0 }),
        ev({ principalId: "bob", kind: "room_leave", roomKey: "commons", at: T0 + min(30) }),
        // alice+cara overlap 10 min in run
        ev({ principalId: "alice", kind: "room_enter", roomKey: "run", at: T0 + min(40) }),
        ev({ principalId: "alice", kind: "room_leave", roomKey: "run", at: T0 + min(50) }),
        ev({ principalId: "cara", kind: "room_enter", roomKey: "run", at: T0 + min(40) }),
        ev({ principalId: "cara", kind: "room_leave", roomKey: "run", at: T0 + min(50) }),
      ],
      T0 + min(60),
    );
    expect(out.collaborationPairs).toEqual([
      { a: "alice", b: "bob", minutes: 30 },
      { a: "alice", b: "cara", minutes: 10 },
    ]);
  });
});

describe("aggregatePresence — edges", () => {
  it("returns the empty summary for no events", () => {
    expect(aggregatePresence([], T0)).toEqual(emptyAnalyticsSummary());
  });

  it("ignores status events for durations", () => {
    const out = aggregatePresence(
      [
        ev({ kind: "join", at: T0 }),
        ev({ kind: "status", status: "focusing", at: T0 + min(5) }),
        ev({ kind: "leave", at: T0 + min(20) }),
      ],
      T0 + min(60),
    );
    expect(out.totalPresenceMinutes).toBe(20);
    expect(out.perRoomMinutes).toEqual({});
  });

  it("is deterministic — identical inputs yield identical output", () => {
    const events: PresenceEvent[] = [
      ev({ principalId: "alice", kind: "join", at: T0 }),
      ev({ principalId: "alice", kind: "room_enter", roomKey: "run", at: T0 + min(5) }),
      ev({ principalId: "bob", kind: "room_enter", roomKey: "run", at: T0 + min(8) }),
    ];
    const a = aggregatePresence(events, T0 + min(30));
    const b = aggregatePresence(events, T0 + min(30));
    expect(a).toEqual(b);
  });
});
