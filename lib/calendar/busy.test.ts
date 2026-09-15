import { externalEventsToBusy, clipToWindow } from "@/lib/calendar/busy";

describe("externalEventsToBusy", () => {
  it("keeps ordinary timed events", () => {
    expect(
      externalEventsToBusy(
        [{ starts_at: "2026-09-16T14:00:00.000Z", ends_at: "2026-09-16T15:00:00.000Z" }],
        "America/New_York",
      ),
    ).toEqual([{ start: "2026-09-16T14:00:00.000Z", end: "2026-09-16T15:00:00.000Z" }]);
  });

  it("drops events the owner marked free, and cancellations", () => {
    expect(
      externalEventsToBusy(
        [
          { starts_at: "2026-09-16T14:00:00.000Z", ends_at: "2026-09-16T15:00:00.000Z", transparency: "transparent" },
          { starts_at: "2026-09-16T16:00:00.000Z", ends_at: "2026-09-16T17:00:00.000Z", status: "cancelled" },
        ],
        "UTC",
      ),
    ).toEqual([]);
  });

  it("drops zero-length and inverted spans", () => {
    expect(
      externalEventsToBusy(
        [
          { starts_at: "2026-09-16T14:00:00.000Z", ends_at: "2026-09-16T14:00:00.000Z" },
          { starts_at: "2026-09-16T15:00:00.000Z", ends_at: "2026-09-16T14:00:00.000Z" },
          { starts_at: "not a date", ends_at: "2026-09-16T14:00:00.000Z" },
        ],
        "UTC",
      ),
    ).toEqual([]);
  });

  // The headline of this module: all-day events are STORED at UTC midnight, and
  // a host who is not in UTC would otherwise have the wrong hours blocked.
  it("anchors an all-day event to the host's own midnight, not UTC's", () => {
    const busy = externalEventsToBusy(
      [{ starts_at: "2026-09-17T00:00:00.000Z", ends_at: "2026-09-18T00:00:00.000Z", is_all_day: true }],
      "America/New_York",
    );
    // 2026-09-17 00:00 in New York is 04:00 UTC (EDT, UTC-4).
    expect(busy).toEqual([{ start: "2026-09-17T04:00:00.000Z", end: "2026-09-18T04:00:00.000Z" }]);
  });

  it("anchors an all-day event east of UTC too", () => {
    const busy = externalEventsToBusy(
      [{ starts_at: "2026-09-17T00:00:00.000Z", ends_at: "2026-09-18T00:00:00.000Z", is_all_day: true }],
      "Asia/Tokyo",
    );
    // Tokyo is UTC+9 year round, so its 17th starts on the 16th in UTC.
    expect(busy).toEqual([{ start: "2026-09-16T15:00:00.000Z", end: "2026-09-17T15:00:00.000Z" }]);
  });

  it("spans every day of a multi-day all-day event, end exclusive", () => {
    expect(
      externalEventsToBusy(
        [{ starts_at: "2026-09-17T00:00:00.000Z", ends_at: "2026-09-20T00:00:00.000Z", is_all_day: true }],
        "UTC",
      ),
    ).toEqual([{ start: "2026-09-17T00:00:00.000Z", end: "2026-09-20T00:00:00.000Z" }]);
  });

  it("gives an all-day event with no span a whole day rather than none", () => {
    expect(
      externalEventsToBusy(
        [{ starts_at: "2026-09-17T00:00:00.000Z", ends_at: "2026-09-17T00:00:00.000Z", is_all_day: true }],
        "UTC",
      ),
    ).toEqual([{ start: "2026-09-17T00:00:00.000Z", end: "2026-09-18T00:00:00.000Z" }]);
  });

  it("survives null input", () => {
    expect(externalEventsToBusy(null, "UTC")).toEqual([]);
  });
});

describe("clipToWindow", () => {
  const from = "2026-09-16T00:00:00.000Z";
  const to = "2026-09-17T00:00:00.000Z";

  it("drops intervals wholly outside the window", () => {
    expect(
      clipToWindow(
        [
          { start: "2026-09-10T09:00:00.000Z", end: "2026-09-10T10:00:00.000Z" },
          { start: "2026-09-20T09:00:00.000Z", end: "2026-09-20T10:00:00.000Z" },
        ],
        from,
        to,
      ),
    ).toEqual([]);
  });

  it("keeps an overlap but trims it to the window", () => {
    expect(
      clipToWindow([{ start: "2026-09-01T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z" }], from, to),
    ).toEqual([{ start: from, end: to }]);
  });

  it("treats window edges as exclusive touching, not overlap", () => {
    expect(
      clipToWindow([{ start: "2026-09-15T23:00:00.000Z", end: from }], from, to),
    ).toEqual([]);
  });

  it("passes everything through when the window makes no sense", () => {
    const all = [{ start: "2026-09-10T09:00:00.000Z", end: "2026-09-10T10:00:00.000Z" }];
    expect(clipToWindow(all, "nonsense", to)).toEqual(all);
  });
});
