import {
  REMINDER_COOLDOWN_MS,
  buildReminderEmail,
  canSendReminder,
  describeDuration,
  describeTimeUntil,
  reminderCooldownRemaining,
  reminderRecipients,
  type RemindableMeeting,
} from "./reminder";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function meeting(over: Partial<RemindableMeeting> = {}): RemindableMeeting {
  return {
    title: "Q3 LP update",
    status: "waiting",
    scheduled_at: "2026-09-01T15:00:00.000Z",
    is_draft: false,
    deleted_at: null,
    attendees: [{ name: "Ada", email: "ada@example.com" }],
    last_reminder_sent_at: null,
    ...over,
  };
}

describe("reminderRecipients", () => {
  it("keeps names alongside addresses", () => {
    expect(reminderRecipients([{ name: "Ada", email: "ada@example.com" }])).toEqual([
      { name: "Ada", email: "ada@example.com" },
    ]);
  });

  it("falls back to the local part rather than an empty greeting", () => {
    expect(reminderRecipients([{ email: "ada@example.com" }])).toEqual([
      { name: "ada", email: "ada@example.com" },
    ]);
  });

  it("drops attendees with no usable address", () => {
    const out = reminderRecipients([{ name: "No Email" }, { email: "junk" }, { email: "ada@example.com" }]);
    expect(out).toHaveLength(1);
  });

  it("deduplicates the same person listed twice", () => {
    const out = reminderRecipients([{ email: "ada@example.com" }, { name: "Ada", email: "ADA@example.com" }]);
    expect(out).toHaveLength(1);
  });

  it("copes with no attendees", () => {
    expect(reminderRecipients(null)).toEqual([]);
    expect(reminderRecipients(undefined)).toEqual([]);
  });
});

describe("canSendReminder", () => {
  it("allows a scheduled meeting with guests", () => {
    const v = canSendReminder(meeting(), NOW);
    expect(v.ok).toBe(true);
    expect(v.recipients).toHaveLength(1);
  });

  it("refuses a meeting that has already started", () => {
    // A reminder for something in progress is noise, not a prompt.
    const v = canSendReminder(meeting({ scheduled_at: "2026-09-01T11:59:00.000Z" }), NOW);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/already started/);
  });

  it("refuses a meeting that has ended", () => {
    expect(canSendReminder(meeting({ status: "ended" }), NOW).reason).toMatch(/already ended/);
  });

  it("refuses a draft", () => {
    expect(canSendReminder(meeting({ is_draft: true }), NOW).reason).toMatch(/Save the meeting/);
  });

  it("refuses a deleted meeting", () => {
    expect(canSendReminder(meeting({ deleted_at: "2026-09-01T10:00:00Z" }), NOW).reason).toMatch(/deleted/);
  });

  it("refuses one with no scheduled time", () => {
    expect(canSendReminder(meeting({ scheduled_at: null }), NOW).reason).toMatch(/no scheduled time/);
    expect(canSendReminder(meeting({ scheduled_at: "nonsense" }), NOW).reason).toMatch(/no scheduled time/);
  });

  it("refuses one too far out to be a prompt", () => {
    const v = canSendReminder(meeting({ scheduled_at: "2026-10-01T15:00:00.000Z" }), NOW);
    expect(v.reason).toMatch(/two weeks/);
  });

  it("says plainly when there is nobody to remind", () => {
    const v = canSendReminder(meeting({ attendees: [{ name: "No Email" }] }), NOW);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/Nobody on this meeting/);
  });

  it("puts the empty guest list ahead of every refusal but deletion", () => {
    // The earlier test proved nothing about precedence: no other refusal
    // applied to it. These each pair the empty list with a refusal that would
    // otherwise win, because an empty list is the one thing the host can act on
    // now and it stays true after the draft is saved or the date comes closer.
    const noOne = [{ name: "No Email" }];
    for (const over of [
      { is_draft: true },
      { status: "ended" },
      { status: "active" },
      { scheduled_at: null },
      { scheduled_at: "2026-08-01T15:00:00.000Z" },
      { scheduled_at: "2026-10-01T15:00:00.000Z" },
      { last_reminder_sent_at: "2026-09-01T11:58:00.000Z" },
    ]) {
      const v = canSendReminder(meeting({ attendees: noOne, ...over }), NOW);
      expect(v.ok).toBe(false);
      expect(v.reason).toMatch(/Nobody on this meeting/);
    }
  });

  it("still leads with deletion, which is about the meeting existing at all", () => {
    // "Nobody has an email address" would answer a question the host did not
    // ask about a meeting that is gone.
    const v = canSendReminder(
      meeting({ attendees: [{ name: "No Email" }], deleted_at: "2026-09-01T10:00:00Z" }),
      NOW,
    );
    expect(v.reason).toMatch(/deleted/);
  });

  it("refuses a meeting somebody has already opened", () => {
    // A host can start a room before its scheduled time, so the clock check
    // alone would let this through and remind people about a meeting they can
    // already join.
    const v = canSendReminder(meeting({ status: "active" }), NOW);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/already started/);
  });

  it("refuses a second reminder inside the cooldown", () => {
    // A host clicking twice means "did that work?", not "send it again" — and
    // these land in external inboxes.
    const v = canSendReminder(
      meeting({ last_reminder_sent_at: "2026-09-01T11:58:00.000Z" }),
      NOW,
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/just went out/);
    expect(v.reason).toMatch(/8 minutes/);
  });

  it("allows again once the cooldown has passed", () => {
    const v = canSendReminder(meeting({ last_reminder_sent_at: "2026-09-01T11:40:00.000Z" }), NOW);
    expect(v.ok).toBe(true);
  });

  it("still reports recipients on a refusal, so the UI can explain", () => {
    const v = canSendReminder(meeting({ is_draft: true }), NOW);
    expect(v.recipients).toHaveLength(1);
  });
});

