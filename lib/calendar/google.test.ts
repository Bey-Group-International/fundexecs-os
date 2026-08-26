import {
  CONNECTION_FAILURE_ALERT_THRESHOLD,
  blocksTime,
  connectionHealth,
  decideSyncMode,
  describeGoogleError,
  isTombstone,
  normalizeCalendar,
  normalizeEvent,
  normalizeHexColor,
  syncWindow,
} from "./google";

describe("normalizeCalendar", () => {
  it("keeps the name the member gave the calendar over Google's original", () => {
    const c = normalizeCalendar({ id: "c1", summary: "rae@example.com", summaryOverride: "Work" });
    expect(c?.summary).toBe("Work");
  });

  it("falls back to the original name, then to a generic one", () => {
    expect(normalizeCalendar({ id: "c1", summary: "Team" })?.summary).toBe("Team");
    expect(normalizeCalendar({ id: "c1" })?.summary).toBe("Calendar");
  });

  it("refuses an entry with no id", () => {
    expect(normalizeCalendar({ id: "" })).toBeNull();
  });

  it("records the access role, which decides whether write-back is possible", () => {
    expect(normalizeCalendar({ id: "c1", accessRole: "reader" })?.accessRole).toBe("reader");
  });
});

// Colors reach a style attribute, so anything that isn't plainly a hex color
// has no business getting there.
describe("normalizeHexColor", () => {
  it("accepts the form Google actually sends", () => {
    expect(normalizeHexColor("#0B8043")).toBe("#0b8043");
    expect(normalizeHexColor("#abc")).toBe("#abc");
  });

  it("drops anything that is not a hex color", () => {
    for (const bad of ["red", "javascript:alert(1)", "#12345", "url(x)", "", "expression(1)", "#ggg"]) {
      expect(normalizeHexColor(bad)).toBeNull();
    }
  });

  it("drops a non-string", () => {
    expect(normalizeHexColor(undefined)).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });
});

describe("normalizeEvent", () => {
  const timed = {
    id: "e1",
    summary: "Board call",
    start: { dateTime: "2026-09-01T09:00:00Z" },
    end: { dateTime: "2026-09-01T10:00:00Z" },
  };

  it("reduces a timed event to instants", () => {
    const e = normalizeEvent(timed);
    expect(e).toMatchObject({
      googleEventId: "e1",
      summary: "Board call",
      startsAt: "2026-09-01T09:00:00.000Z",
      endsAt: "2026-09-01T10:00:00.000Z",
      isAllDay: false,
    });
  });

  it("marks a date-valued event as all-day", () => {
    const e = normalizeEvent({ id: "e2", start: { date: "2026-09-01" }, end: { date: "2026-09-02" } });
    expect(e).toMatchObject({ isAllDay: true, startsAt: "2026-09-01T00:00:00.000Z" });
  });

  // Drawing an event at the wrong hour is worse than not drawing it.
  it("refuses an event it cannot place in time", () => {
    expect(normalizeEvent({ id: "e3" })).toBeNull();
    expect(normalizeEvent({ id: "e4", start: { dateTime: "nonsense" }, end: { dateTime: "2026-09-01T10:00:00Z" } })).toBeNull();
    expect(normalizeEvent({ id: "e5", start: { date: "01/09/2026" }, end: { date: "2026-09-02" } })).toBeNull();
  });

  it("refuses an event with no id", () => {
    expect(normalizeEvent({ id: "", start: { dateTime: "2026-09-01T09:00:00Z" }, end: { dateTime: "2026-09-01T10:00:00Z" } })).toBeNull();
  });

  it("drops zero-length and inverted events", () => {
    expect(normalizeEvent({ ...timed, end: { dateTime: "2026-09-01T09:00:00Z" } })).toBeNull();
    expect(normalizeEvent({ ...timed, end: { dateTime: "2026-09-01T08:00:00Z" } })).toBeNull();
  });

  it("carries the iCal UID, which is how a pushed meeting is recognized coming back", () => {
    expect(normalizeEvent({ ...timed, iCalUID: "meeting-abc@fundexecs" })?.icalUid).toBe("meeting-abc@fundexecs");
  });
});

describe("isTombstone", () => {
  // Incremental sync delivers deletions as events carrying status: cancelled.
  // Storing one is how a cancelled meeting lives on someone's calendar forever.
  it("recognizes a cancellation", () => {
    expect(isTombstone({ id: "e1", status: "cancelled" })).toBe(true);
  });

  it("leaves live events alone", () => {
    expect(isTombstone({ id: "e1", status: "confirmed" })).toBe(false);
    expect(isTombstone({ id: "e1" })).toBe(false);
  });
});

