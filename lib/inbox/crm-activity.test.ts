// lib/inbox/crm-activity.test.ts
// Which contact an inbox conversation is logged against, and what it says.
//
// Same stakes as the meetings rules: a wrong link writes one person's
// conversation onto another person's permanent record, org-wide, and nothing
// downstream can tell. The near-miss cases below are what keep "exact addresses
// only" a decision rather than a comment.
import {
  INBOX_BODY_MAX,
  NO_PREVIEW_BODY,
  activityTypeForChannel,
  threadActivity,
  type InboxCrmInput,
} from "./crm-activity";

const THREAD = {
  id: "t1",
  channel: "gmail",
  subject: "Q3 pacing",
  counterpartyEmail: "ana@acme.com",
  aiSummary: "Ana asked for the updated pacing model.",
  preview: "Hi — could you send over the pacing model when you get a moment?",
  lastMessageAt: "2026-09-23T14:00:00.000Z",
};

function input(over: Partial<InboxCrmInput> = {}): InboxCrmInput {
  return {
    thread: THREAD,
    contactsByEmail: new Map([["ana@acme.com", "contact-ana"]]),
    now: "2026-09-30T08:00:00.000Z",
    ...over,
  };
}

describe("who a conversation is logged against", () => {
  it("logs the contact on the other end", () => {
    const row = threadActivity(input());
    expect(row).not.toBeNull();
    expect(row!.contactId).toBe("contact-ana");
    expect(row!.activityType).toBe("email");
    expect(row!.isSystem).toBe(true);
    expect(row!.subject).toBe("Q3 pacing");
    expect(row!.metadata.thread_id).toBe("t1");
    expect(row!.metadata.source).toBe("inbox_thread");
  });

  it("writes nothing for a counterparty the CRM does not know", () => {
    expect(threadActivity(input({ contactsByEmail: new Map() }))).toBeNull();
  });

  it("writes nothing for a thread with no address at all", () => {
    for (const email of [null, "", "   ", "not-an-address"]) {
      expect(threadActivity(input({ thread: { ...THREAD, counterpartyEmail: email } }))).toBeNull();
    }
  });

  it("matches however the address was capitalised", () => {
    const row = threadActivity(input({ thread: { ...THREAD, counterpartyEmail: " Ana@Acme.COM " } }));
    expect(row!.contactId).toBe("contact-ana");
  });

  /**
   * The cases a fuzzy matcher would link, each of which would put this
   * conversation on the wrong person's record. Same list as the meetings rules,
   * because it is the same decision and it has to hold in both places.
   */
  it("does not match an address that merely looks like a contact's", () => {
    for (const nearMiss of [
      "ana@acme.co",
      "ana@acme.com.br",
      "ana@sub.acme.com",
      "ana@acmecorp.com",
      "an@acme.com",
      "anna@acme.com",
      "ana.diaz@acme.com",
      "bob@acme.com",
    ]) {
      expect(threadActivity(input({ thread: { ...THREAD, counterpartyEmail: nearMiss } }))).toBeNull();
    }
  });
});

describe("what the entry says", () => {
  it("prefers the model's summary over the raw preview", () => {
    expect(threadActivity(input())!.body).toBe("Ana asked for the updated pacing model.");
  });

  // A thread is ingested before the intelligence pass runs, so the first row
  // written for it has no summary — the preview is what there is.
  it("falls back to the preview when no summary exists yet", () => {
    const row = threadActivity(input({ thread: { ...THREAD, aiSummary: null } }));
    expect(row!.body).toContain("could you send over the pacing model");
  });

  it("says so plainly when there is neither", () => {
    for (const thread of [
      { ...THREAD, aiSummary: null, preview: null },
      { ...THREAD, aiSummary: "  ", preview: "   " },
    ]) {
      expect(threadActivity(input({ thread }))!.body).toBe(NO_PREVIEW_BODY);
    }
  });

  it("cuts a long conversation rather than putting it on the record whole", () => {
    const row = threadActivity(input({ thread: { ...THREAD, aiSummary: "x".repeat(INBOX_BODY_MAX + 400) } }));
    expect(row!.body.length).toBeLessThanOrEqual(INBOX_BODY_MAX + 1);
    expect(row!.body.endsWith("…")).toBe(true);
  });

  it("names an unnamed thread rather than logging a blank subject", () => {
    for (const subject of [null, "", "   "]) {
      expect(threadActivity(input({ thread: { ...THREAD, subject } }))!.subject).toBe("Conversation");
    }
  });
});

describe("when it happened", () => {
  // A thread imported today whose last message was in March belongs in March.
  it("is the instant of the latest message, not the instant this ran", () => {
    expect(threadActivity(input())!.occurredAt).toBe("2026-09-23T14:00:00.000Z");
  });

  it("falls back to now only when the thread carries no message time", () => {
    const row = threadActivity(input({ thread: { ...THREAD, lastMessageAt: null } }));
    expect(row!.occurredAt).toBe("2026-09-30T08:00:00.000Z");
  });
});

/**
 * `network_activities.activity_type` has a CHECK constraint, so every channel
 * must map to a value the database accepts. This asserts against that list —
 * which lives in the migration, not in this module — rather than against the map
 * itself.
 */
describe("the activity type each channel maps to", () => {
  const ACCEPTED = [
    "note",
    "call",
    "meeting",
    "email",
    "linkedin",
    "intro",
    "stage_change",
    "owner_change",
    "task",
    "commitment",
    "document",
    "import",
    "merge",
    "other",
  ];

  it("only ever produces a type the column's CHECK constraint allows", () => {
    const channels = [
      "gmail",
      "slack",
      "calendly",
      "google_calendar",
      "zoom",
      "google_meet",
      "docusign",
      // And a channel added later, which must not produce an illegal value.
      "some_future_provider",
      "",
    ];
    for (const channel of channels) {
      expect(ACCEPTED).toContain(activityTypeForChannel(channel));
    }
  });

  it("calls mail mail", () => {
    expect(activityTypeForChannel("gmail")).toBe("email");
  });

  // A Zoom or Calendly notification is a record of contact, but calling it a
  // "meeting" would put it beside the entries the meetings writer makes for
  // meetings that actually happened. Those two must not be confused on a record
  // people read and act on.
  it("does not call a scheduling or video notification a meeting", () => {
    for (const channel of ["calendly", "google_calendar", "zoom", "google_meet"]) {
      expect(activityTypeForChannel(channel)).not.toBe("meeting");
      expect(activityTypeForChannel(channel)).toBe("other");
    }
  });
});
