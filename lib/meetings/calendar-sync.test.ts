import {
  SYNCABLE_PROVIDER,
  calendarSyncNote,
  isWritableProvider,
  planCalendarSync,
} from "@/lib/meetings/calendar-sync";

describe("planCalendarSync", () => {
  // The defect. Sync needed BOTH flags set from a checkbox inside collapsed
  // "Advanced options", default off — so scheduling a meeting the ordinary way
  // never attempted a push, and a host with a working Google connection watched
  // their meetings never arrive with nothing wrong anywhere.
  it("puts the meeting on a connected calendar without being asked", () => {
    expect(planCalendarSync({ connected: true, isDraft: false })).toEqual({
      enabled: true,
      provider: SYNCABLE_PROVIDER,
      push: true,
      reason: null,
    });
  });

  it("still respects an explicit no", () => {
    // Some meetings are deliberately kept off a shared calendar, and overriding
    // that would put them somewhere the host chose to exclude.
    expect(planCalendarSync({ connected: true, requested: false, isDraft: false })).toEqual({
      enabled: false,
      provider: null,
      push: false,
      reason: null,
    });
  });

  it("treats an explicit yes the same as the default", () => {
    const asked = planCalendarSync({ connected: true, requested: true, isDraft: false });
    expect(asked.push).toBe(true);
    expect(asked.enabled).toBe(true);
  });

  describe("with no calendar connected", () => {
    it("does not push, and says why", () => {
      const plan = planCalendarSync({ connected: false, isDraft: false });
      expect(plan.push).toBe(false);
      expect(plan.reason).toMatch(/no Google Calendar/i);
    });

    it("keeps an explicit yes on the row, so a later connection picks it up", () => {
      const plan = planCalendarSync({ connected: false, requested: true, isDraft: false });
      expect(plan.enabled).toBe(true);
      expect(plan.provider).toBe(SYNCABLE_PROVIDER);
      expect(plan.push).toBe(false);
    });

    it("does not enable what nobody asked for and nothing can do", () => {
      expect(planCalendarSync({ connected: false, isDraft: false }).enabled).toBe(false);
    });
  });

  describe("a draft", () => {
    // A draft has never been committed to, and pushing one puts a half-written
    // meeting on a real calendar.
    it("is never pushed", () => {
      expect(planCalendarSync({ connected: true, isDraft: true }).push).toBe(false);
      expect(planCalendarSync({ connected: true, requested: true, isDraft: true }).push).toBe(false);
    });

    it("still stores the intent, so it syncs once it is real", () => {
      expect(planCalendarSync({ connected: true, isDraft: true }).enabled).toBe(true);
    });

    it("says nothing: not being on a calendar yet is not a fault", () => {
      expect(planCalendarSync({ connected: false, isDraft: true }).reason).toBeNull();
    });
  });

  describe("when the connection cannot be checked", () => {
    // `canWriteCalendar` answers null rather than false on a failed lookup. The
    // difference matters: telling a host to connect a calendar they already
    // connected sends them to fix something that was never broken.
    it("does not push, and does not blame a missing connection", () => {
      const plan = planCalendarSync({ connected: null, isDraft: false });
      expect(plan.push).toBe(false);
      expect(plan.reason).toMatch(/Could not check/i);
      expect(plan.reason).not.toMatch(/no Google Calendar/i);
    });

    it("writes no claim onto the row", () => {
      // A flag written from a failed lookup would be obeyed by every later edit.
      const plan = planCalendarSync({ connected: null, isDraft: false });
      expect(plan.enabled).toBe(false);
      expect(plan.provider).toBeNull();
    });

    it("still honours an explicit no without complaint", () => {
      expect(planCalendarSync({ connected: null, requested: false, isDraft: false })).toEqual({
        enabled: false,
        provider: null,
        push: false,
        reason: null,
      });
    });
  });

  it("never names a provider it cannot write to", () => {
    for (const connected of [true, false, null]) {
      for (const requested of [true, false, undefined]) {
        for (const isDraft of [true, false]) {
          const plan = planCalendarSync({ connected, requested, isDraft });
          if (plan.provider !== null) expect(isWritableProvider(plan.provider)).toBe(true);
          // A push is impossible without both a connection and the flag that
          // `decideWrite` reads.
          if (plan.push) expect(connected === true && plan.enabled).toBe(true);
        }
      }
    }
  });
});

describe("isWritableProvider", () => {
  it("accepts the one provider that has a writer", () => {
    expect(isWritableProvider(SYNCABLE_PROVIDER)).toBe(true);
  });

  // The form offered Outlook, Calendly and iCal; pushMeetingToGoogle is the only
  // writer in the codebase, so picking one of those enabled a "sync" that wrote
  // to Google or skipped entirely.
  it("rejects the three the form used to offer", () => {
    expect(isWritableProvider("outlook")).toBe(false);
    expect(isWritableProvider("calendly")).toBe(false);
    expect(isWritableProvider("ical")).toBe(false);
    expect(isWritableProvider(null)).toBe(false);
    expect(isWritableProvider(undefined)).toBe(false);
  });
});

describe("calendarSyncNote", () => {
  it("says a meeting will be added when it will be", () => {
    expect(calendarSyncNote({ connected: true, optedOut: false })).toMatch(/will be added/i);
  });

  it("says it will be kept off when the host said so", () => {
    expect(calendarSyncNote({ connected: true, optedOut: true })).toMatch(/kept off/i);
  });

  // The form learns this over the network. Promising "will be added" before the
  // answer arrives is a claim that can turn out false a moment later.
  it("claims nothing while the answer is still unknown", () => {
    const note = calendarSyncNote({ connected: null, optedOut: false });
    expect(note).toMatch(/Checking/i);
    expect(note).not.toMatch(/will be added/i);
  });

  it("can still state an opt-out before the connection is known", () => {
    // That one does not depend on the connection: off is off either way.
    expect(calendarSyncNote({ connected: null, optedOut: true })).toMatch(/kept off/i);
  });

  // The old copy described the capability without saying whether it was
  // available, so ticking the box and leaving it alone both produced nothing.
  it("says there is no calendar rather than offering a toggle that cannot work", () => {
    const note = calendarSyncNote({ connected: false, optedOut: false });
    expect(note).toMatch(/No Google Calendar is connected/i);
    expect(note).toMatch(/will not appear/i);
  });
});
