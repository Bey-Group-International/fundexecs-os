import { gainForDistance, clamp01 } from "./spatialAudio";
import { PROXIMITY_RADIUS } from "./layout";

describe("gainForDistance", () => {
  it("is 1 when co-located", () => {
    expect(gainForDistance(0)).toBe(1);
    expect(gainForDistance(-1)).toBe(1); // co-located / degenerate distance
  });

  it("is 0 exactly at the radius", () => {
    expect(gainForDistance(PROXIMITY_RADIUS)).toBe(0);
  });

  it("is 0 beyond the radius", () => {
    expect(gainForDistance(PROXIMITY_RADIUS + 0.01)).toBe(0);
    expect(gainForDistance(PROXIMITY_RADIUS * 3)).toBe(0);
  });

  it("decreases monotonically from 0 out to the radius", () => {
    let prev = gainForDistance(0);
    for (let d = 0.1; d <= PROXIMITY_RADIUS; d += 0.1) {
      const g = gainForDistance(d);
      expect(g).toBeLessThanOrEqual(prev);
      prev = g;
    }
  });

  it("stays within [0, 1] across the whole range", () => {
    for (let d = 0; d <= PROXIMITY_RADIUS * 2; d += 0.05) {
      const g = gainForDistance(d);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  it("respects a custom radius", () => {
    expect(gainForDistance(0, 10)).toBe(1);
    expect(gainForDistance(10, 10)).toBe(0);
    // A distance that is silent at the default radius is still audible at a
    // larger one.
    expect(gainForDistance(PROXIMITY_RADIUS + 1, PROXIMITY_RADIUS)).toBe(0);
    expect(gainForDistance(PROXIMITY_RADIUS + 1, 10)).toBeGreaterThan(0);
  });

  it("returns 0 for non-finite distances", () => {
    expect(gainForDistance(Number.POSITIVE_INFINITY)).toBe(0);
    expect(gainForDistance(Number.NaN)).toBe(0);
  });
});

describe("clamp01", () => {
  it("clamps values below 0", () => {
    expect(clamp01(-1)).toBe(0);
  });

  it("clamps values above 1", () => {
    expect(clamp01(2)).toBe(1);
  });

  it("passes through in-range values", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
  });

  it("maps NaN to 0", () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});
