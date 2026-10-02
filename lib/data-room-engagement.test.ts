import { actionOf, buildEngagement, IDLE_MS, ReadingClock, ruleRead, signalFor, type EngagementView } from "./data-room-engagement";

describe("ReadingClock", () => {
  it("credits time to the document in view while the reader is active", () => {
    const c = new ReadingClock(0);
    c.tick(0, "ppm", true);
    c.tick(5_000, "ppm", true);
    c.tick(10_000, "deck", true); // the 5s before this tick belonged to what was in view at it
    c.tick(12_500, "deck", true);
    expect(c.drain()).toEqual([
      { documentId: "ppm", seconds: 5 },
      { documentId: "deck", seconds: 7 },
    ]);
  });

  it("carries sub-second remainders to the next drain", () => {
    const c = new ReadingClock(0);
    c.tick(0, "ppm", true);
    c.tick(1_500, "ppm", true);
    expect(c.drain()).toEqual([{ documentId: "ppm", seconds: 1 }]);
    c.tick(2_000, "ppm", true);
    expect(c.drain()).toEqual([{ documentId: "ppm", seconds: 1 }]);
  });

  it("stops while the tab is hidden and after the reader goes idle", () => {
    const c = new ReadingClock(0);
    c.tick(0, "ppm", true);
    c.tick(5_000, "ppm", false); // hidden: the 5s up to here still counted
    c.tick(10_000, "ppm", true); // first tick after showing again starts fresh
    c.tick(IDLE_MS + 10_000, "ppm", true); // no input since 0 → idle
    expect(c.drain()).toEqual([{ documentId: "ppm", seconds: 5 }]);
    c.input(IDLE_MS + 11_000);
    c.tick(IDLE_MS + 14_000, "ppm", true);
    expect(c.drain()).toEqual([{ documentId: "ppm", seconds: 4 }]);
  });

  it("never counts a long gap such as a sleeping laptop", () => {
    const c = new ReadingClock(0);
    c.tick(0, "ppm", true);
    c.input(60_000);
    c.tick(60_000, "ppm", true);
    expect(c.drain()).toEqual([]);
  });
});

const v = (o: Partial<EngagementView>): EngagementView => ({
  share_id: "l1",
  document_id: null,
  kind: "room",
  action: null,
  viewer_email: null,
  session_id: null,
  duration_seconds: null,
  created_at: "2026-10-01T10:00:00Z",
  ...o,
});

describe("actionOf", () => {
  it("reads legacy rows by their shape", () => {
    expect(actionOf({ action: null, duration_seconds: 30 })).toBe("read");
    expect(actionOf({ action: null, duration_seconds: null })).toBe("open");
    expect(actionOf({ action: "download", duration_seconds: null })).toBe("download");
  });
});

describe("buildEngagement", () => {
  const now = new Date("2026-10-02T12:00:00Z").getTime();
  const names = new Map([
    ["ppm", "PPM v3"],
    ["deck", "Deck"],
  ]);

  it("joins a reader's email and browser rows into one investor with per-document time", () => {
    const e = buildEngagement(
      [
        v({ kind: "room", action: "open" }), // pre-gate open, nobody yet
        v({ kind: "document", document_id: "ppm", action: "read", session_id: "b1", viewer_email: "LP@x.com", duration_seconds: 400 }),
        v({ kind: "document", document_id: "ppm", action: "read", session_id: "b1", duration_seconds: 200, created_at: "2026-10-02T09:00:00Z" }),
        v({ kind: "document", document_id: "ppm", action: "download", viewer_email: "lp@x.com", created_at: "2026-10-02T09:05:00Z" }),
        v({ kind: "document", document_id: "deck", action: "read", session_id: "b2", duration_seconds: 30 }),
      ],
      names,
      new Map([["l1", "Fund II LPs"]]),
      now,
    );
    expect(e.investors.map((i) => i.key)).toEqual(["email:lp@x.com", "visitor:b2"]);
    const lp = e.investors[0];
    expect(lp.seconds).toBe(600);
    expect(lp.downloads).toBe(1);
    expect(lp.visitDays).toBe(2);
    expect(lp.documents[0]).toEqual({ documentId: "ppm", name: "PPM v3", seconds: 600, opens: 0, downloads: 1 });
    expect(lp.links).toEqual(["Fund II LPs"]);
    expect(lp.signal).toBe("hot");
    expect(lp.timeline.map((t) => [t.day, t.name, t.seconds, t.downloads])).toEqual([
      ["2026-10-02", "PPM v3", 200, 1],
      ["2026-10-01", "PPM v3", 400, 0],
    ]);
    expect(e.investors[1].label).toBe("Visitor b2");
    expect(e.totals).toEqual({ readers: 2, seconds: 630, opens: 1, downloads: 1 });
    expect(e.topDocuments.map((d) => [d.name, d.seconds, d.readers])).toEqual([
      ["PPM v3", 600, 1],
      ["Deck", 30, 1],
    ]);
    expect(e.latestAt).toBe("2026-10-02T09:05:00Z");
  });

  it("names a document that has since been removed", () => {
    const e = buildEngagement([v({ document_id: "gone", action: "read", session_id: "b", duration_seconds: 10 })], names, new Map(), now);
    expect(e.investors[0].documents[0].name).toBe("A removed document");
  });
});

describe("signalFor", () => {
  const now = new Date("2026-10-02T12:00:00Z").getTime();
  it("grades engagement and recency", () => {
    expect(signalFor({ seconds: 1000, downloads: 0, visitDays: 1, lastSeen: "2026-10-02T00:00:00Z" }, now)).toBe("hot");
    expect(signalFor({ seconds: 120, downloads: 0, visitDays: 1, lastSeen: "2026-10-02T00:00:00Z" }, now)).toBe("warm");
    expect(signalFor({ seconds: 20, downloads: 0, visitDays: 1, lastSeen: "2026-10-02T00:00:00Z" }, now)).toBe("cold");
    expect(signalFor({ seconds: 5000, downloads: 2, visitDays: 4, lastSeen: "2026-09-01T00:00:00Z" }, now)).toBe("cold");
  });
});

describe("ruleRead", () => {
  it("writes a plain summary and a next step that matches the signal", () => {
    const e = buildEngagement(
      [v({ document_id: "ppm", action: "read", viewer_email: "lp@x.com", duration_seconds: 1200, created_at: "2026-10-02T09:00:00Z" })],
      new Map([["ppm", "PPM v3"]]),
      new Map(),
      new Date("2026-10-02T12:00:00Z").getTime(),
    );
    const r = ruleRead(e.investors[0]);
    expect(r.signal).toBe("hot");
    expect(r.summary).toBe("20 min reading across 1 day; 1 document read; most time on PPM v3.");
    expect(r.follow_up).toBe("Reach out to lp@x.com now and offer to walk through PPM v3.");
  });
});
