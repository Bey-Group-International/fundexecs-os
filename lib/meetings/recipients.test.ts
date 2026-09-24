import {
  deliveryMessage,
  deliveryOutcome,
  everyoneReached,
  failedNotice,
  meetingRecipients,
  unreachableNotice,
} from "@/lib/meetings/recipients";

describe("meetingRecipients", () => {
  // The defect this file exists for. An instant meeting is created with
  // `attendees: []`, so both email paths refused to send anything at all —
  // while live_meeting_participants held a row for everyone who was in it.
  it("emails the room when nothing was ever on the invitation", () => {
    const { recipients } = meetingRecipients({
      invited: [],
      present: [
        { name: "Sarah Chen", email: "sarah@fund.test" },
        { name: "Mike Doyle", email: "mike@fund.test" },
      ],
      senderEmail: "host@fund.test",
    });

    expect(recipients).toEqual([
      { name: "Sarah Chen", email: "sarah@fund.test" },
      { name: "Mike Doyle", email: "mike@fund.test" },
    ]);
  });

  it("reaches somebody who was invited and did not come", () => {
    // A summary of the meeting you were invited to is still yours.
    const { recipients } = meetingRecipients({
      invited: [{ name: "Priya Raman", email: "priya@fund.test" }],
      present: [],
      senderEmail: "host@fund.test",
    });
    expect(recipients).toEqual([{ name: "Priya Raman", email: "priya@fund.test" }]);
  });

  it("reaches somebody who came and was not invited", () => {
    const { recipients } = meetingRecipients({
      invited: [{ name: "Priya Raman", email: "priya@fund.test" }],
      present: [{ name: "Walk In", email: "walkin@fund.test" }],
      senderEmail: "host@fund.test",
    });
    expect(recipients.map((r) => r.email)).toEqual(["priya@fund.test", "walkin@fund.test"]);
  });

  it("writes to somebody once when they were both invited and there", () => {
    const { recipients } = meetingRecipients({
      invited: [{ name: "Sarah Chen", email: "Sarah@Fund.test" }],
      present: [{ name: "Sarah Chen", email: "sarah@fund.test" }],
      senderEmail: null,
    });
    expect(recipients).toHaveLength(1);
  });

  it("keeps the invitation's ordering", () => {
    const { recipients } = meetingRecipients({
      invited: [
        { name: "B", email: "b@fund.test" },
        { name: "A", email: "a@fund.test" },
      ],
      present: [{ name: "C", email: "c@fund.test" }],
    });
    expect(recipients.map((r) => r.email)).toEqual(["b@fund.test", "a@fund.test", "c@fund.test"]);
  });

  it("leaves the sender out of their own email", () => {
    // The host is always in the room, so without this every summary they send
    // puts a copy of their own meeting in their own inbox.
    const { recipients } = meetingRecipients({
      invited: [{ name: "Host", email: "host@fund.test" }],
      present: [{ name: "Host", email: "HOST@fund.test" }],
      senderEmail: "  Host@Fund.test ",
    });
    expect(recipients).toEqual([]);
  });

  // The report email built a To: name out of the address — "j.smith" — while
  // the follow-up used the real one. Two paths through the same data disagreed
  // about what to call the same person.
  it("prefers a real name over an address used as one", () => {
    const fromDirectory = meetingRecipients({
      invited: [{ name: "", email: "sarah@fund.test" }],
      present: [{ name: "Sarah Chen", email: "sarah@fund.test" }],
    });
    expect(fromDirectory.recipients[0]).toEqual({ name: "Sarah Chen", email: "sarah@fund.test" });

    const fromInvite = meetingRecipients({
      invited: [{ name: "Sarah Chen", email: "sarah@fund.test" }],
      present: [{ name: "", email: "sarah@fund.test" }],
    });
    expect(fromInvite.recipients[0].name).toBe("Sarah Chen");
  });

  it("falls back to the address when nobody knows a name", () => {
    const { recipients } = meetingRecipients({ invited: [{ name: "", email: "x@fund.test" }] });
    expect(recipients[0].name).toBe("x@fund.test");
  });

  describe("people it cannot reach", () => {
    it("names a guest who was in the room without an address", () => {
      // Dropped silently before this, so the send reported "Sent to 1
      // attendee" for a meeting of two and read as complete.
      const set = meetingRecipients({
        present: [
          { name: "Sarah Chen", email: "sarah@fund.test" },
          { name: "Dana (guest)", email: null },
        ],
        senderEmail: "host@fund.test",
      });
      expect(set.recipients).toHaveLength(1);
      expect(set.unreachable).toEqual(["Dana (guest)"]);
    });

    it("does not call somebody unreachable when the mail is going to them", () => {
      // A signed-in attendee whose directory row could not be read comes back
      // with no address — but they are on the invitation, so they are being
      // written to and saying they were missed would be false.
      const set = meetingRecipients({
        invited: [{ name: "Sarah Chen", email: "sarah@fund.test" }],
        present: [{ name: "Sarah Chen", email: null }],
      });
      expect(set.recipients).toHaveLength(1);
      expect(set.unreachable).toEqual([]);
    });

    it("does not report the sender as unreachable", () => {
      const set = meetingRecipients({
        present: [{ name: "host@fund.test", email: null }],
        senderEmail: "host@fund.test",
      });
      expect(set.unreachable).toEqual([]);
    });

    it("names a guest once however many rows they left", () => {
      const set = meetingRecipients({
        present: [
          { name: "Dana", email: null },
          { name: "dana", email: null },
        ],
      });
      expect(set.unreachable).toEqual(["Dana"]);
    });

    it("ignores an attendance row with no name at all", () => {
      const set = meetingRecipients({ present: [{ name: "   ", email: null }] });
      expect(set.unreachable).toEqual([]);
    });
  });

  // The regression this replaced: routing the stored column through
  // `normalizeAttendees` first. That function answers "is this request body
  // acceptable?" and answers it by rejecting the WHOLE array, so one row written
  // by an older schema would have cost every other invited person their copy.
  it("keeps the rest of the invite list when one entry is malformed", () => {
    const { recipients } = meetingRecipients({
      invited: [
        { nonsense: true },
        { name: "Sarah Chen", email: "sarah@fund.test" },
        null,
        42,
      ],
    });
    expect(recipients).toEqual([{ name: "Sarah Chen", email: "sarah@fund.test" }]);
  });

  it("reads an attendee stored as a bare address", () => {
    // The column has been through several schema versions and `attendeeNames`
    // already reads that shape; the recipient list must not be the one place
    // that cannot.
    expect(meetingRecipients({ invited: ["sarah@fund.test"] }).recipients).toEqual([
      { name: "sarah@fund.test", email: "sarah@fund.test" },
    ]);
  });

  it("refuses to hand a mailer something that is not an address", () => {
    // Last stop between stored jsonb and an outgoing message. "Was validated
    // once by a previous version of the write path" is not the same claim as
    // "is an address".
    const { recipients } = meetingRecipients({
      invited: [{ name: "Priya", email: "priya (ask Sam)" }, { name: "No domain", email: "nope@nope" }],
      present: [{ name: "Ravi", email: "ravi at fund dot test" }],
    });
    expect(recipients).toEqual([]);
    // And they are not reported as unreachable from the invite list either:
    // being un-addressable on an invitation is not the same as having been in
    // the room with nobody able to reach you.
    expect(meetingRecipients({ invited: [{ name: "Priya", email: "x" }] }).unreachable).toEqual([]);
  });

  it("survives malformed stored data", () => {
    // `attendees` is jsonb and `present` is assembled from two queries; neither
    // is worth throwing an export or an email away over.
    expect(
      meetingRecipients({
        invited: "not an array",
        present: [undefined as never, null as never],
      }).recipients,
    ).toEqual([]);
    expect(meetingRecipients({}).recipients).toEqual([]);
    expect(meetingRecipients({ invited: null, present: null }).unreachable).toEqual([]);
    expect(meetingRecipients({ invited: { name: "A" } }).recipients).toEqual([]);
  });
});

