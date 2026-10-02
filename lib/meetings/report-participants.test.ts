import {
  followUpState,
  followUpStateLabel,
  linkActionItems,
  presenceFromSpeech,
  reportParticipants,
} from "@/lib/meetings/report-participants";

describe("reportParticipants", () => {
  const host = { name: "Alex Rivera", email: "alex@fund.test" };

  it("puts the host first and never as a recipient", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [
        { name: "Alex Rivera", email: "alex@fund.test" },
        { name: "Jane Doe", email: "jane@lp.test" },
      ],
    });
    expect(people[0]).toMatchObject({ name: "Alex Rivera", role: "host", receivesFollowUp: false });
    expect(people[1]).toMatchObject({ name: "Jane Doe", role: "invitee", attended: true, receivesFollowUp: true });
  });

  it("tells invitees who never joined from people who came uninvited", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [{ name: "Mark", email: "mark@fund.test" }],
    });
    expect(people.find((p) => p.name === "Jane Doe")).toMatchObject({ role: "invitee", attended: false });
    expect(people.find((p) => p.name === "Mark")).toMatchObject({ role: "attendee", attended: true });
  });

  it("lists a guest with no address, who the follow-up cannot reach", () => {
    const people = reportParticipants({ host, invited: [], present: [{ name: "Guest", email: null }] });
    expect(people.find((p) => p.name === "Guest")).toMatchObject({ email: null, receivesFollowUp: false });
  });
});

/**
 * The reported bug: "says invitee did not join when they did".
 *
 * Attendance was matched on ADDRESS alone, and `live_meeting_participants` has
 * no address on it — `recipients.server.ts` fills one in from `principals`,
 * which it can only do for somebody who was signed in. So an invitee who opened
 * the link without signing in had a row in the room with `email: null`, and the
 * report told the host they had not joined a meeting the host had just spent an
 * hour in with them.
 *
 * The worst kind of defect: a confident false statement about a fact the reader
 * cannot check from the page.
 */
describe("reportParticipants attendance", () => {
  const host = { name: "Alex Rivera", email: "alex@fund.test" };

  it("counts an invitee who joined as a guest, by the only identity the room has", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [
        { name: "Alex Rivera", email: "alex@fund.test" },
        // Clicked the link, never signed in: a display name and no address.
        { name: "Jane Doe", email: null },
      ],
    });
    const jane = people.filter((p) => p.name === "Jane Doe");
    // Once, as the invitee she is — not twice, as an absent invitee plus an
    // anonymous attendee.
    expect(jane).toHaveLength(1);
    expect(jane[0]).toMatchObject({ role: "invitee", attended: true, email: "jane@lp.test" });
  });

  it("matches a guest name case- and space-insensitively", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [{ name: "  jane doe ", email: null }],
    });
    expect(people.find((p) => p.email === "jane@lp.test")).toMatchObject({ attended: true });
  });

  /**
   * The honest middle answer. A room with somebody in it nobody can identify
   * might contain this invitee under a name nothing matches, so "did not join"
   * is a claim the data does not support. The page prints nothing for null.
   */
  it("will not claim an absence while somebody in the room is unaccounted for", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [
        { name: "Alex Rivera", email: "alex@fund.test" },
        { name: "sarah's iPhone", email: null },
      ],
    });
    expect(people.find((p) => p.email === "jane@lp.test")?.attended).toBeNull();
  });

  /** Still says so when it really knows: every row pinned to an address. */
  it("says an invitee did not join when the whole room is identified", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [
        { name: "Alex Rivera", email: "alex@fund.test" },
        { name: "Mark", email: "mark@fund.test" },
      ],
    });
    expect(people.find((p) => p.email === "jane@lp.test")).toMatchObject({ attended: false });
  });

  /**
   * One guest claimed by one invitee must not make the rest of the list
   * unknown. This is what the two-pass claim tracking buys: a report that still
   * tells the host which invitations went unanswered.
   */
  it("keeps telling absences apart once every guest is accounted for", () => {
    const people = reportParticipants({
      host,
      invited: [
        { name: "Jane Doe", email: "jane@lp.test" },
        { name: "Omar Haddad", email: "omar@lp.test" },
      ],
      present: [
        { name: "Alex Rivera", email: "alex@fund.test" },
        { name: "Jane Doe", email: null },
      ],
    });
    expect(people.find((p) => p.email === "jane@lp.test")).toMatchObject({ attended: true });
    expect(people.find((p) => p.email === "omar@lp.test")).toMatchObject({ attended: false });
  });

  /**
   * A row that resolved to an address is fully identified, and its name must not
   * be lent to anybody else. Two people called Jane Doe is not evidence that
   * the invited one was there.
   */
  it("does not lend an identified attendee's name to a different address", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [
        { name: "Alex Rivera", email: "alex@fund.test" },
        { name: "Jane Doe", email: "jane.doe@other.test" },
      ],
    });
    expect(people.find((p) => p.email === "jane@lp.test")).toMatchObject({ attended: false });
    expect(people.find((p) => p.email === "jane.doe@other.test")).toMatchObject({
      role: "attendee",
      attended: true,
    });
  });

  it("counts a host who joined as a guest", () => {
    const people = reportParticipants({
      host,
      invited: [],
      present: [{ name: "Alex Rivera", email: null }],
    });
    expect(people[0]).toMatchObject({ role: "host", attended: true });
  });

  /**
   * The host keeps the benefit of the doubt, deliberately. Not every path that
   * creates a meeting writes the host a participant row, so "the host didn't
   * join their own meeting" would be a claim resting on a row that may never
   * exist.
   */
  it("never tells the host they did not join their own meeting", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [{ name: "Jane Doe", email: "jane@lp.test" }],
    });
    expect(people[0]).toMatchObject({ role: "host" });
    expect(people[0].attended).toBeNull();
  });

  /** A meeting held before attendance rows were kept knows nothing, not nobody. */
  it("knows nothing when no attendance was recorded at all", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [],
    });
    expect(people.find((p) => p.email === "jane@lp.test")?.attended).toBeNull();
  });

  /**
   * A row with no name at all. Neither loader can produce one today —
   * `loadPresentPeople` calls a blank name "Guest" and `presenceFromSpeech`
   * drops it — but this is a public pure function and the branch is the one
   * place a caller's nameless row could otherwise be read as nobody at all.
   */
  it("cannot account for a row with no identity whatsoever", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [
        { name: "Alex Rivera", email: "alex@fund.test" },
        { name: "", email: null },
      ],
    });
    expect(people.find((p) => p.email === "jane@lp.test")?.attended).toBeNull();
  });

  /** `loadPresentPeople` names a blank display name "Guest", and a row called
   *  Guest could be anybody — including the invitee. */
  it("treats an unnamed guest as somebody it cannot account for", () => {
    const people = reportParticipants({
      host,
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      present: [
        { name: "Alex Rivera", email: "alex@fund.test" },
        { name: "Guest", email: null },
      ],
    });
    expect(people.find((p) => p.email === "jane@lp.test")?.attended).toBeNull();
  });
});

