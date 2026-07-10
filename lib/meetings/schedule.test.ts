import {
  validateMeetingDraft,
  isValidDraft,
  durationMinutesFromTimes,
  localToIso,
  deriveMeetingStatus,
  wasEditedAfterSave,
  findConflicts,
  nextExternalSyncStatus,
  meetingTimeState,
} from "./schedule";

describe("validateMeetingDraft", () => {
  const valid = {
    title: "Q3 LP Review",
    meetingType: "lp_review",
    date: "2026-07-10",
    startTime: "10:00",
    endTime: "11:00",
    timezone: "America/New_York",
  };

  it("passes a complete draft", () => {
    expect(validateMeetingDraft(valid)).toEqual({});
    expect(isValidDraft(valid)).toBe(true);
  });

  it("flags every missing required field", () => {
    const errors = validateMeetingDraft({});
    expect(Object.keys(errors).sort()).toEqual(
      ["date", "endTime", "meetingType", "startTime", "timezone", "title"].sort(),
    );
  });

  it("rejects end time before or equal to start time", () => {
    expect(validateMeetingDraft({ ...valid, endTime: "10:00" }).endTime).toBeDefined();
    expect(validateMeetingDraft({ ...valid, endTime: "09:30" }).endTime).toBeDefined();
  });

  it("rejects malformed date and time", () => {
    expect(validateMeetingDraft({ ...valid, date: "07/10/2026" }).date).toBeDefined();
    expect(validateMeetingDraft({ ...valid, startTime: "9am" }).startTime).toBeDefined();
  });
});

describe("time helpers", () => {
  it("computes duration between HH:mm times", () => {
    expect(durationMinutesFromTimes("10:00", "11:30")).toBe(90);
    expect(durationMinutesFromTimes("09:15", "10:00")).toBe(45);
  });

  it("converts local wall-clock to a UTC instant using the zone offset", () => {
    // 10:00 in New York (EDT, -04:00 in July) is 14:00 UTC.
    expect(localToIso("2026-07-10", "10:00", "America/New_York")).toBe("2026-07-10T14:00:00.000Z");
    // 10:00 UTC stays 10:00 UTC.
    expect(localToIso("2026-07-10", "10:00", "UTC")).toBe("2026-07-10T10:00:00.000Z");
  });
});

describe("deriveMeetingStatus", () => {
  const now = new Date("2026-07-10T09:00:00.000Z").getTime();
  const base = { scheduled_at: "2026-07-10T10:00:00.000Z", duration_minutes: 60 };

  it("returns Live for an active room", () => {
    expect(deriveMeetingStatus({ ...base, status: "active" }, now)).toBe("Live");
  });

  it("returns Completed for an ended room", () => {
    expect(deriveMeetingStatus({ ...base, status: "ended" }, now)).toBe("Completed");
  });

  it("returns Follow-Up Needed when follow-up is open after end", () => {
    expect(deriveMeetingStatus({ ...base, status: "ended", followup_status: "draft" }, now)).toBe("Follow-Up Needed");
  });

  it("returns Prep Needed / Ready from preparation status", () => {
    expect(deriveMeetingStatus({ ...base, status: "waiting", preparation_status: "prep_needed" }, now)).toBe("Prep Needed");
    expect(deriveMeetingStatus({ ...base, status: "waiting", preparation_status: "ready" }, now)).toBe("Ready");
  });

  it("returns Updated after a deliberate edit", () => {
    expect(
      deriveMeetingStatus(
        { ...base, status: "waiting", locked_at: "2026-07-09T10:00:00.000Z", updated_at: "2026-07-09T12:00:00.000Z" },
        now,
      ),
    ).toBe("Updated");
  });

  it("treats a passed end time as Completed even if the room never ended", () => {
    const later = new Date("2026-07-10T12:00:00.000Z").getTime();
    expect(deriveMeetingStatus({ ...base, status: "waiting" }, later)).toBe("Completed");
  });
});

describe("wasEditedAfterSave", () => {
  it("is false without both timestamps", () => {
    expect(wasEditedAfterSave({ locked_at: "2026-07-09T10:00:00.000Z" })).toBe(false);
  });
  it("is true when updated well after locked", () => {
    expect(
      wasEditedAfterSave({ locked_at: "2026-07-09T10:00:00.000Z", updated_at: "2026-07-09T11:00:00.000Z" }),
    ).toBe(true);
  });
});

