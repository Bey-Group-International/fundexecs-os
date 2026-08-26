import {
  FUNDEXECS_MARKER_KEY,
  attendeesFor,
  buildDescription,
  clampDuration,
  decideWrite,
  isLegacyStubId,
  mapVisibility,
  markerMeetingId,
  normalizeAttendeeEmail,
  outcomeForStatus,
  toGoogleEvent,
  type WritableMeeting,
} from "./google-write";

function meeting(over: Partial<WritableMeeting> = {}): WritableMeeting {
  return {
    id: "mtg-1",
    title: "Q3 LP update",
    description: null,
    location: null,
    meeting_url: null,
    objective: null,
    agenda: null,
    scheduled_at: "2026-09-01T15:00:00.000Z",
    duration_minutes: 45,
    timezone: "America/New_York",
    calendar_visibility: null,
    reminder_minutes: null,
    attendees: null,
    is_draft: false,
    locked_at: "2026-08-26T10:00:00.000Z",
    deleted_at: null,
    external_calendar_event_id: null,
    external_calendar_sync_enabled: true,
    external_calendar_provider: "google",
    ...over,
  };
}

describe("decideWrite", () => {
  it("creates when there is no event yet", () => {
    expect(decideWrite(meeting(), { connected: true })).toEqual({ kind: "create" });
  });

  it("updates when Google already has one", () => {
    expect(decideWrite(meeting({ external_calendar_event_id: "gcal123" }), { connected: true })).toEqual({
      kind: "update",
      eventId: "gcal123",
    });
  });

  it("treats a legacy stub id as no event at all", () => {
    // Earlier builds minted `ext_<uuid>` and marked the meeting synced without
    // calling anything. PATCHing that id would 404 forever.
    const d = decideWrite(meeting({ external_calendar_event_id: "ext_2f0c9a1e-dead-beef" }), { connected: true });
    expect(d).toEqual({ kind: "create" });
  });

  it("deletes the event when sync is switched off", () => {
    const d = decideWrite(
      meeting({ external_calendar_event_id: "gcal123", external_calendar_sync_enabled: false }),
      { connected: true },
    );
    expect(d).toEqual({ kind: "delete", eventId: "gcal123" });
  });

  it("deletes the event when the meeting is deleted", () => {
    const d = decideWrite(
      meeting({ external_calendar_event_id: "gcal123", deleted_at: "2026-08-26T12:00:00.000Z" }),
      { connected: true },
    );
    expect(d).toEqual({ kind: "delete", eventId: "gcal123" });
  });

  it("leaves nothing behind when a synced meeting loses its time", () => {
    const d = decideWrite(meeting({ external_calendar_event_id: "gcal123", scheduled_at: null }), { connected: true });
    expect(d).toEqual({ kind: "delete", eventId: "gcal123" });
  });

  it("does not try to delete a stub id, which was never on Google", () => {
    const d = decideWrite(
      meeting({ external_calendar_event_id: "ext_abc", external_calendar_sync_enabled: false }),
      { connected: true },
    );
    expect(d.kind).toBe("skip");
  });

  it("refuses a draft, which nobody has committed to yet", () => {
    const d = decideWrite(meeting({ is_draft: true }), { connected: true });
    expect(d).toEqual({ kind: "skip", reason: "Draft meetings are not pushed." });
  });

  it("refuses an unscheduled meeting", () => {
    expect(decideWrite(meeting({ scheduled_at: null }), { connected: true }).kind).toBe("skip");
  });

  it("refuses when nothing is connected, and says so", () => {
    const d = decideWrite(meeting(), { connected: false });
    expect(d).toEqual({ kind: "skip", reason: "No Google calendar is connected." });
  });

  it("gives a distinct reason for sync being off", () => {
    const d = decideWrite(meeting({ external_calendar_sync_enabled: false }), { connected: true });
    expect(d).toEqual({ kind: "skip", reason: "Sync is off for this meeting." });
  });
});

describe("isLegacyStubId", () => {
  it("recognises the old placeholder ids", () => {
    expect(isLegacyStubId("ext_9d1f")).toBe(true);
  });

  it("leaves real Google ids alone", () => {
    expect(isLegacyStubId("abc123def")).toBe(false);
    expect(isLegacyStubId(null)).toBe(false);
    expect(isLegacyStubId(undefined)).toBe(false);
  });
});

describe("normalizeAttendeeEmail", () => {
  it("accepts and lowercases a real address", () => {
    expect(normalizeAttendeeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeAttendeeEmail("a.b+tag@sub.example.co.uk")).toBe("a.b+tag@sub.example.co.uk");
  });

  it("rejects anything Google would choke on", () => {
    expect(normalizeAttendeeEmail("")).toBeNull();
    expect(normalizeAttendeeEmail(null)).toBeNull();
    expect(normalizeAttendeeEmail("not-an-email")).toBeNull();
    expect(normalizeAttendeeEmail("no@host")).toBeNull();
    expect(normalizeAttendeeEmail("two@@example.com")).toBeNull();
    expect(normalizeAttendeeEmail("has space@example.com")).toBeNull();
  });
});