describe("reminderCooldownRemaining", () => {
  it("is zero when nothing has been sent", () => {
    expect(reminderCooldownRemaining(null, NOW)).toBe(0);
  });

  it("counts down", () => {
    expect(reminderCooldownRemaining("2026-09-01T11:55:00.000Z", NOW)).toBe(5 * 60_000);
    expect(reminderCooldownRemaining("2026-09-01T11:50:00.000Z", NOW)).toBe(0);
  });

  it("never locks the button forever on a bad timestamp", () => {
    // A clock skew that puts the last send in the future would otherwise leave
    // the host unable to remind anyone at all.
    expect(reminderCooldownRemaining("2026-09-01T13:00:00.000Z", NOW)).toBe(0);
    expect(reminderCooldownRemaining("nonsense", NOW)).toBe(0);
  });

  it("honours a caller-supplied cooldown", () => {
    expect(reminderCooldownRemaining("2026-09-01T11:59:00.000Z", NOW, 30_000)).toBe(0);
  });

  it("has a cooldown long enough to matter", () => {
    expect(REMINDER_COOLDOWN_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("describeDuration", () => {
  it("reads as a wait", () => {
    expect(describeDuration(30_000)).toBe("30 seconds");
    expect(describeDuration(60_000)).toBe("1 minute");
    expect(describeDuration(9 * 60_000)).toBe("9 minutes");
  });

  it("never says zero seconds, and says it in the singular", () => {
    expect(describeDuration(1)).toBe("1 second");
    expect(describeDuration(1000)).toBe("1 second");
    expect(describeDuration(1001)).toBe("2 seconds");
  });
});

describe("describeTimeUntil", () => {
  it("is coarse on purpose", () => {
    expect(describeTimeUntil("2026-09-01T12:15:00.000Z", NOW)).toBe("in 15 minutes");
    expect(describeTimeUntil("2026-09-01T13:00:00.000Z", NOW)).toBe("in about an hour");
    expect(describeTimeUntil("2026-09-01T15:00:00.000Z", NOW)).toBe("in about 3 hours");
    expect(describeTimeUntil("2026-09-02T12:00:00.000Z", NOW)).toBe("tomorrow");
    expect(describeTimeUntil("2026-09-04T12:00:00.000Z", NOW)).toBe("in 3 days");
  });

  it("handles the edges without embarrassing arithmetic", () => {
    expect(describeTimeUntil("2026-09-01T12:00:30.000Z", NOW)).toBe("in a minute");
    expect(describeTimeUntil("2026-09-01T11:00:00.000Z", NOW)).toBe("now");
    expect(describeTimeUntil("nonsense", NOW)).toBe("soon");
  });
});

describe("buildReminderEmail", () => {
  const input = {
    title: "Q3 LP update",
    hostName: "Rae Bey",
    whenLabel: "Tue, Sep 1, 3:00 PM EDT",
    timeUntil: "in about 3 hours",
    joinUrl: "https://app.test/meeting-invite/abc",
  };

  it("says what and when in the subject", () => {
    expect(buildReminderEmail(input).subject).toBe("Reminder: Q3 LP update — in about 3 hours");
  });

  it("includes the join link as a button", () => {
    expect(buildReminderEmail(input).html).toContain('href="https://app.test/meeting-invite/abc"');
  });

  it("omits the button when there is nowhere to join", () => {
    const html = buildReminderEmail({ ...input, joinUrl: null }).html;
    expect(html).not.toContain("Join meeting");
  });

  it("cannot be made to open a second attribute", () => {
    // The scheme test alone is not enough: a quote later in the URL would close
    // href and let whatever follows be read as markup. meeting_url is stored
    // data, not a constant.
    const html = buildReminderEmail({
      ...input,
      joinUrl: 'https://app.test/r/1" onmouseover="steal()',
    }).html;
    expect(html).toContain("&quot;");
    expect(html).not.toContain('onmouseover="steal()');
  });

  it("refuses a javascript: url rather than rendering it", () => {
    // A stored meeting_url is not a place to accept a script.
    const html = buildReminderEmail({ ...input, joinUrl: "javascript:alert(1)" }).html;
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Join meeting");
  });

  it("escapes a title supplied by whoever booked", () => {
    const html = buildReminderEmail({ ...input, title: '<img src=x onerror="alert(1)">' }).html;
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes the note as well", () => {
    const html = buildReminderEmail({ ...input, note: "<script>alert(1)</script>" }).html;
    expect(html).not.toContain("<script>");
  });

  it("falls back rather than greeting nobody", () => {
    const { subject, html } = buildReminderEmail({ ...input, title: "  ", hostName: "  " });
    expect(subject).toContain("your meeting");
    expect(html).toContain("Your host");
  });
});
