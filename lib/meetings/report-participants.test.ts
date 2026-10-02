import {
  followUpState,
  followUpStateLabel,
  linkActionItems,
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