describe("everyoneReached", () => {
  const withGuest = meetingRecipients({
    present: [
      { name: "A", email: "a@fund.test" },
      { name: "Dana", email: null },
    ],
  });
  const allAddressable = meetingRecipients({
    present: [
      { name: "A", email: "a@fund.test" },
      { name: "B", email: "b@fund.test" },
    ],
  });

  // The bound has to be derived from what it bounds: "done" meant every
  // ADDRESS succeeded, so a meeting whose guests were never written to at all
  // was marked followed up and dropped off the list that still needed a person.
  it("is false while somebody in the room was never written to", () => {
    expect(everyoneReached(withGuest, 1)).toBe(false);
  });

  it("is true when every person in the meeting heard from the host", () => {
    expect(everyoneReached(allAddressable, 2)).toBe(true);
  });

  it("is false on a partial send", () => {
    expect(everyoneReached(allAddressable, 1)).toBe(false);
  });

  it("is false when there was nobody at all", () => {
    expect(everyoneReached({ recipients: [], unreachable: [] }, 0)).toBe(false);
  });
});

describe("unreachableNotice", () => {
  it("says nothing when everybody had an address", () => {
    expect(unreachableNotice([])).toBeNull();
  });

  it("names one person", () => {
    expect(unreachableNotice(["Dana"])).toBe(
      "Dana was in the room without an email address here, so they were not sent to.",
    );
  });

  it("names a few", () => {
    expect(unreachableNotice(["Dana", "Ravi"])).toContain("Dana, Ravi were");
  });

  it("stops naming and starts counting", () => {
    // A list of eleven names is not a sentence anybody reads.
    expect(unreachableNotice(["A", "B", "C", "D", "E"])).toContain("A, B, C and 2 others");
    expect(unreachableNotice(["A", "B", "C", "D"])).toContain("A, B, C and 1 other");
  });
});

