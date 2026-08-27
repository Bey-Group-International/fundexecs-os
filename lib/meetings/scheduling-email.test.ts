// lib/meetings/scheduling-email.test.ts
// What matters here is which transitions carry a calendar invitation, and that
// the invite tracks the booking rather than creating a new entry each time.
const sendEmailMock = jest.fn();

// Only sendEmail is stubbed: the module also exports escapeHtml, which the
// templates use, and replacing the whole module would take that with it.
jest.mock("@/lib/email", () => ({
  ...jest.requireActual("@/lib/email"),
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { inviteMethodFor, sendBookingEmails, type BookingEmailContext } from "./scheduling-email";

function ctx(over: Partial<BookingEmailContext> = {}): BookingEmailContext {
  return {
    orgId: "org1",
    eventTitle: "Intro call",
    hostName: "Rae Bey",
    hostEmail: "rae@fund.test",
    inviteeName: "Ada Lovelace",
    inviteeEmail: "ada@example.com",
    inviteeTimezone: "America/New_York",
    hostTimezone: "America/New_York",
    startIso: "2026-09-10T15:00:00.000Z",
    endIso: "2026-09-10T15:30:00.000Z",
    durationMinutes: 30,
    joinUrl: "https://app.test/meeting-invite/abc",
    manageUrl: "https://app.test/b/tok",
    bookingId: "bk-1",
    bookingCreatedAt: "2026-09-01T12:00:00.000Z",
    bookingUpdatedAt: "2026-09-01T12:00:00.000Z",
    siteUrl: "https://app.test",
    ...over,
  };
}

/** Every calendar invite handed to the mailer. */
function invites(): Array<{ content: string; method: string }> {
  return sendEmailMock.mock.calls
    .map(([args]) => (args as { calendarInvite?: { content: string; method: string } }).calendarInvite)
    .filter(Boolean) as Array<{ content: string; method: string }>;
}

beforeEach(() => {
  jest.clearAllMocks();
  sendEmailMock.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent" });
});

describe("inviteMethodFor", () => {
  it("sends a request once the meeting is real", () => {
    expect(inviteMethodFor("confirmed")).toBe("REQUEST");
    expect(inviteMethodFor("rescheduled")).toBe("REQUEST");
    expect(inviteMethodFor("rescheduled_by_host")).toBe("REQUEST");
  });

  it("cancels when the meeting goes away", () => {
    expect(inviteMethodFor("declined")).toBe("CANCEL");
    expect(inviteMethodFor("cancelled_by_invitee")).toBe("CANCEL");
    expect(inviteMethodFor("cancelled_by_host")).toBe("CANCEL");
  });

  it("sends nothing for a request the host has not accepted", () => {
    // A pending request is not a meeting. Putting a hold in someone's calendar
    // that the host then declines is worse than sending nothing.
    expect(inviteMethodFor("requested")).toBeNull();
  });
});

describe("sendBookingEmails — the invitation", () => {
  it("attaches an invite to a confirmed booking", async () => {
    await sendBookingEmails("confirmed", ctx());
    const all = invites();
    expect(all.length).toBeGreaterThan(0);
    expect(all[0].method).toBe("REQUEST");
    expect(all[0].content).toContain("METHOD:REQUEST");
    expect(all[0].content).toContain("SUMMARY:Intro call with Rae Bey");
  });

  it("invites both sides, so the host's own calendar moves too", async () => {
    await sendBookingEmails("confirmed", ctx());
    const content = invites()[0].content;
    expect(content).toContain("MAILTO:ada@example.com");
    expect(content).toContain("MAILTO:rae@fund.test");
    expect(content).toContain("ORGANIZER;CN=\"Rae Bey\":MAILTO:rae@fund.test");
  });

  it("sends no invite for a booking still awaiting approval", async () => {
    await sendBookingEmails("requested", ctx());
    expect(sendEmailMock).toHaveBeenCalled();
    expect(invites()).toHaveLength(0);
  });

  it("reuses the UID on a reschedule, so the meeting moves rather than doubling", async () => {
    await sendBookingEmails("confirmed", ctx());
    const first = invites()[0].content;
    jest.clearAllMocks();
    sendEmailMock.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent" });

    await sendBookingEmails("rescheduled", ctx({
      startIso: "2026-09-11T15:00:00.000Z",
      endIso: "2026-09-11T15:30:00.000Z",
      bookingUpdatedAt: "2026-09-01T12:10:00.000Z",
    }));
    const second = invites()[0].content;

    const uid = (t: string) => t.split("\r\n").find((l) => l.startsWith("UID:"));
    const seq = (t: string) => Number(t.split("\r\n").find((l) => l.startsWith("SEQUENCE:"))!.split(":")[1]);

    expect(uid(second)).toBe(uid(first));
    expect(seq(second)).toBeGreaterThan(seq(first));
    expect(second).toContain("DTSTART:20260911T150000Z");
  });

  it("cancels rather than leaving a stale meeting behind", async () => {
    await sendBookingEmails("cancelled_by_host", ctx());
    const content = invites()[0].content;
    expect(content).toContain("METHOD:CANCEL");
    expect(content).toContain("STATUS:CANCELLED");
    expect(content).toContain("UID:booking-bk-1@app.test");
  });

  it("still emails when the booking identity is missing", async () => {
    // An older caller that has not been updated must degrade to what it did
    // before — an email with no invite — rather than failing to notify at all.
    await sendBookingEmails("confirmed", ctx({ bookingId: null }));
    expect(sendEmailMock).toHaveBeenCalled();
    expect(invites()).toHaveLength(0);
  });

  it("still emails when the host has no address to organize from", async () => {
    await sendBookingEmails("confirmed", ctx({ hostEmail: null }));
    expect(sendEmailMock).toHaveBeenCalled();
    expect(invites()).toHaveLength(0);
  });

  it("does not let a broken invite stop the email", async () => {
    // The recipient still needs to know the meeting changed.
    await sendBookingEmails("confirmed", ctx({ startIso: "nonsense" }));
    expect(sendEmailMock).toHaveBeenCalled();
    expect(invites()).toHaveLength(0);
  });

  it("reports how many messages actually went out", async () => {
    sendEmailMock.mockResolvedValue({ ok: false, channel: "in-app", detail: "no mailbox" });
    const result = await sendBookingEmails("confirmed", ctx());
    expect(result.sent).toBe(0);
  });
});
