import { guestKeyStorageKey, resolveGuestKey, type KeyStore } from "./guest-key";

/** An in-memory Storage stand-in; `mode` reproduces the browsers that refuse. */
function store(seed: Record<string, string> = {}, mode: "ok" | "read-throws" | "write-throws" = "ok"): KeyStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem(key) {
      if (mode === "read-throws") throw new Error("storage blocked");
      return key in data ? data[key] : null;
    },
    setItem(key, value) {
      if (mode === "write-throws") throw new Error("quota");
      data[key] = value;
    },
  };
}

describe("guestKeyStorageKey", () => {
  it("namespaces by room, so one meeting's key is not reused for another", () => {
    expect(guestKeyStorageKey("abc-defg-hi")).not.toBe(guestKeyStorageKey("zzz-yyyy-xx"));
  });
});

describe("resolveGuestKey", () => {
  it("stores the fresh key the first time a guest reaches a room", () => {
    const s = store();
    expect(resolveGuestKey("abc-defg-hi", "fresh-1", s)).toBe("fresh-1");
    expect(s.data[guestKeyStorageKey("abc-defg-hi")]).toBe("fresh-1");
  });

  // The bug this exists for: a reload used to knock again under a new key, so the
  // host's admit landed on a row the guest was no longer polling.
  it("returns the same key on a reload, so an admit reaches the guest", () => {
    const s = store();
    const first = resolveGuestKey("abc-defg-hi", "fresh-1", s);
    const second = resolveGuestKey("abc-defg-hi", "fresh-2", s);
    expect(second).toBe(first);
  });

  // Same mechanism, the other direction: a deny that a refresh undoes is not a deny.
  it("keeps a denied guest on the row the host denied", () => {
    const s = store({ [guestKeyStorageKey("abc-defg-hi")]: "denied-guest" });
    expect(resolveGuestKey("abc-defg-hi", "fresh-1", s)).toBe("denied-guest");
  });

  it("keys rooms separately", () => {
    const s = store();
    resolveGuestKey("room-one", "key-one", s);
    expect(resolveGuestKey("room-two", "key-two", s)).toBe("key-two");
  });

  it("falls back to the fresh key with no storage at all (server render)", () => {
    expect(resolveGuestKey("abc-defg-hi", "fresh-1", null)).toBe("fresh-1");
    expect(resolveGuestKey("abc-defg-hi", "fresh-1", undefined)).toBe("fresh-1");
  });

  // Unusable storage must cost a guest the stickiness, never the ability to join.
  it("still yields a usable key when reads throw", () => {
    expect(resolveGuestKey("abc-defg-hi", "fresh-1", store({}, "read-throws"))).toBe("fresh-1");
  });

  it("still yields a usable key when writes throw", () => {
    expect(resolveGuestKey("abc-defg-hi", "fresh-1", store({}, "write-throws"))).toBe("fresh-1");
  });
});