describe("attendeesFor", () => {
  it("keeps names alongside addresses", () => {
    const g = attendeesFor(meeting({ attendees: [{ name: "Ada", email: "ada@example.com" }] }));
    expect(g).toEqual([{ email: "ada@example.com", displayName: "Ada" }]);
  });

  it("drops the ones with no usable address rather than failing the whole event", () => {
    const g = attendeesFor(
      meeting({ attendees: [{ name: "Ada", email: "ada@example.com" }, { name: "No Email" }, { email: "junk" }] }),
    );
    expect(g).toEqual([{ email: "ada@example.com", displayName: "Ada" }]);
  });

  it("deduplicates the same person listed twice", () => {
    const g = attendeesFor(
      meeting({ attendees: [{ email: "ada@example.com" }, { email: "ADA@example.com", name: "Ada" }] }),
    );
    expect(g).toHaveLength(1);
  });

  it("copes with no attendees at all", () => {
    expect(attendeesFor(meeting({ attendees: null }))).toEqual([]);
  });
});

describe("toGoogleEvent", () => {
  it("sets start and end from the scheduled time and duration", () => {
    const e = toGoogleEvent(meeting());
    expect(e.start.dateTime).toBe("2026-09-01T15:00:00.000Z");
    expect(e.end.dateTime).toBe("2026-09-01T15:45:00.000Z");
  });

  it("carries the meeting's timezone", () => {
    expect(toGoogleEvent(meeting()).start.timeZone).toBe("America/New_York");
  });

  it("omits the timezone rather than inventing one", () => {
    expect(toGoogleEvent(meeting({ timezone: null })).start.timeZone).toBeUndefined();
  });

  it("always carries the marker that stops the read sync echoing it back", () => {
    const e = toGoogleEvent(meeting());
    expect(e.extendedProperties.private[FUNDEXECS_MARKER_KEY]).toBe("mtg-1");
  });

  it("falls back to a title rather than sending an empty summary", () => {
    expect(toGoogleEvent(meeting({ title: null })).summary).toBe("Meeting");
    expect(toGoogleEvent(meeting({ title: "   " })).summary).toBe("Meeting");
  });

  it("uses the join link as the location when there is no other one", () => {
    const e = toGoogleEvent(meeting({ meeting_url: "https://app.test/meeting-invite/abc" }));
    expect(e.location).toBe("https://app.test/meeting-invite/abc");
  });

  it("prefers a real location over the join link", () => {
    const e = toGoogleEvent(meeting({ location: "Room 4", meeting_url: "https://app.test/x" }));
    expect(e.location).toBe("Room 4");
  });

  it("turns a reminder into an override", () => {
    const e = toGoogleEvent(meeting({ reminder_minutes: 15 }));
    expect(e.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 15 }] });
  });

  it("hands a removed reminder back to Google's defaults, explicitly", () => {
    // Omitting `reminders` on a patch would keep the old override forever.
    expect(toGoogleEvent(meeting({ reminder_minutes: null })).reminders).toEqual({ useDefault: true });
    expect(toGoogleEvent(meeting({ reminder_minutes: 0 })).reminders).toEqual({ useDefault: true });
  });

  it("refuses to build an event with nowhere to be", () => {
    expect(() => toGoogleEvent(meeting({ scheduled_at: null }))).toThrow(/unscheduled/);
    expect(() => toGoogleEvent(meeting({ scheduled_at: "nonsense" }))).toThrow(/invalid start/);
  });

  it("never produces an end at or before its start", () => {
    const e = toGoogleEvent(meeting({ duration_minutes: 0 }));
    expect(new Date(e.end.dateTime).getTime()).toBeGreaterThan(new Date(e.start.dateTime).getTime());
  });
});

describe("clampDuration", () => {
  it("keeps a sensible duration", () => {
    expect(clampDuration(45)).toBe(45);
  });

  it("defaults rather than sending nothing", () => {
    expect(clampDuration(null)).toBe(60);
    expect(clampDuration(undefined)).toBe(60);
    expect(clampDuration(0)).toBe(60);
    expect(clampDuration(-30)).toBe(60);
    expect(clampDuration(NaN)).toBe(60);
  });

  it("caps at eight hours, matching the meetings API", () => {
    expect(clampDuration(100000)).toBe(480);
  });
});

