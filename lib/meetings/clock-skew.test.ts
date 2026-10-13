import { SKEW_LIMIT_MS, SKEW_TOLERANCE_MS, clockSkewMs, correctedTs } from "./clock-skew";

const NOW = Date.parse("2026-10-13T14:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("clockSkewMs", () => {
  it("measures a clock an hour behind as an hour to add", () => {
    expect(clockSkewMs(NOW - HOUR, NOW)).toBe(HOUR);
  });

  it("measures a clock an hour ahead as an hour to take away", () => {
    expect(clockSkewMs(NOW + HOUR, NOW)).toBe(-HOUR);
  });

  it("leaves ordinary drift and network delay alone", () => {
    expect(clockSkewMs(NOW - 2_000, NOW)).toBe(0);
    expect(clockSkewMs(NOW + SKEW_TOLERANCE_MS - 1, NOW)).toBe(0);
  });

  it("knows nothing from an old client, or a value that is not a time", () => {
    expect(clockSkewMs(undefined, NOW)).toBe(0);
    expect(clockSkewMs("1760364000000", NOW)).toBe(0);
    expect(clockSkewMs(Number.NaN, NOW)).toBe(0);
    expect(clockSkewMs(Infinity, NOW)).toBe(0);
  });

  it("does not believe a difference too large to be a clock", () => {
    expect(clockSkewMs(NOW - SKEW_LIMIT_MS - 1, NOW)).toBe(0);
  });
});

describe("correctedTs", () => {
  it("puts a skewed guest's line back in the conversation it belongs to", () => {
    // Spoke at 12:59:46 by a clock an hour behind: really 13:59:46.
    const spoke = Date.parse("2026-10-13T12:59:46Z");
    expect(new Date(correctedTs(spoke, HOUR, NOW)).toISOString()).toBe("2026-10-13T13:59:46.000Z");
  });

  it("never dates a line after the server's own now", () => {
    expect(correctedTs(NOW + 5_000, 0, NOW)).toBe(NOW);
    expect(correctedTs(NOW - 1_000, HOUR, NOW)).toBe(NOW);
  });

  it("changes nothing when there is no skew", () => {
    expect(correctedTs(NOW - 30_000, 0, NOW)).toBe(NOW - 30_000);
  });
});
