import { inferStartedAt, meetingDurationSeconds } from "./meeting-span";

describe("inferStartedAt", () => {
  it("keeps what the room recorded", () => {
    expect(inferStartedAt({ startedAt: "2026-10-05T15:00:00.000Z", firstJoinedAt: "2026-10-05T14:00:00Z" }))
      .toBe("2026-10-05T15:00:00.000Z");
  });

  // The Gary Jinks meeting: no started_at, a host who joined at 14:59:50 and a
  // guest who was first heard at 15:03.
  it("takes the earliest moment anyone was in the room", () => {
    expect(inferStartedAt({
      startedAt: null,
      firstJoinedAt: "2026-10-05T14:59:50.497Z",
      firstSpokenAt: "2026-10-05T15:03:10.000Z",
    })).toBe("2026-10-05T14:59:50.497Z");
    expect(inferStartedAt({ startedAt: null, firstSpokenAt: "2026-10-05T15:03:10.000Z" }))
      .toBe("2026-10-05T15:03:10.000Z");
  });

  it("counts back from the end by the browser's own clock when that is all there is", () => {
    expect(inferStartedAt({ startedAt: null, endedAt: "2026-10-05T16:04:13.024Z", durationSeconds: 3853 }))
      .toBe("2026-10-05T15:00:00.024Z");
  });

  it("never invents a start from nothing", () => {
    expect(inferStartedAt({ startedAt: null })).toBeNull();
    expect(inferStartedAt({ startedAt: null, endedAt: "2026-10-05T16:04:13Z", durationSeconds: 0 })).toBeNull();
    expect(inferStartedAt({ startedAt: "not a date", endedAt: "2026-10-05T16:04:13Z" })).toBeNull();
  });
});

describe("meetingDurationSeconds", () => {
  it("is the measured span", () => {
    expect(meetingDurationSeconds({ startedAt: "2026-10-05T14:59:50Z", endedAt: "2026-10-05T16:04:13Z" })).toBe(3863);
  });

  it("is null, not the booked length, when an end is missing", () => {
    expect(meetingDurationSeconds({ startedAt: null, endedAt: "2026-10-05T16:04:13Z" })).toBeNull();
    expect(meetingDurationSeconds({ startedAt: "2026-10-05T16:04:13Z", endedAt: null })).toBeNull();
  });

  it("is null for a span that runs backwards", () => {
    expect(meetingDurationSeconds({ startedAt: "2026-10-05T16:04:13Z", endedAt: "2026-10-05T16:04:13Z" })).toBeNull();
  });
});