describe("mapVisibility", () => {
  it("maps the values we store", () => {
    expect(mapVisibility("public")).toBe("public");
    expect(mapVisibility("private")).toBe("private");
    expect(mapVisibility("confidential")).toBe("private");
  });

  it("says nothing for default or unknown, leaving Google's own default", () => {
    expect(mapVisibility("default")).toBeNull();
    expect(mapVisibility(null)).toBeNull();
    expect(mapVisibility("")).toBeNull();
    expect(mapVisibility("something-else")).toBeNull();
  });
});

describe("buildDescription", () => {
  it("is empty when there is nothing to say", () => {
    expect(buildDescription(meeting(), null)).toBe("");
  });

  it("assembles the parts that live in separate columns", () => {
    const d = buildDescription(
      meeting({ description: "Quarterly review", objective: "Agree the raise", agenda: "1. Numbers" }),
      "https://app.test/join",
    );
    expect(d).toContain("Quarterly review");
    expect(d).toContain("Objective:\nAgree the raise");
    expect(d).toContain("Agenda:\n1. Numbers");
    expect(d).toContain("Join: https://app.test/join");
  });

  it("skips empty sections rather than printing bare labels", () => {
    const d = buildDescription(meeting({ objective: "   ", agenda: null, description: "Only this" }), null);
    expect(d).toBe("Only this");
  });
});

describe("markerMeetingId", () => {
  it("finds our own event", () => {
    expect(markerMeetingId({ extendedProperties: { private: { [FUNDEXECS_MARKER_KEY]: "mtg-1" } } })).toBe("mtg-1");
  });

  it("is null for somebody else's event", () => {
    expect(markerMeetingId({})).toBeNull();
    expect(markerMeetingId({ extendedProperties: {} })).toBeNull();
    expect(markerMeetingId({ extendedProperties: { private: {} } })).toBeNull();
    expect(markerMeetingId({ extendedProperties: { private: { [FUNDEXECS_MARKER_KEY]: "  " } } })).toBeNull();
  });
});

describe("outcomeForStatus", () => {
  it("treats 2xx as synced", () => {
    expect(outcomeForStatus(200)).toEqual({ outcome: "synced", forgetEventId: false, retryable: false });
    expect(outcomeForStatus(204).outcome).toBe("synced");
  });

  it("forgets the id when Google no longer has the event", () => {
    // Someone deleted it in Google. Not an error worth alarming about — write a
    // fresh one next time instead of PATCHing something that is gone.
    for (const status of [404, 410]) {
      const r = outcomeForStatus(status);
      expect(r.forgetEventId).toBe(true);
      expect(r.outcome).toBe("sync_pending");
      expect(r.retryable).toBe(true);
    }
  });

  it("treats an auth problem as a real failure needing attention", () => {
    expect(outcomeForStatus(401).outcome).toBe("sync_failed");
    expect(outcomeForStatus(403).outcome).toBe("sync_failed");
    expect(outcomeForStatus(401).retryable).toBe(false);
  });

  it("treats rate limits and server errors as worth retrying", () => {
    expect(outcomeForStatus(429).retryable).toBe(true);
    expect(outcomeForStatus(500).retryable).toBe(true);
    expect(outcomeForStatus(503).outcome).toBe("sync_pending");
  });

  it("treats a bad request as ours to fix, not to retry", () => {
    expect(outcomeForStatus(400)).toEqual({ outcome: "sync_failed", forgetEventId: false, retryable: false });
  });
});

describe("toGoogleEvent — clearing fields over PATCH", () => {
  // Google's events.patch leaves omitted fields untouched, so an emptied field
  // must be sent as its empty value or the old one survives on the calendar.
  it("states every optional field, even when the meeting has nothing for it", () => {
    const e = toGoogleEvent(meeting({
      attendees: null,
      description: null,
      objective: null,
      agenda: null,
      location: null,
      meeting_url: null,
      calendar_visibility: null,
      reminder_minutes: null,
    }));

    expect(e.attendees).toEqual([]);
    expect(e.description).toBe("");
    expect(e.location).toBe("");
    expect(e.visibility).toBe("default");
    expect(e.reminders).toEqual({ useDefault: true });
  });

  it("clears the guest list when the last attendee is removed", () => {
    // Not merely absent: an omitted attendees array leaves everyone invited.
    const e = toGoogleEvent(meeting({ attendees: [] }));
    expect(e.attendees).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(e, "attendees")).toBe(true);
  });

  it("clears a guest list that held only unusable addresses", () => {
    const e = toGoogleEvent(meeting({ attendees: [{ name: "No Email" }, { email: "junk" }] }));
    expect(e.attendees).toEqual([]);
  });

  it("returns visibility to default rather than leaving it private", () => {
    expect(toGoogleEvent(meeting({ calendar_visibility: "default" })).visibility).toBe("default");
    expect(toGoogleEvent(meeting({ calendar_visibility: "private" })).visibility).toBe("private");
  });
});
