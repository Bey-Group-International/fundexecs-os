/**
 * Joining a meeting's attendees to the inbox, and the ways that join can be
 * wrong in a way nobody would notice.
 *
 * The expensive failure here is not an empty panel — it is the panel showing one
 * person's correspondence under another person's name, on a page that reads as a
 * record. So the address rule is tested from both sides (the stored thread and
 * the attendee list), and every near-match is tested to NOT match.
 */
import {
  SUMMARY_MAX,
  THREADS_PER_ATTENDEE,
  attendeeInboxHistory,
  meetingReplySummary,
  historyAddresses,
  threadCounterparty,
  type InboxThreadRow,
} from "./report-inbox";
import type { MeetingRecipient } from "./recipients";

function thread(over: Partial<InboxThreadRow> = {}): InboxThreadRow {
  return {
    id: "t1",
    channel: "gmail",
    subject: "Pacing",
    counterparty_email: "ana@acme.com",
    status: "open",
    unread: false,
    ai_summary: null,
    preview: null,
    last_message_at: "2026-09-20T10:00:00.000Z",
    ...over,
  };
}

const ANA: MeetingRecipient = { name: "Ana Diaz", email: "ana@acme.com" };
const BEN: MeetingRecipient = { name: "Ben Okoro", email: "ben@acme.com" };

describe("which thread belongs to whom", () => {
  it("matches on the address, ignoring case and surrounding space", () => {
    expect(threadCounterparty(thread({ counterparty_email: "  Ana@ACME.com " }))).toBe(
      "ana@acme.com",
    );
  });

  /**
   * Each of these is a plausible stored value and none of them identifies a
   * person. Attributing any of them would file correspondence under somebody who
   * did not send it — and unlike an unmatched thread, that is not recoverable by
   * looking, because the page would read as if it were right.
   */
  it.each([null, "", "   ", "ana", "@acme.com", "ana@", "ana@acme", "ana @acme.com", "a@b.c.", "ana@acme.com, ben@acme.com"])(
    "attributes %p to nobody",
    (value) => {
      expect(threadCounterparty(thread({ counterparty_email: value }))).toBe("");
    },
  );

  it("leaves a thread whose counterparty matches nobody out of every group", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      threads: [thread({ id: "t-none", counterparty_email: null })],
    });
    expect(history.attendees).toEqual([]);
    expect(history.untouched).toEqual([ANA]);
  });

  // The other side of the same rule: the attendee list is normalized too, so a
  // capitalised invite entry still finds a lowercase thread.
  it("matches a capitalised attendee against a lowercase thread", () => {
    const history = attendeeInboxHistory({
      recipients: [{ name: "Ana", email: "Ana@Acme.com" }],
      threads: [thread()],
    });
    expect(history.attendees).toHaveLength(1);
    expect(history.attendees[0].total).toBe(1);
  });
});

describe("the order and the bound", () => {
  it("puts the most recent thread first", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      threads: [
        thread({ id: "old", last_message_at: "2026-01-01T00:00:00.000Z" }),
        thread({ id: "new", last_message_at: "2026-09-01T00:00:00.000Z" }),
        thread({ id: "mid", last_message_at: "2026-05-01T00:00:00.000Z" }),
      ],
    });
    expect(history.attendees[0].threads.map((t) => t.id)).toEqual(["new", "mid", "old"]);
  });

  // A thread with no messages is a real thread, and it is the least interesting
  // one on a page about what was last said.
  it("sorts a thread with no messages last, not first", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      threads: [
        thread({ id: "empty", last_message_at: null }),
        thread({ id: "spoken", last_message_at: "2026-01-01T00:00:00.000Z" }),
      ],
    });
    expect(history.attendees[0].threads.map((t) => t.id)).toEqual(["spoken", "empty"]);
  });

  it("shows at most THREADS_PER_ATTENDEE but counts them all", () => {
    const threads = Array.from({ length: THREADS_PER_ATTENDEE + 4 }, (_, i) =>
      thread({ id: `t${i}`, last_message_at: `2026-0${(i % 9) + 1}-01T00:00:00.000Z` }),
    );
    const history = attendeeInboxHistory({ recipients: [ANA], threads });
    expect(history.attendees[0].threads).toHaveLength(THREADS_PER_ATTENDEE);
    expect(history.attendees[0].total).toBe(THREADS_PER_ATTENDEE + 4);
  });

  /**
   * The bound is on what is DISPLAYED, and these two numbers are read off
   * everything. "Last contact 8 months ago" computed from the five shown threads
   * would be a wrong answer on a page whose entire purpose is that number.
   */
  it("reads last contact and unread from every thread, not the shown ones", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      perAttendee: 1,
      threads: [
        thread({ id: "shown", last_message_at: "2026-09-01T00:00:00.000Z" }),
        thread({ id: "hidden", last_message_at: "2026-08-01T00:00:00.000Z", unread: true }),
      ],
    });
    const ana = history.attendees[0];
    expect(ana.threads.map((t) => t.id)).toEqual(["shown"]);
    expect(ana.lastContactAt).toBe("2026-09-01T00:00:00.000Z");
    expect(ana.unread).toBe(1);
  });

  it("reports no last contact when every thread is empty", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      threads: [thread({ last_message_at: null })],
    });
    expect(history.attendees[0].lastContactAt).toBeNull();
  });

  // The recipient set is already the product's one answer to "who was in this
  // meeting", in invite-then-room order. Re-sorting here would mean the report
  // and the follow-up email disagreed about the order of the same people.
  it("keeps the attendees in the order the recipient set gave them", () => {
    const history = attendeeInboxHistory({
      recipients: [BEN, ANA],
      threads: [thread({ id: "a", counterparty_email: "ana@acme.com" }), thread({ id: "b", counterparty_email: "ben@acme.com" })],
    });
    expect(history.attendees.map((a) => a.email)).toEqual(["ben@acme.com", "ana@acme.com"]);
  });
});

