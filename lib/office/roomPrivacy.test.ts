import {
  parsePrivateRooms,
  serializePrivateRooms,
  loadPrivateRooms,
  isRoomPrivate,
  setRoomPrivate,
  togglePrivateRoom,
  privacyAnnouncement,
  knockAnnouncement,
  ROOM_PRIVACY_KEY,
  type PrivacyStorage,
} from "./roomPrivacy";

/** A tiny in-memory Storage stub so the persistence path is testable in Node. */
function memStorage(seed?: Record<string, string>): PrivacyStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("roomPrivacy — parse/serialize", () => {
  it("parses null / empty to an empty set", () => {
    expect(parsePrivateRooms(null).size).toBe(0);
    expect(parsePrivateRooms("").size).toBe(0);
  });

  it("ignores malformed JSON and non-arrays", () => {
    expect(parsePrivateRooms("{oops").size).toBe(0);
    expect(parsePrivateRooms('{"a":1}').size).toBe(0);
  });

  it("keeps only non-empty string keys", () => {
    const set = parsePrivateRooms(JSON.stringify(["boardroom", "", 3, null, "trading"]));
    expect([...set].sort()).toEqual(["boardroom", "trading"]);
  });

  it("round-trips through serialize", () => {
    const set = new Set(["boardroom", "trading"]);
    expect(parsePrivateRooms(serializePrivateRooms(set))).toEqual(set);
  });
});

describe("roomPrivacy — persistence", () => {
  it("loads an empty set with no storage", () => {
    expect(loadPrivateRooms(memStorage()).size).toBe(0);
  });

  it("sets, reads, and clears a room's privacy", () => {
    const store = memStorage();
    expect(isRoomPrivate("boardroom", store)).toBe(false);
    setRoomPrivate("boardroom", true, store);
    expect(isRoomPrivate("boardroom", store)).toBe(true);
    setRoomPrivate("boardroom", false, store);
    expect(isRoomPrivate("boardroom", store)).toBe(false);
  });

  it("toggles and returns the new state", () => {
    const store = memStorage();
    expect(togglePrivateRoom("trading", store)).toBe(true);
    expect(isRoomPrivate("trading", store)).toBe(true);
    expect(togglePrivateRoom("trading", store)).toBe(false);
    expect(isRoomPrivate("trading", store)).toBe(false);
  });

  it("persists under the documented key", () => {
    const store = memStorage();
    setRoomPrivate("legal", true, store);
    expect(store.getItem(ROOM_PRIVACY_KEY)).toContain("legal");
  });

  it("ignores empty room keys", () => {
    const store = memStorage();
    setRoomPrivate("", true, store);
    expect(loadPrivateRooms(store).size).toBe(0);
    expect(isRoomPrivate("", store)).toBe(false);
  });

  it("keeps multiple private rooms independent", () => {
    const store = memStorage();
    setRoomPrivate("boardroom", true, store);
    setRoomPrivate("trading", true, store);
    setRoomPrivate("boardroom", false, store);
    expect(isRoomPrivate("boardroom", store)).toBe(false);
    expect(isRoomPrivate("trading", store)).toBe(true);
  });
});

describe("roomPrivacy — announcements", () => {
  it("announces privacy on and off", () => {
    expect(privacyAnnouncement("Boardroom", true)).toBe("🔒 Boardroom is now private");
    expect(privacyAnnouncement("Boardroom", false)).toBe("🔓 Boardroom is open again");
  });

  it("announces a knock with the visitor name", () => {
    expect(knockAnnouncement("Dana", "Boardroom")).toBe("🔔 Dana knocked on Boardroom");
  });

  it("falls back to 'Someone' for a blank visitor", () => {
    expect(knockAnnouncement("  ", "Boardroom")).toBe("🔔 Someone knocked on Boardroom");
  });
});