describe("deliveryOutcome", () => {
  const recipients = [
    { name: "A", email: "a@fund.test" },
    { name: "B", email: "b@fund.test" },
    { name: "C", email: "c@fund.test" },
  ];

  const settled = (...values: unknown[]): PromiseSettledResult<unknown>[] =>
    values.map((value) =>
      value instanceof Error
        ? ({ status: "rejected", reason: value } as PromiseSettledResult<unknown>)
        : ({ status: "fulfilled", value } as PromiseSettledResult<unknown>),
    );

  it("counts the sends that went", () => {
    expect(deliveryOutcome(recipients, settled({ ok: true }, { ok: true }, { ok: true }))).toEqual({
      sent: 3,
      failed: [],
    });
  });

  // The part the host can act on: which address to chase, not how many.
  it("names the addresses that did not", () => {
    expect(
      deliveryOutcome(recipients, settled({ ok: true }, { ok: false }, new Error("bounced"))),
    ).toEqual({ sent: 1, failed: ["b@fund.test", "c@fund.test"] });
  });

  it("treats a missing result as a failure rather than a success", () => {
    // A short results array can only mean the fan-out did not cover everybody,
    // and counting the gap as delivered would report a send that never happened.
    expect(deliveryOutcome(recipients, settled({ ok: true }))).toEqual({
      sent: 1,
      failed: ["b@fund.test", "c@fund.test"],
    });
  });

  it("does not read a send with no ok as having worked", () => {
    expect(deliveryOutcome(recipients.slice(0, 1), settled(null)).failed).toEqual(["a@fund.test"]);
    expect(deliveryOutcome(recipients.slice(0, 1), settled({})).failed).toEqual(["a@fund.test"]);
  });
});

describe("deliveryMessage", () => {
  it("says a clean send plainly", () => {
    expect(deliveryMessage({ sent: 3, total: 3 })).toBe("Sent to 3 attendees.");
    expect(deliveryMessage({ sent: 1, total: 1 })).toBe("Sent to 1 attendee.");
  });

  it("names the addresses that bounced", () => {
    expect(deliveryMessage({ sent: 1, total: 2, failed: ["b@fund.test"] })).toBe(
      "Sent to 1 of 2 attendees. Could not deliver to b@fund.test.",
    );
  });

  // The defect this replaces: "Sent to 2 attendees." for a meeting of four,
  // which is a complete-sounding answer to a send that reached half the room.
  it("says who was never written to at all", () => {
    expect(deliveryMessage({ sent: 2, total: 2, unreachable: ["Dana", "Ravi"] })).toBe(
      "Sent to 2 attendees. Dana, Ravi were in the room without an email address here, so they were not sent to.",
    );
  });

  it("reports a send that reached nobody as reaching nobody", () => {
    expect(deliveryMessage({ sent: 0, total: 2, failed: ["a@f.test", "b@f.test"] })).toContain(
      "It reached nobody.",
    );
  });

  it("takes the screen's own word for the people", () => {
    expect(deliveryMessage({ sent: 2, total: 2, noun: "person" })).toBe("Sent to 2 persons.");
  });
});

describe("failedNotice", () => {
  it("says nothing when everything went", () => {
    expect(failedNotice([])).toBeNull();
  });

  it("stops naming and starts counting", () => {
    expect(failedNotice(["a", "b", "c", "d"])).toBe("Could not deliver to a, b, c and 1 other.");
  });
});
