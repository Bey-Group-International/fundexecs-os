const sendEmailMock = jest.fn();

jest.mock("@/lib/email", () => ({
  ...jest.requireActual("@/lib/email"),
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { guestEmails, buildMeetingInviteHtml, sendMeetingInvites } from "./invite";

describe("guestEmails", () => {
  it("collects unique, lowercased, validated emails", () => {
    expect(
      guestEmails([
        { name: "Jane", email: "Jane@Fund.com", type: "external" },
        { name: "Jane dup", email: "jane@fund.com", type: "external" },
        { name: "No Email", type: "external" },
        { name: "Bob", email: "bob@fund.com", type: "internal" },
      ]),
    ).toEqual(["jane@fund.com", "bob@fund.com"]);
  });

  it("returns empty for null/empty", () => {
    expect(guestEmails(null)).toEqual([]);
    expect(guestEmails([])).toEqual([]);
    expect(guestEmails([{ name: "No email" }])).toEqual([]);
  });
});

describe("buildMeetingInviteHtml", () => {
  it("embeds an escaped title/sender and a safe join link", () => {
    const html = buildMeetingInviteHtml({
      inviteUrl: "https://app.test/meeting-invite/abc-def-12",
      title: "Q3 <LP> Review",
      senderName: "a@b.com",
    });
    expect(html).toContain("https://app.test/meeting-invite/abc-def-12");
    expect(html).toContain("Q3 &lt;LP&gt; Review");
    expect(html).not.toContain("<LP>");
  });

  it("offers a save-to-calendar link when the meeting has one", () => {
    const html = buildMeetingInviteHtml({
      inviteUrl: "https://app.test/meeting-invite/abc-def",
      title: "Q3 review",
      senderName: "rae@fund.test",
      calendarUrl: "https://app.test/api/meetings/public/abc-def/calendar.ics",
    });
    expect(html).toContain("Save to calendar");
    expect(html).toContain("/api/meetings/public/abc-def/calendar.ics");
  });

  it("omits the calendar link rather than pointing it nowhere", () => {
    const html = buildMeetingInviteHtml({
      inviteUrl: "https://app.test/meeting-invite/abc-def",
      title: "Q3 review",
      senderName: "rae@fund.test",
    });
    expect(html).not.toContain("Save to calendar");
  });

  it("neutralizes a non-http calendar URL", () => {
    const html = buildMeetingInviteHtml({
      inviteUrl: "https://app.test/meeting-invite/abc-def",
      title: "x",
      senderName: "y",
      calendarUrl: "javascript:alert(1)",
    });
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).not.toContain("Save to calendar");
  });

  it("neutralizes a non-http invite URL", () => {
    const html = buildMeetingInviteHtml({ inviteUrl: "javascript:alert(1)", title: "x", senderName: "y" });
    expect(html).toContain('href="#"');
    expect(html).not.toContain("javascript:alert(1)");
  });
});

describe("sendMeetingInvites — the host and the calendar", () => {
  const BASE = {
    origin: "https://app.test",
    roomCode: "abc-def",
    title: "Quarterly review",
    senderName: "rae@fund.test",
    emails: ["ada@example.com"],
    orgId: "org1",
    hostEmail: "rae@fund.test",
    meetingId: "m1",
    startIso: "2026-09-10T15:00:00.000Z",
    durationMinutes: 30,
  };

  const to = () => sendEmailMock.mock.calls.map(([a]) => (a as { to: { email: string } }).to.email);
  const invites = () =>
    sendEmailMock.mock.calls
      .map(([a]) => (a as { calendarInvite?: { content: string; method: string } }).calendarInvite)
      .filter(Boolean) as Array<{ content: string; method: string }>;

  beforeEach(() => {
    jest.clearAllMocks();
    sendEmailMock.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent" });
  });

  it("emails the host as well as the guests", async () => {
    const res = await sendMeetingInvites(BASE);
    expect(to()).toEqual(["rae@fund.test", "ada@example.com"]);
    expect(res).toEqual({ sent: 2, total: 2 });
  });

  it("emails the host when nobody else is invited", async () => {
    // Previously this sent nothing at all, so a meeting the host scheduled for
    // themselves never reached their calendar.
    await sendMeetingInvites({ ...BASE, emails: [] });
    expect(to()).toEqual(["rae@fund.test"]);
  });

  it("attaches a real calendar invitation, not just a link", async () => {
    await sendMeetingInvites(BASE);
    const all = invites();
    expect(all).toHaveLength(2);
    expect(all[0].method).toBe("REQUEST");
    expect(all[0].content).toContain("METHOD:REQUEST");
    expect(all[0].content).toContain("SUMMARY:Quarterly review");
    expect(all[0].content).toContain("DTSTART:20260910T150000Z");
    expect(all[0].content).toContain("DTEND:20260910T153000Z");
  });

  it("names the host as organizer and everyone as attendees", async () => {
    await sendMeetingInvites(BASE);
    // Unfolded first: RFC 5545 wraps long lines, so an ATTENDEE can arrive as
    // "…MAIL\r\n TO:…" and a naive substring check would miss a line that is
    // perfectly correct.
    const content = invites()[0].content.replace(/\r\n /g, "");
    expect(content).toContain("ORGANIZER;CN=\"rae@fund.test\":MAILTO:rae@fund.test");
    expect(content).toContain("MAILTO:ada@example.com");
    expect(content).toContain("MAILTO:rae@fund.test");
  });

  it("can name the host as organizer without emailing them again", async () => {
    // Adding one late guest to a meeting the host already holds. They belong on
    // the invitation as ORGANIZER — that is what makes it their meeting — but
    // they should not get a second "your meeting is scheduled" for it.
    const res = await sendMeetingInvites({ ...BASE, notifyHost: false });
    expect(to()).toEqual(["ada@example.com"]);
    expect(res).toEqual({ sent: 1, total: 1 });
    const content = invites()[0].content.replace(/\r\n /g, "");
    expect(content).toContain("ORGANIZER;CN=\"rae@fund.test\":MAILTO:rae@fund.test");
  });

  it("sends nothing when the host is the only recipient and is opted out", async () => {
    const res = await sendMeetingInvites({ ...BASE, emails: [], notifyHost: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(res).toEqual({ sent: 0, total: 0 });
  });

  it("uses a meeting UID that cannot collide with a booking's", async () => {
    // Both live in the same calendars. A shared UID would make one overwrite
    // the other.
    await sendMeetingInvites(BASE);
    expect(invites()[0].content).toContain("UID:meeting-m1@app.test");
  });

  it("puts a save-to-calendar button in every invitation", async () => {
    // The .ics is attached too, but only Gmail and Apple Mail turn that into a
    // card. Everyone else gets a file under a paperclip, and on a phone that is
    // most of a minute of fiddling.
    await sendMeetingInvites(BASE);
    for (const [args] of sendEmailMock.mock.calls) {
      expect((args as { htmlBody: string }).htmlBody).toContain(
        "https://app.test/api/meetings/public/abc-def/calendar.ics",
      );
    }
  });

  it("still emails when the meeting has no time yet", async () => {
    // A meeting with no time cannot be a calendar entry, but the people on it
    // still need to know it exists.
    await sendMeetingInvites({ ...BASE, startIso: null });
    expect(to()).toHaveLength(2);
    expect(invites()).toHaveLength(0);
  });

  it("degrades to the old behaviour for a caller that passes no host", async () => {
    await sendMeetingInvites({ ...BASE, hostEmail: null, meetingId: null });
    expect(to()).toEqual(["ada@example.com"]);
    expect(invites()).toHaveLength(0);
  });

  it("tells the host it is theirs and the guest they are invited", async () => {
    await sendMeetingInvites(BASE);
    const subjects = sendEmailMock.mock.calls.map(([a]) => (a as { subject: string }).subject);
    expect(subjects[0]).toMatch(/^Scheduled:/);
    expect(subjects[1]).toMatch(/invited to join/);
  });
});