describe("followUpState", () => {
  it("is sent only once everyone was reached", () => {
    expect(followUpState({ hasDraft: true, followupStatus: "done", draftedThreads: 0 })).toEqual({ kind: "sent" });
    expect(followUpState({ hasDraft: true, followupStatus: "draft", draftedThreads: 2 })).toEqual({
      kind: "drafted",
      threads: 2,
    });
    expect(followUpState({ hasDraft: true, followupStatus: "draft", draftedThreads: 0 })).toEqual({ kind: "not_sent" });
    expect(followUpState({ hasDraft: false, followupStatus: "not_started", draftedThreads: 0 })).toEqual({ kind: "none" });
  });

  it("labels each state", () => {
    expect(followUpStateLabel({ kind: "drafted", threads: 2 })).toBe("Drafted in inbox (2)");
    expect(followUpStateLabel({ kind: "not_sent" })).toBe("Not sent");
  });
});

describe("linkActionItems", () => {
  const task = {
    id: "t1",
    title: "Send the deck",
    status: "completed",
    dueAt: "2026-10-09T00:00:00Z",
    assignedTo: "u-sarah",
    assigneeName: "Sarah Chen",
    actionItem: "Sarah: Send the deck",
  };

  it("matches an item to the task it became and reads its state", () => {
    const [item] = linkActionItems(["Sarah: Send the deck"], [task]);
    expect(item).toMatchObject({
      task: "Send the deck",
      owner: "Sarah",
      done: true,
      taskId: "t1",
      dueAt: "2026-10-09T00:00:00Z",
      assignedTo: "u-sarah",
    });
  });

  it("leaves an item with no task untickable", () => {
    const [item] = linkActionItems(["Book the follow-up call"], [task]);
    expect(item).toMatchObject({ taskId: null, done: false, owner: null });
  });
});

/**
 * The other half of "says invitee did not join when they did", and the one the
 * matching rule above cannot reach.
 *
 * `live_meeting_participants` has an RLS policy of `user_id = auth.uid()` and
 * the join path writes a row only `if (user)`, so an unauthenticated guest
 * leaves NO attendance row anywhere. The transcript is where they survive:
 * lines go through an API route rather than straight to the table, and
 * `speaker` is the name they chose at the door.
 */
describe("presenceFromSpeech", () => {
  it("finds a guest who spoke but could not be recorded as a participant", () => {
    const people = presenceFromSpeech([
      { speaker: "Jane Doe", speaker_user_id: null },
      { speaker: "Jane Doe", speaker_user_id: null },
    ]);
    expect(people).toEqual([{ name: "Jane Doe", email: null }]);
  });

  /**
   * A member already has an attendance row with their DIRECTORY name on it, and
   * `loadPresentPeople` prefers that over the name typed into a join screen. So
   * adding their typed name would introduce an identity nothing can match and
   * turn every known absence into "cannot tell".
   */
  it("leaves out a speaker who has an account behind them", () => {
    expect(presenceFromSpeech([{ speaker: "Alex", speaker_user_id: "u1" }])).toEqual([]);
  });

  it("de-duplicates on case and whitespace, keeping the name as written", () => {
    expect(
      presenceFromSpeech([
        { speaker: "Jane Doe", speaker_user_id: null },
        { speaker: "  jane doe  ", speaker_user_id: null },
      ]),
    ).toEqual([{ name: "Jane Doe", email: null }]);
  });

  it("ignores rows with nothing usable on them", () => {
    expect(
      presenceFromSpeech([
        { speaker: "", speaker_user_id: null },
        { speaker: "   ", speaker_user_id: null },
        { speaker: null, speaker_user_id: null },
        {},
      ]),
    ).toEqual([]);
  });

  /** End to end: the case the host complained about. */
  it("makes the report count an invitee who joined by link and spoke", () => {
    const spoke = presenceFromSpeech([{ speaker: "Jane Doe", speaker_user_id: null }]);
    const people = reportParticipants({
      host: { name: "Alex Rivera", email: "alex@fund.test" },
      invited: [{ name: "Jane Doe", email: "jane@lp.test" }],
      // The attendance table holds only the signed-in host.
      present: [{ name: "Alex Rivera", email: "alex@fund.test" }, ...spoke],
    });
    const jane = people.filter((p) => p.name === "Jane Doe");
    expect(jane).toHaveLength(1);
    expect(jane[0]).toMatchObject({ role: "invitee", attended: true, email: "jane@lp.test" });
  });
});
