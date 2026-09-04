const sendEmailMock = jest.fn();
const hostCredentialsMock = jest.fn();

jest.mock("@/lib/email", () => ({
  ...jest.requireActual("@/lib/email"),
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

jest.mock("@/lib/meetings/mailbox.server", () => ({
  hostCredentials: (...args: unknown[]) => hostCredentialsMock(...args),
}));

import { dueReminders, isReminderDue, REMINDER_SWEEP_LOOKAHEAD_MS, type SweepableMeeting } from "./reminder";
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

/** A client whose read returns `rows` and whose claim update returns `claim`. */
function client(rows: SweepableMeeting[], claim: unknown[] = [{ id: "m1" }]) {
  const update = jest.fn();
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    is: () => b,
    neq: () => b,
    not: () => b,
    gt: () => b,
    lte: () => b,
    order: () => b,
    limit: async () => ({ data: rows }),
    update: (values: unknown) => {
      update(values);
      return {
        eq: () => ({ is: () => ({ select: async () => ({ data: claim }) }) }),
      };
    },
  };
  return { supabase: { from: () => b } as never, update };
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

  it("skips meetings that are not due yet", async () => {
    const { supabase } = client([meeting({ scheduled_at: "2026-09-10T20:00:00.000Z" })]);
    const stats = await runMeetingReminders(supabase, { now: NOW });
    expect(stats.due).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
