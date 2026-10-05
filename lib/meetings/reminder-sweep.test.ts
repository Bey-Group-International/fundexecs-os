const sendEmailMock = jest.fn();
const hostCredentialsMock = jest.fn();

jest.mock("@/lib/email", () => ({
  ...jest.requireActual("@/lib/email"),
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

jest.mock("@/lib/meetings/mailbox.server", () => ({
  hostCredentials: (...args: unknown[]) => hostCredentialsMock(...args),
}));

import {
  dueReminders,
  isReminderDue,
  REMINDER_MAX_LEAD_MS,
  REMINDER_SWEEP_LOOKAHEAD_MS,
  type SweepableMeeting,
} from "./reminder";
import { runMeetingReminders } from "./reminder-sweep.server";

const NOW = new Date("2026-09-10T09:00:00.000Z");

function meeting(overrides: Partial<SweepableMeeting> = {}): SweepableMeeting {
  return {
    id: "m1",
    organization_id: "org1",
    host_id: "u1",
    title: "Quarterly review",
    status: "waiting",
    // 30 minutes out, with a 15-minute reminder: due within the lookahead.
    scheduled_at: "2026-09-10T09:30:00.000Z",
    duration_minutes: 60,
    timezone: "UTC",
    is_draft: false,
    deleted_at: null,
    attendees: [{ name: "Ada", email: "ada@lp.test" }],
    room_code: "abc-def",
    meeting_url: null,
    reminder_minutes: 15,
    last_reminder_sent_at: null,
    ...overrides,
  };
}

describe("isReminderDue", () => {
  it("fires for a meeting inside its reminder window", () => {
    expect(isReminderDue(meeting(), NOW)).toBe(true);
  });

  it("does not fire for a meeting still beyond the window", () => {
    // Six hours out with a 15-minute reminder: not yet, even allowing a sweep
    // of lookahead.
    expect(isReminderDue(meeting({ scheduled_at: "2026-09-10T15:00:00.000Z" }), NOW)).toBe(false);
  });

  it("fires early rather than never on a coarse sweep", () => {
    // 50 minutes out, 15-minute reminder. A strict rule would wait for a sweep
    // that lands after 09:45 — by which time the hourly cron has skipped past
    // the meeting entirely. The lookahead is what stops that being "no reminder".
    expect(isReminderDue(meeting({ scheduled_at: "2026-09-10T09:50:00.000Z" }), NOW)).toBe(true);
    // With a fine-grained sweep the same meeting waits its turn.
    expect(isReminderDue(meeting({ scheduled_at: "2026-09-10T09:50:00.000Z" }), NOW, 60_000)).toBe(false);
  });

  it("respects an explicit no-reminder choice", () => {
    expect(isReminderDue(meeting({ reminder_minutes: null }), NOW)).toBe(false);
  });

  it("never reminds twice about the same meeting", () => {
    expect(isReminderDue(meeting({ last_reminder_sent_at: "2026-09-09T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("inherits every refusal the manual button makes", () => {
    expect(isReminderDue(meeting({ is_draft: true }), NOW)).toBe(false);
    expect(isReminderDue(meeting({ deleted_at: "2026-09-01T00:00:00.000Z" }), NOW)).toBe(false);
    expect(isReminderDue(meeting({ status: "ended" }), NOW)).toBe(false);
    // Somebody already opened the room.
    expect(isReminderDue(meeting({ status: "active" }), NOW)).toBe(false);
    expect(isReminderDue(meeting({ attendees: [{ name: "No address" }] }), NOW)).toBe(false);
    // Already started — a reminder now is not a reminder.
    expect(isReminderDue(meeting({ scheduled_at: "2026-09-10T08:00:00.000Z" }), NOW)).toBe(false);
  });

  it("orders the due list soonest first", () => {
    const later = meeting({ id: "later", scheduled_at: "2026-09-10T09:45:00.000Z" });
    const sooner = meeting({ id: "sooner", scheduled_at: "2026-09-10T09:10:00.000Z" });
    expect(dueReminders([later, sooner], NOW).map((m) => m.id)).toEqual(["sooner", "later"]);
  });

  it("has a lookahead matched to the hourly sweep", () => {
    expect(REMINDER_SWEEP_LOOKAHEAD_MS).toBe(3_600_000);
  });
});

/**
 * A client whose read returns `rows` on the first page and whose claim update
 * returns `claim`. Later pages come back empty, which ends the paging loop.
 */
function client(
  rows: SweepableMeeting[],
  claim: unknown[] = [{ id: "m1" }],
  bookings: unknown[] = [],
) {
  const update = jest.fn();
  const ranges: Array<[number, number]> = [];
  const bookingFilters: Array<[string, unknown]> = [];
  // scheduling_bookings: .select().eq(meeting_id).eq(status).limit(1)
  const bookingQuery: Record<string, unknown> = {
    select: () => bookingQuery,
    eq: (column: string, value: unknown) => {
      bookingFilters.push([column, value]);
      return bookingQuery;
    },
    limit: async () => ({ data: bookings, error: null }),
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    is: () => b,
    neq: () => b,
    not: () => b,
    gt: () => b,
    lte: () => b,
    order: () => b,
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: from === 0 ? rows : [] };
    },
    update: (values: unknown) => {
      update(values);
      return {
        // .eq(id).is(last_reminder_sent_at, null).select() — the claim.
        // .eq(id).eq(last_reminder_sent_at, claimedAt)     — the release.
        eq: () => ({
          is: () => ({ select: async () => ({ data: claim }) }),
          eq: async () => ({ data: null }),
        }),
      };
    },
  };
  return {
    supabase: { from: (table: string) => (table === "scheduling_bookings" ? bookingQuery : b) } as never,
    update,
    ranges,
    bookingFilters,
  };
}

describe("runMeetingReminders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendEmailMock.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent" });
    hostCredentialsMock.mockResolvedValue({ gmailAccessToken: "tok" });
  });

  it("emails everyone on a meeting whose reminder came due", async () => {
    const { supabase } = client([
      meeting({ attendees: [{ name: "Ada", email: "ada@lp.test" }, { name: "Ben", email: "ben@lp.test" }] }),
    ]);

    const stats = await runMeetingReminders(supabase, { now: NOW });

    expect(stats).toEqual({ due: 1, reminded: 1, sent: 2, failed: 0 });
    expect(sendEmailMock.mock.calls.map(([a]) => (a as { to: { email: string } }).to.email)).toEqual([
      "ada@lp.test",
      "ben@lp.test",
    ]);
    const first = sendEmailMock.mock.calls[0][0] as { subject: string; htmlBody: string };
    expect(first.subject).toContain("Quarterly review");
    expect(first.htmlBody).toContain("/meeting-invite/abc-def");
  });

  it("sends from the meeting's own host mailbox", async () => {
    const { supabase } = client([meeting()]);
    await runMeetingReminders(supabase, { now: NOW });
    expect(hostCredentialsMock).toHaveBeenCalledWith(expect.anything(), "u1", "org1");
    expect((sendEmailMock.mock.calls[0][0] as { credentials: unknown }).credentials).toEqual({
      gmailAccessToken: "tok",
    });
  });

  it("lets the backup provider carry a reminder the host's mailbox can't", async () => {
    // A reminder nobody receives is a meeting nobody shows up to; this is one
    // of the sends allowed to fall back when Gmail can't.
    const { supabase } = client([meeting()]);
    await runMeetingReminders(supabase, { now: NOW });
    expect((sendEmailMock.mock.calls[0][0] as { allowFallback?: boolean }).allowFallback).toBe(true);
  });

  it("stamps the meeting before sending, so a crash cannot mail twice", async () => {
    const { supabase, update } = client([meeting()]);
    await runMeetingReminders(supabase, { now: NOW });
    expect(update).toHaveBeenCalledWith({ last_reminder_sent_at: NOW.toISOString() });
  });

  it("stands down when a concurrent sweep claimed the meeting first", async () => {
    // The claim update matched no unstamped row: somebody else is sending.
    const { supabase } = client([meeting()], []);
    const stats = await runMeetingReminders(supabase, { now: NOW });
    expect(stats).toEqual({ due: 0, reminded: 0, sent: 0, failed: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("counts an org with no mailbox as failed rather than throwing", async () => {
    hostCredentialsMock.mockResolvedValue(undefined);
    sendEmailMock.mockResolvedValue({ ok: false, channel: "in-app", detail: "no mailbox" });
    const { supabase } = client([meeting()]);

    const stats = await runMeetingReminders(supabase, { now: NOW });

    expect(stats).toMatchObject({ due: 1, reminded: 0, sent: 0, failed: 1 });
  });

  it("gives the claim back when the send reached nobody", async () => {
    // The claim exists to stop a double send, not to record a reminder that
    // never happened. Keeping it would exclude this meeting from every future
    // sweep, so an unconnected mailbox would cancel the reminder permanently
    // rather than delaying it.
    sendEmailMock.mockResolvedValue({ ok: false, channel: "in-app", detail: "no mailbox" });
    const { supabase, update } = client([meeting()]);

    await runMeetingReminders(supabase, { now: NOW });

    expect(update).toHaveBeenCalledWith({ last_reminder_sent_at: NOW.toISOString() });
    expect(update).toHaveBeenCalledWith({ last_reminder_sent_at: null });
  });

  it("keeps the claim when the send succeeded", async () => {
    const { supabase, update } = client([meeting()]);
    await runMeetingReminders(supabase, { now: NOW });
    expect(update).not.toHaveBeenCalledWith({ last_reminder_sent_at: null });
  });

  it("gives the claim back when every send rejects", async () => {
    // allSettled means a rejection lands as "reached nobody" rather than
    // escaping the sweep — the claim still has to come back.
    sendEmailMock.mockRejectedValue(new Error("network"));
    const { supabase, update } = client([meeting()]);

    const stats = await runMeetingReminders(supabase, { now: NOW });

    expect(stats.failed).toBe(1);
    expect(update).toHaveBeenCalledWith({ last_reminder_sent_at: null });
  });

  it("pages past a wall of not-yet-due meetings to reach a due one", async () => {
    // The read is ordered by start time, but due-ness depends on each meeting's
    // own lead. A single capped page lets sooner-but-not-due meetings hide a
    // later one whose long reminder has already come round.
    const notDue = Array.from({ length: 200 }, (_, i) =>
      meeting({ id: `soon${i}`, scheduled_at: "2026-09-10T18:00:00.000Z", reminder_minutes: 15 }),
    );
    const dueLater = meeting({
      id: "long-lead",
      scheduled_at: "2026-09-12T09:00:00.000Z",
      // Three days' notice, and the meeting is two days out: already due.
      reminder_minutes: 3 * 24 * 60,
    });

    const pages = [notDue, [dueLater]];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      is: () => b,
      neq: () => b,
      not: () => b,
      gt: () => b,
      lte: () => b,
      order: () => b,
      range: async (from: number) => ({ data: pages[Math.floor(from / 200)] ?? [] }),
      update: () => ({ eq: () => ({ is: () => ({ select: async () => ({ data: [{ id: "x" }] }) }) }) }),
    };

    const stats = await runMeetingReminders({ from: () => b } as never, { now: NOW });

    expect(stats.due).toBe(1);
    expect(stats.sent).toBe(1);
  });

  it("looks as far ahead as the reminder rules allow", async () => {
    // The query horizon has to match REMINDER_MAX_LEAD_MS, or a legal setting
    // sits permanently outside the query meant to find it.
    const { supabase } = client([]);
    await runMeetingReminders(supabase, { now: NOW });
    expect(REMINDER_MAX_LEAD_MS).toBe(14 * 24 * 3600_000);
  });

  it("skips meetings that are not due yet", async () => {
    const { supabase } = client([meeting({ scheduled_at: "2026-09-10T20:00:00.000Z" })]);
    const stats = await runMeetingReminders(supabase, { now: NOW });
    expect(stats.due).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("runMeetingReminders for a meeting booked through a scheduling link", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendEmailMock.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent" });
    hostCredentialsMock.mockResolvedValue({ gmailAccessToken: "tok" });
  });

  const booked = meeting({
    timezone: "America/Chicago",
    attendees: [
      { name: "Ada", email: "Ada@LP.test" },
      { name: "Ben", email: "ben@lp.test" },
    ],
  });
  const booking = { invitee_email: "ada@lp.test", invitee_timezone: "Asia/Singapore", manage_token: "tok123" };

  function sentTo(email: string) {
    const call = sendEmailMock.mock.calls.find(([a]) => (a as { to: { email: string } }).to.email === email);
    return (call?.[0] ?? {}) as { htmlBody: string };
  }

  it("gives the person who booked their own time and a way to reschedule", async () => {
    const { supabase, bookingFilters } = client([booked], [{ id: "m1" }], [booking]);
    await runMeetingReminders(supabase, { now: NOW });

    const invitee = sentTo("ada@lp.test").htmlBody;
    expect(invitee).toContain("/booking/tok123");
    expect(invitee).toMatch(/Reschedule or cancel/);
    // 09:30 UTC is 5:30 PM in Singapore.
    expect(invitee).toContain("5:30");
    expect(bookingFilters).toEqual([
      ["meeting_id", "m1"],
      ["status", "confirmed"],
    ]);
  });

  it("never hands a guest the invitee's manage link", async () => {
    const { supabase } = client([booked], [{ id: "m1" }], [booking]);
    await runMeetingReminders(supabase, { now: NOW });

    const guest = sentTo("ben@lp.test").htmlBody;
    expect(guest).not.toContain("tok123");
    expect(guest).not.toMatch(/Reschedule or cancel/);
    // The meeting's own zone: 09:30 UTC is 4:30 AM in Chicago.
    expect(guest).toContain("4:30");
  });

  it("sends the usual reminder when the meeting was not booked", async () => {
    const { supabase } = client([booked]);
    const stats = await runMeetingReminders(supabase, { now: NOW });

    expect(stats.sent).toBe(2);
    for (const [args] of sendEmailMock.mock.calls) {
      expect((args as { htmlBody: string }).htmlBody).not.toMatch(/Reschedule or cancel/);
    }
  });
});

describe("runMeetingReminders — which link it sends", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendEmailMock.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent" });
    hostCredentialsMock.mockResolvedValue({ gmailAccessToken: "tok" });
  });

  it("prefers the meeting's own conferencing link, as the host-triggered reminder does", async () => {
    const { supabase } = client([meeting({ meeting_url: "https://zoom.us/j/123" })]);
    await runMeetingReminders(supabase, { now: NOW });
    const html = (sendEmailMock.mock.calls[0][0] as { htmlBody: string }).htmlBody;
    expect(html).toContain('href="https://zoom.us/j/123"');
    expect(html).not.toContain("/meeting-invite/abc-def\"");
  });

  it("falls back to the room when the stored link cannot be rendered", async () => {
    const { supabase } = client([meeting({ meeting_url: "zoom.us/j/123" })]);
    await runMeetingReminders(supabase, { now: NOW });
    expect((sendEmailMock.mock.calls[0][0] as { htmlBody: string }).htmlBody).toContain("/meeting-invite/abc-def");
  });
});
