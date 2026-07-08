import {
  PRESENCE_STATUSES,
  PRESENCE_STATUS_KEY,
  parseStatus,
  nextStatus,
  statusMeta,
  loadStatus,
  saveStatus,
  type StatusStorage,
  type PresenceStatus,
} from "./presenceStatus";

function memStorage(seed?: Record<string, string>): StatusStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("presenceStatus — parse", () => {
  it("defaults unknown / null to available", () => {
    expect(parseStatus(null)).toBe("available");
    expect(parseStatus("nonsense")).toBe("available");
  });

  it("accepts every known status", () => {
    for (const s of PRESENCE_STATUSES) expect(parseStatus(s.key)).toBe(s.key);
  });
});

describe("presenceStatus — cycle + meta", () => {
  it("cycles through all statuses and wraps", () => {
    const order: PresenceStatus[] = [];
    let s: PresenceStatus = "available";
    for (let i = 0; i < PRESENCE_STATUSES.length; i++) {
      order.push(s);
      s = nextStatus(s);
    }
    expect(order).toEqual(["available", "focus", "dnd", "away"]);
    expect(s).toBe("available"); // wrapped
  });

  it("returns metadata with a label, verb, and dot color", () => {
    const m = statusMeta("dnd");
    expect(m.label).toBe("Do not disturb");
    expect(m.verb).toContain("do-not-disturb");
    expect(m.dot).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("falls back to Available metadata for an unknown status", () => {
    expect(statusMeta("bogus" as PresenceStatus).key).toBe("available");
  });
});

describe("presenceStatus — persistence", () => {
  it("loads the default with no storage", () => {
    expect(loadStatus(memStorage())).toBe("available");
  });

  it("saves and reloads a status under the documented key", () => {
    const store = memStorage();
    saveStatus("focus", store);
    expect(store.getItem(PRESENCE_STATUS_KEY)).toBe("focus");
    expect(loadStatus(store)).toBe("focus");
  });
});