describe("meetingTimeState", () => {
  const start = "2026-07-10T10:00:00.000Z";

  it("returns null without a scheduled time", () => {
    expect(meetingTimeState(null, 60)).toBeNull();
  });

  it("counts down while upcoming", () => {
    const now = new Date("2026-07-10T09:48:00.000Z").getTime();
    const state = meetingTimeState(start, 60, now)!;
    expect(state.phase).toBe("upcoming");
    expect(state.label).toBe("in 12 mins");
    expect(state.minutesToStart).toBe(12);
  });

  it("flips to imminent within the last two minutes", () => {
    const now = new Date("2026-07-10T09:59:00.000Z").getTime();
    expect(meetingTimeState(start, 60, now)!.phase).toBe("imminent");
    expect(meetingTimeState(start, 60, now)!.label).toBe("Starts now");
  });

  it("reports time left while in progress", () => {
    const now = new Date("2026-07-10T10:36:00.000Z").getTime();
    const state = meetingTimeState(start, 60, now)!;
    expect(state.phase).toBe("in_progress");
    expect(state.label).toBe("24 mins left");
  });

  it("is ended once the window has passed", () => {
    const now = new Date("2026-07-10T11:30:00.000Z").getTime();
    expect(meetingTimeState(start, 60, now)!.phase).toBe("ended");
  });

  it("humanizes hours and days for distant meetings", () => {
    expect(meetingTimeState(start, 60, new Date("2026-07-10T07:00:00.000Z").getTime())!.label).toBe("in 3 hrs");
    expect(meetingTimeState(start, 60, new Date("2026-07-08T10:00:00.000Z").getTime())!.label).toBe("in 2 days");
  });
});

describe("findConflicts", () => {
  const candidates = [
    { id: "a", title: "Standup", scheduled_at: "2026-07-10T10:00:00.000Z", duration_minutes: 30 },
    { id: "b", title: "Board", scheduled_at: "2026-07-10T11:00:00.000Z", duration_minutes: 60 },
  ];

  it("detects overlapping meetings", () => {
    const conflicts = findConflicts(candidates, "2026-07-10T10:15:00.000Z", "2026-07-10T10:45:00.000Z");
    expect(conflicts.map((c) => c.id)).toEqual(["a"]);
  });

  it("excludes the meeting being edited", () => {
    const conflicts = findConflicts(candidates, "2026-07-10T10:00:00.000Z", "2026-07-10T10:30:00.000Z", "a");
    expect(conflicts).toEqual([]);
  });

  it("returns nothing for a non-overlapping slot", () => {
    expect(findConflicts(candidates, "2026-07-10T09:00:00.000Z", "2026-07-10T09:30:00.000Z")).toEqual([]);
  });
});

describe("findConflicts — scoped to shared participants", () => {
  const base = { scheduled_at: "2026-07-10T10:00:00.000Z", duration_minutes: 60 };
  const overlap = ["2026-07-10T10:15:00.000Z", "2026-07-10T10:45:00.000Z"] as const;

  it("ignores an overlap when no participant is shared", () => {
    const candidates = [{ id: "a", ...base, host_id: "host-x", attendees: [{ email: "x@y.z" }] }];
    expect(
      findConflicts(candidates, overlap[0], overlap[1], { subjectHostId: "host-me", subjectEmails: ["me@fund.com"] }),
    ).toEqual([]);
  });

  it("flags an overlap when the host is shared", () => {
    const candidates = [{ id: "a", title: "Other", ...base, host_id: "host-me", attendees: [] }];
    expect(
      findConflicts(candidates, overlap[0], overlap[1], { subjectHostId: "host-me" }).map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("flags an overlap when an attendee email is shared (case-insensitive)", () => {
    const candidates = [{ id: "a", ...base, host_id: "host-x", attendees: [{ email: "Shared@Fund.com" }] }];
    expect(
      findConflicts(candidates, overlap[0], overlap[1], { subjectHostId: "host-me", subjectEmails: ["shared@fund.com"] }).map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("matches the scheduler as a guest on another meeting via their email", () => {
    const candidates = [{ id: "a", ...base, host_id: "host-x", attendees: [{ email: "me@fund.com" }] }];
    expect(
      findConflicts(candidates, overlap[0], overlap[1], { subjectHostId: "host-me", subjectEmails: ["me@fund.com"] }).map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("still ignores non-overlapping meetings even when a person is shared", () => {
    const candidates = [{ id: "a", ...base, host_id: "host-me" }];
    expect(
      findConflicts(candidates, "2026-07-10T09:00:00.000Z", "2026-07-10T09:30:00.000Z", { subjectHostId: "host-me" }),
    ).toEqual([]);
  });
});

describe("nextExternalSyncStatus", () => {
  it("is not_connected without a provider", () => {
    expect(
      nextExternalSyncStatus({ enabled: true, providerConnected: false, isEdit: false, timingOrAttendeesChanged: false }),
    ).toBe("not_connected");
  });

  it("is sync_off when connected but disabled", () => {
    expect(
      nextExternalSyncStatus({ enabled: false, providerConnected: true, isEdit: false, timingOrAttendeesChanged: false }),
    ).toBe("sync_off");
  });

  it("is sync_pending on first save with sync enabled", () => {
    expect(
      nextExternalSyncStatus({ enabled: true, providerConnected: true, isEdit: false, timingOrAttendeesChanged: false }),
    ).toBe("sync_pending");
  });

  it("becomes needs_resync when a synced meeting changes timing", () => {
    expect(
      nextExternalSyncStatus({
        enabled: true,
        providerConnected: true,
        currentStatus: "synced",
        isEdit: true,
        timingOrAttendeesChanged: true,
      }),
    ).toBe("needs_resync");
  });

  it("stays synced when a synced meeting is edited without timing change", () => {
    expect(
      nextExternalSyncStatus({
        enabled: true,
        providerConnected: true,
        currentStatus: "synced",
        isEdit: true,
        timingOrAttendeesChanged: false,
      }),
    ).toBe("synced");
  });
});
