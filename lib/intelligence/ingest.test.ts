// Tests for the pure freshness verdict used by the ingestion pipeline.
import { freshnessFor } from "./ingest";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

describe("freshnessFor", () => {
  it("is fresh within the source TTL", () => {
    expect(freshnessFor("signal_bureau", "2026-07-10T09:00:00.000Z", NOW)).toBe("fresh"); // 3h old
  });

  it("is aging past the fresh TTL but within the aging window", () => {
    expect(freshnessFor("signal_bureau", "2026-07-10T00:00:00.000Z", NOW)).toBe("aging"); // 12h old
  });

  it("is stale past the aging window", () => {
    expect(freshnessFor("signal_bureau", "2026-07-08T00:00:00.000Z", NOW)).toBe("stale"); // >2d old
  });

  it("treats an undisclosed or unparseable as-of as aging, never fresh", () => {
    expect(freshnessFor("signal_bureau", null, NOW)).toBe("aging");
    expect(freshnessFor("signal_bureau", "not-a-date", NOW)).toBe("aging");
  });

  it("falls back to the default TTL for an unknown provider", () => {
    expect(freshnessFor("some_other_provider", "2026-07-10T11:00:00.000Z", NOW)).toBe("fresh");
  });
});