describe("blocksTime", () => {
  it("treats an ordinary event as busy", () => {
    expect(blocksTime({ transparency: null, status: "confirmed" })).toBe(true);
    expect(blocksTime({ transparency: "opaque", status: "confirmed" })).toBe(true);
  });

  // Google's "show me as free": visible on the grid, not a conflict.
  it("does not let a transparent event block a slot", () => {
    expect(blocksTime({ transparency: "transparent", status: "confirmed" })).toBe(false);
  });

  it("does not let a cancelled event block a slot", () => {
    expect(blocksTime({ transparency: "opaque", status: "cancelled" })).toBe(false);
  });
});

describe("decideSyncMode", () => {
  it("syncs in full when there is no cursor yet", () => {
    expect(decideSyncMode(null)).toEqual({ kind: "full", reason: "no_token" });
  });

  it("syncs incrementally when a cursor is held", () => {
    expect(decideSyncMode("tok123")).toEqual({ kind: "incremental", syncToken: "tok123" });
  });

  // A 410 from Google is routine, not an error: it means the delta can no
  // longer be expressed, so drop the cursor and start over.
  it("falls back to a full sync when the cursor has aged out", () => {
    expect(decideSyncMode("tok123", true)).toEqual({ kind: "full", reason: "token_expired" });
  });
});

describe("syncWindow", () => {
  it("spans from recent history to a year ahead", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const w = syncWindow(now);
    expect(new Date(w.timeMin).getTime()).toBeLessThan(now.getTime());
    expect(new Date(w.timeMax).getTime()).toBeGreaterThan(now.getTime());
    const days = (new Date(w.timeMax).getTime() - new Date(w.timeMin).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(425);
  });
});

describe("connectionHealth", () => {
  const recent = () => new Date(Date.now() - 60_000).toISOString();

  it("is quiet when a connection synced recently", () => {
    expect(connectionHealth({ lastSyncAt: recent(), lastError: null, consecutiveFailures: 0 })).toEqual({
      state: "ok",
      message: null,
    });
  });

  it("says a new connection is waiting rather than broken", () => {
    expect(connectionHealth({ lastSyncAt: null, lastError: null, consecutiveFailures: 0 }).state).toBe("never_synced");
  });

  it("flags a connection that has not synced in six hours", () => {
    const h = connectionHealth({
      lastSyncAt: new Date(Date.now() - 7 * 3_600_000).toISOString(),
      lastError: null,
      consecutiveFailures: 0,
    });
    expect(h.state).toBe("stale");
  });

  it("calls a connection failing once it passes the threshold", () => {
    const h = connectionHealth({
      lastSyncAt: recent(),
      lastError: "Google Calendar is having trouble.",
      consecutiveFailures: CONNECTION_FAILURE_ALERT_THRESHOLD,
    });
    expect(h.state).toBe("failing");
  });

  // Telling someone to wait when Google has revoked their token wastes their
  // day: a revoked grant needs a reconnect, and nothing else will fix it.
  it("distinguishes a revoked grant from a run of failures", () => {
    const h = connectionHealth({
      lastSyncAt: recent(),
      lastError: "invalid_grant: Google rejected the credentials.",
      consecutiveFailures: 1,
    });
    expect(h.state).toBe("reauth_required");
    expect(h.message).toMatch(/Reconnect/);
  });

  it("reports reauth even when failures have also piled up", () => {
    const h = connectionHealth({
      lastSyncAt: recent(),
      lastError: "invalid_grant",
      consecutiveFailures: 99,
    });
    expect(h.state).toBe("reauth_required");
  });
});

describe("describeGoogleError", () => {
  it("keeps a machine-readable marker that connectionHealth can match on", () => {
    expect(describeGoogleError(401, "")).toMatch(/invalid_grant/);
    expect(connectionHealth({ lastSyncAt: null, lastError: describeGoogleError(401, ""), consecutiveFailures: 0 }).state)
      .toBe("reauth_required");
  });

  it("marks an aged-out cursor so the caller resyncs in full", () => {
    expect(describeGoogleError(410, "")).toMatch(/token_expired/);
  });

  it("separates rate limiting from a plain refusal", () => {
    expect(describeGoogleError(403, '{"reason":"rateLimitExceeded"}')).toMatch(/rate-limiting/);
    expect(describeGoogleError(403, '{"reason":"forbidden"}')).toMatch(/scope/);
  });

  it("says something usable for anything else", () => {
    expect(describeGoogleError(503, "")).toMatch(/having trouble/);
    expect(describeGoogleError(418, "")).toMatch(/418/);
  });
});