describe("what each row says", () => {
  it("prefers the model's summary over the message preview", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      threads: [thread({ ai_summary: "Wants the Q3 deck", preview: "Hi — following up on" })],
    });
    expect(history.attendees[0].threads[0].summary).toBe("Wants the Q3 deck");
  });

  it("falls back to the preview, and to nothing at all", () => {
    const withPreview = attendeeInboxHistory({
      recipients: [ANA],
      threads: [thread({ ai_summary: "   ", preview: "Hi — following up on" })],
    });
    expect(withPreview.attendees[0].threads[0].summary).toBe("Hi — following up on");

    const withNeither = attendeeInboxHistory({
      recipients: [ANA],
      threads: [thread({ ai_summary: null, preview: "  " })],
    });
    expect(withNeither.attendees[0].threads[0].summary).toBeNull();
  });

  it("bounds the summary rather than shipping a whole thread onto the page", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      threads: [thread({ ai_summary: "x".repeat(SUMMARY_MAX + 50) })],
    });
    const summary = history.attendees[0].threads[0].summary!;
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_MAX + 1);
    expect(summary.endsWith("…")).toBe(true);
  });

  // Slack threads routinely have none, and an empty row reads as a rendering bug.
  it("names a thread that has no subject", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      threads: [thread({ subject: "   " })],
    });
    expect(history.attendees[0].threads[0].subject).toBe("(no subject)");
  });
});

describe("the attendees the inbox has never seen", () => {
  it("lists them rather than dropping them", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA, BEN],
      threads: [thread({ counterparty_email: "ana@acme.com" })],
    });
    expect(history.attendees.map((a) => a.email)).toEqual(["ana@acme.com"]);
    expect(history.untouched).toEqual([BEN]);
  });

  it("does not put an unusable attendee address in either list", () => {
    const history = attendeeInboxHistory({
      recipients: [{ name: "Nobody", email: "not-an-address" }],
      threads: [thread()],
    });
    expect(history.attendees).toEqual([]);
    expect(history.untouched).toEqual([]);
  });

  it("groups a repeated attendee once", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA, { name: "Ana D", email: "ANA@acme.com" }],
      threads: [thread()],
    });
    expect(history.attendees).toHaveLength(1);
    expect(history.untouched).toEqual([]);
  });
});

describe("whether the read was cut short", () => {
  /**
   * The pure rule cannot know: it is handed a list of threads, not the query that
   * produced it. Reporting `capped: true` from here would be a guess, and the
   * loader is the only place that can tell.
   */
  it("is never claimed by the rule itself", () => {
    const history = attendeeInboxHistory({ recipients: [ANA], threads: [thread()] });
    expect(history.capped).toBe(false);
  });
});

describe("the addresses the query asks for", () => {
  /**
   * These are handed straight to `.in("counterparty_email_lower", …)`. If this
   * returned the raw values, the query would compare mixed case against a
   * lowercased column and find nothing — the failure the generated column in
   * migration 20260930180000 exists to prevent, reintroduced above it.
   */
  it("are lowercased, de-duplicated, and free of anything that is not an address", () => {
    expect(
      historyAddresses([
        { name: "Ana", email: "Ana@Acme.com" },
        { name: "Ana again", email: "ana@acme.com" },
        { name: "Broken", email: "nope" },
        BEN,
      ]),
    ).toEqual(["ana@acme.com", "ben@acme.com"]);
  });
});

describe("this meeting's follow-up thread", () => {
  it("is marked, and shown first so its replies are the first thing on the report", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      meetingId: "m1",
      threads: [
        thread({ id: "newer", last_message_at: "2026-09-25T00:00:00.000Z" }),
        thread({ id: "followup", meeting_id: "m1", last_message_at: "2026-09-21T00:00:00.000Z" }),
        thread({ id: "other-meeting", meeting_id: "m2", last_message_at: "2026-09-24T00:00:00.000Z" }),
      ],
    });
    const threads = history.attendees[0].threads;
    expect(threads.map((t) => t.id)).toEqual(["followup", "newer", "other-meeting"]);
    expect(threads.map((t) => t.fromThisMeeting)).toEqual([true, false, false]);
  });

  it("marks nothing when the caller does not say which meeting this is", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      threads: [thread({ meeting_id: "m1" })],
    });
    expect(history.attendees[0].threads[0].fromThisMeeting).toBe(false);
  });
});

describe("replies to this meeting", () => {
  it("counts an inbound message after the thread was linked, not one before", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA, BEN],
      meetingId: "m1",
      threads: [
        thread({ id: "a", meeting_id: "m1", meeting_linked_at: "2026-09-20T10:00:00Z", last_inbound_at: "2026-09-21T10:00:00Z" }),
        thread({
          id: "b",
          counterparty_email: "ben@acme.com",
          meeting_id: "m1",
          meeting_linked_at: "2026-09-20T10:00:00Z",
          last_inbound_at: "2026-09-19T10:00:00Z",
        }),
      ],
    });
    expect(history.attendees.map((a) => a.threads[0].replied)).toEqual([true, false]);
    expect(meetingReplySummary(history)).toEqual({ written: 2, replied: 1 });
  });

  it("is never a reply on another meeting's thread", () => {
    const history = attendeeInboxHistory({
      recipients: [ANA],
      meetingId: "m1",
      threads: [thread({ meeting_id: "m2", last_inbound_at: "2026-09-21T10:00:00Z" })],
    });
    expect(history.attendees[0].threads[0].replied).toBe(false);
    expect(meetingReplySummary(history)).toEqual({ written: 0, replied: 0 });
  });
});
