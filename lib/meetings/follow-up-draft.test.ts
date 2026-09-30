/**
 * Which thread a meeting's follow-up gets drafted onto.
 *
 * The wrong answer here is not an error message — it is somebody's closed
 * correspondence reopening with a new message under its old subject, or email
 * prose sitting in a Slack composer. Both look like the product working.
 */
import {
  DRAFT_CHANNEL,
  canHoldDraft,
  chooseDraftThread,
  draftMessage,
  planFollowUpDrafts,
  type DraftCandidate,
} from "./follow-up-draft";
import type { MeetingRecipient } from "./recipients";

function candidate(over: Partial<DraftCandidate> = {}): DraftCandidate {
  return {
    id: "t1",
    channel: DRAFT_CHANNEL,
    status: "open",
    counterparty_email: "ana@acme.com",
    last_message_at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

const ANA: MeetingRecipient = { name: "Ana Diaz", email: "ana@acme.com" };
const BEN: MeetingRecipient = { name: "Ben Okoro", email: "ben@acme.com" };

describe("which threads can hold a follow-up at all", () => {
  it("takes an open email thread", () => {
    expect(canHoldDraft(candidate())).toBe(true);
  });

  it("takes a snoozed one — deferred is not finished", () => {
    expect(canHoldDraft(candidate({ status: "snoozed" }))).toBe(true);
  });

  /**
   * The thread was closed on purpose. Reopening it to hold a new message puts the
   * follow-up under an old subject in the middle of a conversation that had
   * ended, which is worse than starting a fresh thread.
   */
  it("refuses a thread somebody has closed", () => {
    expect(canHoldDraft(candidate({ status: "done" }))).toBe(false);
  });

  /**
   * A follow-up is an email. A Slack thread or a Docusign notification carrying
   * the same address would put email prose into a composer that sends something
   * else entirely.
   */
  it.each(["slack", "docusign", "calendly", "zoom", "google_calendar"])(
    "refuses a %s thread however recent it is",
    (channel) => {
      expect(canHoldDraft(candidate({ channel, last_message_at: "2026-09-30T00:00:00.000Z" }))).toBe(
        false,
      );
    },
  );
});

describe("choosing between them", () => {
  // The conversation the meeting was a continuation of.
  it("takes the most recently spoken-on eligible thread", () => {
    const chosen = chooseDraftThread([
      candidate({ id: "old", last_message_at: "2026-01-01T00:00:00.000Z" }),
      candidate({ id: "new", last_message_at: "2026-09-01T00:00:00.000Z" }),
      candidate({ id: "mid", last_message_at: "2026-05-01T00:00:00.000Z" }),
    ]);
    expect(chosen?.id).toBe("new");
  });

  it("passes over a recent closed thread for an older open one", () => {
    const chosen = chooseDraftThread([
      candidate({ id: "closed", status: "done", last_message_at: "2026-09-30T00:00:00.000Z" }),
      candidate({ id: "open", last_message_at: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(chosen?.id).toBe("open");
  });

  it("will use a thread with no messages rather than none at all", () => {
    expect(chooseDraftThread([candidate({ id: "empty", last_message_at: null })])?.id).toBe("empty");
  });

  it("prefers a thread that has been spoken on to one that has not", () => {
    const chosen = chooseDraftThread([
      candidate({ id: "empty", last_message_at: null }),
      candidate({ id: "spoken", last_message_at: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(chosen?.id).toBe("spoken");
  });

  /**
   * Same inputs, same thread. Without this the choice falls to whichever row the
   * database happened to return first, so two presses of the same button could
   * draft onto two different threads and leave one of them stale.
   */
  it("breaks a tie deterministically rather than on read order", () => {
    const a = candidate({ id: "aaa", last_message_at: "2026-09-01T00:00:00.000Z" });
    const b = candidate({ id: "bbb", last_message_at: "2026-09-01T00:00:00.000Z" });
    expect(chooseDraftThread([a, b])?.id).toBe("aaa");
    expect(chooseDraftThread([b, a])?.id).toBe("aaa");
  });

  it("finds nothing when every thread is ineligible", () => {
    expect(
      chooseDraftThread([candidate({ status: "done" }), candidate({ channel: "slack" })]),
    ).toBeNull();
  });
});

describe("the plan", () => {
  it("puts each attendee on their own thread", () => {
    const plan = planFollowUpDrafts({
      recipients: [ANA, BEN],
      threads: [
        candidate({ id: "for-ana", counterparty_email: "ana@acme.com" }),
        candidate({ id: "for-ben", counterparty_email: "ben@acme.com" }),
      ],
      subject: "Follow-up: Series B",
    });
    expect(plan.targets).toEqual([
      { name: "Ana Diaz", email: "ana@acme.com", threadId: "for-ana", create: null },
      { name: "Ben Okoro", email: "ben@acme.com", threadId: "for-ben", create: null },
    ]);
  });

  // Matched on the normalized address on both sides: the provider stores the
  // thread's address as it arrived, and the invite list is whatever was typed.
  it("matches a capitalised address against a lowercase thread", () => {
    const plan = planFollowUpDrafts({
      recipients: [{ name: "Ana", email: "ANA@Acme.com" }],
      threads: [candidate({ id: "for-ana" })],
      subject: "s",
    });
    expect(plan.targets[0]).toMatchObject({ threadId: "for-ana", email: "ana@acme.com" });
  });

  it("asks for a new thread when the attendee has none that will do", () => {
    const plan = planFollowUpDrafts({
      recipients: [ANA],
      threads: [candidate({ status: "done" })],
      subject: "Follow-up: Series B",
    });
    expect(plan.targets[0]).toEqual({
      name: "Ana Diaz",
      email: "ana@acme.com",
      threadId: null,
      create: {
        channel: DRAFT_CHANNEL,
        category: "messaging",
        subject: "Follow-up: Series B",
        counterparty_name: "Ana Diaz",
        counterparty_email: "ana@acme.com",
      },
    });
  });

  // The recipient rules fall back to the address as the name. Storing that as a
  // name puts "s.chen" in the counterparty column, which reads as a name and is
  // not one.
  it("stores no name rather than an address used as one", () => {
    const plan = planFollowUpDrafts({
      recipients: [{ name: "ana@acme.com", email: "ana@acme.com" }],
      threads: [],
      subject: "s",
    });
    expect(plan.targets[0].create?.counterparty_name).toBeNull();
  });

  /**
   * A thread invented around a malformed address is a thread nothing can ever
   * send, sitting in the inbox looking exactly like one that can.
   */
  it("plans nothing at all for an attendee with no usable address", () => {
    const plan = planFollowUpDrafts({
      recipients: [{ name: "Guest", email: "not-an-address" }],
      threads: [],
      subject: "s",
    });
    expect(plan.targets).toEqual([]);
  });

  it("plans one draft for an attendee who appears twice", () => {
    const plan = planFollowUpDrafts({
      recipients: [ANA, { name: "Ana D", email: "ANA@acme.com" }],
      threads: [candidate({ id: "for-ana" })],
      subject: "s",
    });
    expect(plan.targets).toHaveLength(1);
  });

  // Carried through for the same reason the send path carries it: the host is the
  // only person who can reach them, and "drafted for 2 people" on a meeting of
  // four reads as complete.
  it("carries the people who have no address here", () => {
    const plan = planFollowUpDrafts({
      recipients: [ANA],
      unreachable: ["Priya"],
      threads: [],
      subject: "s",
    });
    expect(plan.unreachable).toEqual(["Priya"]);
  });

  it("ignores a thread whose counterparty belongs to nobody in the meeting", () => {
    const plan = planFollowUpDrafts({
      recipients: [ANA],
      threads: [candidate({ id: "stranger", counterparty_email: "someone@else.com" })],
      subject: "s",
    });
    expect(plan.targets[0].threadId).toBeNull();
  });
});

describe("what the report says happened", () => {
  /**
   * The one thing this message must never do is read as a send. Every branch says
   * so, because the panel that shows it also has a Send button two inches away.
   */
  it.each([
    { drafted: 1, created: 0, failed: 0, unreachable: [] },
    { drafted: 3, created: 2, failed: 1, unreachable: ["Priya"] },
    { drafted: 2, created: 0, failed: 0, unreachable: [] },
  ])("says nothing has been sent (%j)", (input) => {
    expect(draftMessage(input)).toMatch(/Nothing has been sent/);
  });

  it("counts people rather than addresses", () => {
    expect(draftMessage({ drafted: 1, created: 0, failed: 0, unreachable: [] })).toMatch(
      /for 1 person/,
    );
    expect(draftMessage({ drafted: 4, created: 0, failed: 0, unreachable: [] })).toMatch(
      /for 4 people/,
    );
  });

  // A brand-new thread appearing for somebody the org has never emailed is
  // correct, and looks like a bug if nothing mentions it.
  it("mentions the threads it had to create", () => {
    expect(draftMessage({ drafted: 2, created: 1, failed: 0, unreachable: [] })).toMatch(
      /one of them a new thread/,
    );
    expect(draftMessage({ drafted: 3, created: 2, failed: 0, unreachable: [] })).toMatch(
      /2 of them new threads/,
    );
  });

  it("names the people it could not reach", () => {
    expect(draftMessage({ drafted: 1, created: 0, failed: 0, unreachable: ["Priya", "Sam"] })).toMatch(
      /no address here for Priya, Sam/,
    );
  });

  it("does not claim a draft when nothing was written", () => {
    expect(draftMessage({ drafted: 0, created: 0, failed: 2, unreachable: [] })).toMatch(
      /Nothing could be drafted/,
    );
    expect(draftMessage({ drafted: 0, created: 0, failed: 0, unreachable: [] })).toMatch(
      /nobody to draft this to/,
    );
  });
});
