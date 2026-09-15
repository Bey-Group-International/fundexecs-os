// lib/meetings/conflicts.server.test.ts
// The warning that stops a member booking over a commitment they keep
// elsewhere. It must never be the reason a meeting cannot be saved.
const externalBusyForUserMock = jest.fn();
const googleBusyForUserMock = jest.fn();

jest.mock("@/lib/calendar/feeds.server", () => ({
  externalBusyForUser: (...a: unknown[]) => externalBusyForUserMock(...a),
}));
jest.mock("@/lib/calendar/google.server", () => ({
  googleBusyForUser: (...a: unknown[]) => googleBusyForUserMock(...a),
}));

import { loadExternalConflicts } from "./conflicts.server";

const OPTS = {
  userId: "user-1",
  startIso: "2026-09-02T14:00:00.000Z",
  endIso: "2026-09-02T15:00:00.000Z",
  timezone: "America/New_York",
};

beforeEach(() => {
  jest.clearAllMocks();
  externalBusyForUserMock.mockResolvedValue([]);
  googleBusyForUserMock.mockResolvedValue([]);
});

describe("loadExternalConflicts", () => {
  it("merges what both connected sources report", async () => {
    externalBusyForUserMock.mockResolvedValue([
      { start: "2026-09-02T14:00:00.000Z", end: "2026-09-02T14:30:00.000Z" },
    ]);
    googleBusyForUserMock.mockResolvedValue([
      { start: "2026-09-02T14:30:00.000Z", end: "2026-09-02T15:00:00.000Z" },
    ]);
    await expect(loadExternalConflicts({} as never, OPTS)).resolves.toEqual([
      { start: "2026-09-02T14:00:00.000Z", end: "2026-09-02T15:00:00.000Z" },
    ]);
  });

  it("asks both sources about the proposed window, in the host's zone", async () => {
    await loadExternalConflicts({} as never, OPTS);
    expect(externalBusyForUserMock).toHaveBeenCalledWith({}, "user-1", {
      fromIso: OPTS.startIso,
      toIso: OPTS.endIso,
      timezone: "America/New_York",
    });
    expect(googleBusyForUserMock).toHaveBeenCalledWith(
      {},
      "user-1",
      new Date(OPTS.startIso),
      new Date(OPTS.endIso),
      "America/New_York",
    );
  });

  it("reports nothing for a window that isn't one, rather than querying", async () => {
    await expect(
      loadExternalConflicts({} as never, { ...OPTS, endIso: OPTS.startIso }),
    ).resolves.toEqual([]);
    expect(googleBusyForUserMock).not.toHaveBeenCalled();
  });

  it("reports nothing for an unparseable time", async () => {
    await expect(loadExternalConflicts({} as never, { ...OPTS, startIso: "soon" })).resolves.toEqual([]);
    expect(externalBusyForUserMock).not.toHaveBeenCalled();
  });
});
