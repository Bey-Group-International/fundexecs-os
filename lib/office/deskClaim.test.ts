import {
  seatKey,
  roomOfDeskKey,
  loadClaimedDesk,
  isClaimedDesk,
  claimDesk,
  releaseDesk,
  DESK_CLAIM_KEY,
  type DeskStorage,
} from "./deskClaim";

function memStorage(seed?: Record<string, string>): DeskStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("deskClaim — seat key", () => {
  it("builds a stable key from room + rounded position", () => {
    expect(seatKey({ roomKey: "ceo", x: 191.6, y: 143.2 })).toBe("ceo:192:143");
  });

  it("round-trips the room via roomOfDeskKey", () => {
    const k = seatKey({ roomKey: "boardroom", x: 500, y: 320 });
    expect(roomOfDeskKey(k)).toBe("boardroom");
  });

  it("returns the same key for near-identical positions", () => {
    expect(seatKey({ roomKey: "legal", x: 10.2, y: 20.4 })).toBe(
      seatKey({ roomKey: "legal", x: 9.8, y: 20.1 }),
    );
  });
});

describe("deskClaim — claim/release", () => {
  it("loads null with no claim", () => {
    expect(loadClaimedDesk(memStorage())).toBeNull();
  });

  it("claims and reads back a desk", () => {
    const store = memStorage();
    claimDesk("ceo:192:143", store);
    expect(loadClaimedDesk(store)).toBe("ceo:192:143");
    expect(store.getItem(DESK_CLAIM_KEY)).toBe("ceo:192:143");
    expect(isClaimedDesk("ceo:192:143", store)).toBe(true);
    expect(isClaimedDesk("legal:1:2", store)).toBe(false);
  });

  it("releasing clears the claim", () => {
    const store = memStorage();
    claimDesk("ceo:192:143", store);
    releaseDesk(store);
    expect(loadClaimedDesk(store)).toBeNull();
    expect(isClaimedDesk("ceo:192:143", store)).toBe(false);
  });

  it("claiming a new desk replaces the old", () => {
    const store = memStorage();
    claimDesk("ceo:1:1", store);
    claimDesk("legal:2:2", store);
    expect(loadClaimedDesk(store)).toBe("legal:2:2");
  });

  it("ignores an empty key", () => {
    const store = memStorage();
    claimDesk("", store);
    expect(loadClaimedDesk(store)).toBeNull();
  });
});
