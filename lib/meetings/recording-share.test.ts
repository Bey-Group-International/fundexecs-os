import {
  MAX_CLIP_MS,
  MIN_CLIP_MS,
  cleanDays,
  cleanLabel,
  cleanWindow,
  expiryLabel,
  formatClock,
  parseClock,
  partsForWindow,
  rangeAllowed,
  shareState,
} from "./recording-share";
import type { TimelinePart } from "./recording-timeline";

// Ten 5-second parts of 100 bytes each.
const PARTS: TimelinePart[] = Array.from({ length: 10 }, (_, i) => ({
  idx: i,
  start: i * 100,
  end: (i + 1) * 100,
  offsetMs: i * 5000,
  durationMs: 5000,
}));

describe("shareState", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it("is revoked before it is expired", () => {
    expect(shareState({ expires_at: "2026-11-01T00:00:00Z", revoked_at: "2026-10-30T00:00:00Z" }, now)).toBe("revoked");
  });
  it("is expired at or after its expiry", () => {
    expect(shareState({ expires_at: "2026-11-06T12:00:00Z", revoked_at: null }, now)).toBe("expired");
  });
  it("is active before it", () => {
    expect(shareState({ expires_at: "2026-11-07T00:00:00Z", revoked_at: null }, now)).toBe("active");
  });
});

describe("cleanWindow", () => {
  it("keeps a sensible window", () => {
    expect(cleanWindow(10_000, 40_000, 50_000)).toEqual({ startMs: 10_000, endMs: 40_000 });
  });
  it("clamps the end to the recording", () => {
    expect(cleanWindow(10_000, 90_000, 50_000)).toEqual({ startMs: 10_000, endMs: 50_000 });
  });
  it("refuses a start past the end of the recording", () => {
    expect(cleanWindow(60_000, 70_000, 50_000)).toBeNull();
  });
  it("stretches a too-short window, moving back at the end", () => {
    expect(cleanWindow(1000, 2000, 50_000)).toEqual({ startMs: 1000, endMs: 1000 + MIN_CLIP_MS });
    expect(cleanWindow(48_000, 49_000, 50_000)).toEqual({ startMs: 50_000 - MIN_CLIP_MS, endMs: 50_000 });
  });
  it("caps a window at an hour", () => {
    const w = cleanWindow(0, 5 * MAX_CLIP_MS, 10 * MAX_CLIP_MS)!;
    expect(w.endMs! - w.startMs).toBe(MAX_CLIP_MS);
  });
  it("fills a missing end", () => {
    expect(cleanWindow(0, null, 30_000)).toEqual({ startMs: 0, endMs: 30_000 });
  });
  it("refuses a non-numeric end", () => {
    expect(cleanWindow(0, "soon", 30_000)).toBeNull();
  });
});

describe("cleanLabel and cleanDays", () => {
  it("cleans a label to one capped line", () => {
    expect(cleanLabel("  Pricing\n\n talk ")).toBe("Pricing talk");
    expect(cleanLabel("   ")).toBeNull();
    expect(cleanLabel(42)).toBeNull();
    expect(cleanLabel("x".repeat(500))!.length).toBe(120);
  });
  it("accepts only the offered expiries", () => {
    expect(cleanDays(30)).toBe(30);
    expect(cleanDays("90")).toBe(90);
    expect(cleanDays(365)).toBe(7);
  });
});

describe("partsForWindow", () => {
  it("serves the header part and the window with a part of slack each side", () => {
    // 20s–30s covers parts 4 and 5; slack adds 3 and 6; part 0 always.
    expect(partsForWindow(PARTS, { startMs: 20_000, endMs: 30_000 }).map((p) => p.idx)).toEqual([0, 3, 4, 5, 6]);
  });
  it("does not run past either end", () => {
    expect(partsForWindow(PARTS, { startMs: 0, endMs: 5000 }).map((p) => p.idx)).toEqual([0, 1]);
    expect(partsForWindow(PARTS, { startMs: 45_000, endMs: 50_000 }).map((p) => p.idx)).toEqual([0, 8, 9]);
  });
  it("serves only the header when nothing overlaps", () => {
    expect(partsForWindow(PARTS, { startMs: 90_000, endMs: 95_000 }).map((p) => p.idx)).toEqual([0]);
  });
});

describe("rangeAllowed", () => {
  const allowed = partsForWindow(PARTS, { startMs: 20_000, endMs: 30_000 }); // 0, 3-6
  it("allows a range inside one run", () => {
    expect(rangeAllowed(allowed, 300, 699)).toBe(true);
    expect(rangeAllowed(allowed, 0, 99)).toBe(true);
  });
  it("refuses a range that crosses into a part outside the clip", () => {
    expect(rangeAllowed(allowed, 0, 399)).toBe(false);
    expect(rangeAllowed(allowed, 600, 799)).toBe(false);
    expect(rangeAllowed(allowed, 900, 999)).toBe(false);
  });
  it("refuses an inverted range", () => {
    expect(rangeAllowed(allowed, 500, 400)).toBe(false);
  });
});

describe("expiryLabel", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it("counts days, then hours", () => {
    expect(expiryLabel({ expires_at: "2026-11-12T12:00:00Z", revoked_at: null }, now)).toBe("Expires in 6 days");
    expect(expiryLabel({ expires_at: "2026-11-06T15:00:00Z", revoked_at: null }, now)).toBe("Expires in 3 hours");
    expect(expiryLabel({ expires_at: "2026-11-06T12:30:00Z", revoked_at: null }, now)).toBe("Expires in 1 hour");
  });
  it("says expired and revoked", () => {
    expect(expiryLabel({ expires_at: "2026-11-01T00:00:00Z", revoked_at: null }, now)).toBe("Expired");
    expect(expiryLabel({ expires_at: "2026-12-01T00:00:00Z", revoked_at: "2026-11-02T00:00:00Z" }, now)).toBe("Revoked");
  });
});

describe("clock", () => {
  it("parses and formats", () => {
    expect(parseClock("2:10")).toBe(130_000);
    expect(parseClock("1:02:03")).toBe(3_723_000);
    expect(parseClock("45")).toBe(45_000);
    expect(parseClock("2:75")).toBeNull();
    expect(parseClock("soon")).toBeNull();
    expect(formatClock(130_000)).toBe("2:10");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(formatClock(-5)).toBe("0:00");
  });
});
