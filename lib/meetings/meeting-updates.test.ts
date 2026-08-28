const sendEmailMock = jest.fn();

jest.mock("@/lib/email", () => ({
  ...jest.requireActual("@/lib/email"),
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  escapeHtml: (v: string) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
}));

import {
  buildMeetingUpdateEmail,
  diffMeetingTiming,
  sendMeetingUpdates,
  updateInviteMethod,
} from "./meeting-updates";

const CTX = {
  origin: "https://app.test",
  roomCode: "abc",
  title: "Quarterly review",
  senderName: "nia@fund.test",
  emails: ["ada@lp.test", "ben@lp.test"],
  timezone: "America/New_York",
  startIso: "2026-07-11T15:00:00.000Z",
  previousStartIso: "2026-07-10T14:00:00.000Z",
  durationMinutes: 45,
};

beforeEach(() => {
  jest.clearAllMocks();
  sendEmailMock.mockResolvedValue({ ok: true, channel: "resend", detail: "sent" });
});

describe("diffMeetingTiming", () => {
  it("reports a move to a different instant", () => {
    const d = diffMeetingTiming(
      { startIso: "2026-07-10T10:00:00.000Z", durationMinutes: 60 },
      { startIso: "2026-07-11T10:00:00.000Z", durationMinutes: 60 },
    );
    expect(d).toEqual({ startChanged: true, durationChanged: false, changed: true });
  });

  it("does not report the same instant written a different way", () => {
    const d = diffMeetingTiming(
      { startIso: "2026-07-10T10:00:00.000Z", durationMinutes: 60 },
      { startIso: "2026-07-10T06:00:00.000-04:00", durationMinutes: 60 },
    );
    expect(d.changed).toBe(false);
  });

  it("reports a length change on its own", () => {
    const d = diffMeetingTiming(
      { startIso: "2026-07-10T10:00:00.000Z", durationMinutes: 60 },
      { startIso: "2026-07-10T10:00:00.000Z", durationMinutes: 30 },
    );
    expect(d).toEqual({ startChanged: false, durationChanged: true, changed: true });
  });

  it("reports nothing when neither field moved", () => {
    const same = { startIso: "2026-07-10T10:00:00.000Z", durationMinutes: 60 };
    expect(diffMeetingTiming(same, { ...same }).changed).toBe(false);
  });

  it("falls back to an exact match rather than crying reschedule on junk input", () => {
    expect(diffMeetingTiming({ startIso: "soon", durationMinutes: 60 }, { startIso: "soon", durationMinutes: 60 }).changed).toBe(
      false,
    );
    expect(diffMeetingTiming({ startIso: "soon", durationMinutes: 60 }, { startIso: "later", durationMinutes: 60 }).changed).toBe(
      true,
    );
  });

  it("treats a meeting gaining or losing a time as a change", () => {
    expect(diffMeetingTiming({ startIso: null, durationMinutes: null }, { startIso: "2026-07-10T10:00:00.000Z", durationMinutes: 60 }).changed).toBe(true);
    expect(diffMeetingTiming({ startIso: "2026-07-10T10:00:00.000Z", durationMinutes: 60 }, { startIso: null, durationMinutes: 60 }).changed).toBe(true);
  });
});

