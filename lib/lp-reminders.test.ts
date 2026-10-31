import { dueReminder, reminderEmail, type ReminderCandidate } from "./lp-reminders";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-10T12:00:00Z");
const created = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const base = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  review_state: "in_progress",
  status: "pending",
  created_at: created(0),
  expires_at: new Date(NOW + 7 * DAY).toISOString(),
  reminded_day3_at: null,
  reminded_day6_at: null,
  ...over,
});

describe("dueReminder", () => {
  it.each([
    [0, null],
    [2.9, null],
    [3, 3],
    [4.5, 3],
    [5.9, 3],
    [6, 6],
    [6.9, 6],
  ])("a link made %p days ago → %p", (days, expected) => {
    expect(dueReminder(base({ created_at: created(days), expires_at: new Date(NOW + 1 * DAY).toISOString() }), NOW)).toBe(expected);
  });

  it("sends each reminder once", () => {
    const stamp = new Date(NOW - 1000).toISOString();
    expect(dueReminder(base({ created_at: created(4), reminded_day3_at: stamp }), NOW)).toBeNull();
    expect(dueReminder(base({ created_at: created(6.5), reminded_day3_at: stamp }), NOW)).toBe(6);
    expect(dueReminder(base({ created_at: created(6.5), reminded_day3_at: stamp, reminded_day6_at: stamp }), NOW)).toBeNull();
  });

  it("sends only the later reminder if the sweep missed the earlier one", () => {
    expect(dueReminder(base({ created_at: created(6.2) }), NOW)).toBe(6);
  });

  it("only reminds an LP who has not submitted", () => {
    const old = { created_at: created(4) };
    expect(dueReminder(base({ ...old, review_state: "not_started" }), NOW)).toBe(3);
    expect(dueReminder(base({ ...old, review_state: "in_progress" }), NOW)).toBe(3);
    for (const review_state of ["submitted", "changes_requested", "approved", "rejected"]) {
      expect(dueReminder(base({ ...old, review_state }), NOW)).toBeNull();
    }
  });

  it("does not remind about a link that has run out", () => {
    expect(dueReminder(base({ created_at: created(8), expires_at: new Date(NOW - 1000).toISOString() }), NOW)).toBeNull();
    expect(dueReminder(base({ created_at: created(4), status: "expired" }), NOW)).toBeNull();
  });
});

describe("reminderEmail", () => {
  const args = { lpName: "Jo <b>Park</b>", orgName: "Acme & Co", url: "https://app.example.com/lp/tok?a=1&b=2", expiresAt: "2026-11-11T00:00:00Z" };

  it("says the link is expiring on the second reminder, not the first", () => {
    expect(reminderEmail({ ...args, day: 3 }).subject).toBe("Acme & Co: finish your investor onboarding");
    const six = reminderEmail({ ...args, day: 6 });
    expect(six.subject).toBe("Acme & Co: your onboarding link expires soon");
    expect(six.htmlBody).toContain("expires soon");
  });

  it("links to the LP's own page, and escapes everything it was given", () => {
    const mail = reminderEmail({ ...args, day: 3 });
    expect(mail.htmlBody).toContain('href="https://app.example.com/lp/tok?a=1&amp;b=2"');
    expect(mail.htmlBody).not.toContain("<b>");
    expect(mail.htmlBody).toContain("Acme &amp; Co");
  });

  it("tells the LP about the code", () => {
    expect(reminderEmail({ ...args, day: 3 }).htmlBody).toMatch(/code we email you/);
  });
});