describe("buildMeetingUpdateEmail", () => {
  it("shows the reschedule as a move, old time and new", () => {
    const { subject, html } = buildMeetingUpdateEmail("rescheduled", CTX);
    expect(subject).toContain("Quarterly review");
    expect(html).toContain("This meeting moved");
    expect(html).toContain("New time");
    expect(html).toContain("Previously");
    // Rendered in the meeting's own timezone, not UTC.
    expect(html).toContain("July 11, 2026");
    expect(html).toContain("11:00");
    expect(html).toContain("https://app.test/meeting-invite/abc");
  });

  it("names the cancellation and its reason without offering a join link", () => {
    const { subject, html } = buildMeetingUpdateEmail("cancelled", { ...CTX, reason: "Deal closed early" });
    expect(subject).toBe("Cancelled: Quarterly review");
    expect(html).toContain("This meeting was cancelled");
    expect(html).toContain("Deal closed early");
    expect(html).not.toContain("Join meeting");
  });

  it("tells a dropped guest the meeting goes on without them", () => {
    const { subject, html } = buildMeetingUpdateEmail("removed", CTX);
    expect(subject).toBe("Removed: Quarterly review");
    expect(html).toContain("You were taken off this meeting");
    expect(html).not.toContain("Join meeting");
  });

  it("escapes a title that carries markup", () => {
    const { html } = buildMeetingUpdateEmail("cancelled", { ...CTX, title: "<script>x</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("sendMeetingUpdates", () => {
  it("mails each unique recipient once", async () => {
    const res = await sendMeetingUpdates("rescheduled", {
      ...CTX,
      emails: ["ada@lp.test", "ADA@lp.test ", "ben@lp.test"],
    });
    expect(res).toEqual({ sent: 2, total: 2 });
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it("sends nothing when there is nobody to tell", async () => {
    expect(await sendMeetingUpdates("cancelled", { ...CTX, emails: [] })).toEqual({ sent: 0, total: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("survives a provider failure instead of failing the edit", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("provider down"));
    const res = await sendMeetingUpdates("rescheduled", CTX);
    expect(res).toEqual({ sent: 1, total: 2 });
  });

  it("counts a provider that reports a refusal as unsent", async () => {
    sendEmailMock.mockResolvedValue({ ok: false, channel: "in-app", detail: "no provider" });
    expect(await sendMeetingUpdates("cancelled", CTX)).toEqual({ sent: 0, total: 2 });
  });
});

describe("updateInviteMethod", () => {
  it("moves the entry on a reschedule and clears it otherwise", () => {
    // "The meeting is off" and "you are no longer on it" are the same
    // instruction to a calendar, and a stale entry is the worse failure either
    // way.
    expect(updateInviteMethod("rescheduled")).toBe("REQUEST");
    expect(updateInviteMethod("cancelled")).toBe("CANCEL");
    expect(updateInviteMethod("removed")).toBe("CANCEL");
  });
});

describe("sendMeetingUpdates — the calendar entry", () => {
  const CAL = {
    origin: "https://app.test",
    roomCode: "abc",
    title: "Quarterly review",
    senderName: "rae@fund.test",
    emails: ["ada@example.com"],
    timezone: "UTC",
    orgId: "org1",
    meetingId: "m1",
    hostEmail: "rae@fund.test",
    startIso: "2026-09-11T15:00:00.000Z",
    previousStartIso: "2026-09-10T15:00:00.000Z",
    durationMinutes: 30,
    sequence: 4,
  };

  const invite = () =>
    (sendEmailMock.mock.calls[0]?.[0] as { calendarInvite?: { content: string; method: string } })
      ?.calendarInvite;

  beforeEach(() => {
    jest.clearAllMocks();
    sendEmailMock.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent" });
  });

  it("moves the meeting rather than adding a second one", async () => {
    // Same UID as the invitation, at a higher SEQUENCE. A fresh UID would leave
    // the old time sitting in every calendar beside the new one.
    await sendMeetingUpdates("rescheduled", CAL);
    const ics = invite()!;
    expect(ics.method).toBe("REQUEST");
    expect(ics.content).toContain("UID:meeting-m1@app.test");
    expect(ics.content).toContain("SEQUENCE:4");
    expect(ics.content).toContain("DTSTART:20260911T150000Z");
  });

  it("clears the entry on a cancellation", async () => {
    await sendMeetingUpdates("cancelled", { ...CAL, startIso: null });
    const ics = invite()!;
    expect(ics.method).toBe("CANCEL");
    expect(ics.content).toContain("STATUS:CANCELLED");
    // Falls back to the old time so the client can match what it holds.
    expect(ics.content).toContain("DTSTART:20260910T150000Z");
  });

  it("still emails when the meeting has no calendar identity", async () => {
    await sendMeetingUpdates("rescheduled", { ...CAL, meetingId: null });
    expect(sendEmailMock).toHaveBeenCalled();
    expect(invite()).toBeUndefined();
  });
});
