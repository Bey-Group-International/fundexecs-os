import {
  chaseDue,
  chaseEmail,
  cleanInstruction,
  cleanNudgeDays,
  cleanSendAt,
  cleanTemplateBody,
  cleanTemplateName,
  deliveryLines,
  dueFromText,
  externalRecipients,
  followUpQueue,
  fillTemplate,
  isTone,
  itemsFor,
  nudgeDue,
  nudgeEmail,
  withPersonalItems,
  type SendRow,
} from "./follow-up-loop";

describe("tone and instructions", () => {
  it("knows the tones", () => {
    expect(isTone("warm")).toBe(true);
    expect(isTone("angry")).toBe(false);
  });
  it("cleans an instruction", () => {
    expect(cleanInstruction("  shorter\nplease ")).toBe("shorter please");
    expect(cleanInstruction("   ")).toBeNull();
    expect(cleanInstruction("x".repeat(400))!.length).toBe(300);
  });
});

describe("templates", () => {
  const ctx = { meetingTitle: "Dunbar Q4", hostName: "Hana", summary: "We agreed terms.", decisions: ["Proceed to DD"], actionItems: ["Ana: send model", "Ben: book site visit"] };
  it("fills the meeting in and leaves the first name for the send", () => {
    const out = fillTemplate("Hi {{first_name}},\n\nThanks for {{meeting_title}}.\n\n{{summary}}\n\nDecisions:\n{{decisions}}\n\nNext:\n{{action_items}}\n\n{{host_name}}", ctx);
    expect(out).toBe("Hi {{first_name}},\n\nThanks for Dunbar Q4.\n\nWe agreed terms.\n\nDecisions:\n- Proceed to DD\n\nNext:\n1. Ana: send model\n2. Ben: book site visit\n\nHana");
  });
  it("drops a line whose token has nothing to fill", () => {
    expect(fillTemplate("Thanks.\n{{decisions}}\nBest", { ...ctx, decisions: [] })).toBe("Thanks.\nBest");
  });
  it("cleans names and bodies", () => {
    expect(cleanTemplateName("  LP update ")).toBe("LP update");
    expect(cleanTemplateName("")).toBeNull();
    expect(cleanTemplateBody("a\r\nb")).toBe("a\nb");
    expect(cleanTemplateBody("x".repeat(10_001))).toBeNull();
  });
});

describe("each reader's own next steps", () => {
  const items = ["Ana Ruiz: send the model", "Ben: book the site visit", "Team: review the deck", "ana: confirm the date"];
  it("matches by full name, first name and address", () => {
    expect(itemsFor({ name: "Ana Ruiz", email: "ana@x.com" }, items)).toEqual(["send the model", "confirm the date"]);
    expect(itemsFor({ name: "Benjamin Cole", email: "ben@x.com" }, items)).toEqual(["book the site visit"]);
  });
  it("matches a shared first name to nobody", () => {
    const everyone = [{ name: "Ana Ruiz", email: "a1@x.com" }, { name: "Ana Lopez", email: "a2@x.com" }];
    expect(itemsFor(everyone[1], ["ana: confirm the date"], everyone)).toEqual([]);
    expect(itemsFor(everyone[0], ["Ana Ruiz: send it"], everyone)).toEqual(["send it"]);
  });
  it("puts the block before the sign-off, or at the end", () => {
    const body = "Hi Ana,\n\nThanks for today.\n\nBest,\nHana";
    expect(withPersonalItems(body, ["send the model"])).toBe("Hi Ana,\n\nThanks for today.\n\nYour next steps from this meeting:\n- send the model\n\nBest,\nHana");
    expect(withPersonalItems("Hi.\n\nSee you soon.", ["x"])).toBe("Hi.\n\nSee you soon.\n\nYour next steps from this meeting:\n- x");
    expect(withPersonalItems(body, [])).toBe(body);
  });
});

describe("dueFromText", () => {
  const wed = new Date("2026-11-04T15:00:00Z"); // a Wednesday
  it("reads the common ways a date is said", () => {
    expect(dueFromText("Ana: send the model by Friday", wed)).toBe("2026-11-06T23:59:00.000Z");
    expect(dueFromText("send it tomorrow", wed)).toBe("2026-11-05T23:59:00.000Z");
    expect(dueFromText("by end of week", wed)).toBe("2026-11-06T23:59:00.000Z");
    expect(dueFromText("circulate next week", wed)).toBe("2026-11-13T23:59:00.000Z");
    expect(dueFromText("due Nov 12", wed)).toBe("2026-11-12T23:59:00.000Z");
    expect(dueFromText("by 11/20", wed)).toBe("2026-11-20T23:59:00.000Z");
    expect(dueFromText("by Jan 3", wed)).toBe("2027-01-03T23:59:00.000Z");
    expect(dueFromText("by Wednesday", wed)).toBe("2026-11-11T23:59:00.000Z");
  });
  it("says nothing when the text does not", () => {
    expect(dueFromText("Ana: send the model", wed)).toBeNull();
    expect(dueFromText("by Feb 31", wed)).toBeNull();
    expect(dueFromText("sunday roast", wed)).toBeNull();
  });
});

describe("review before send", () => {
  const people = [{ email: "ana@fund.com" }, { email: "lp@pension.org" }, { email: null }];
  it("flags addresses outside the host's firm", () => {
    expect(externalRecipients(people, "hana@fund.com")).toEqual([{ email: "lp@pension.org" }]);
  });
  it("flags nobody for a host on a personal address", () => {
    expect(externalRecipients(people, "hana@gmail.com")).toEqual([]);
    expect(externalRecipients(people, null)).toEqual([]);
  });
});

describe("schedule and nudge", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it("accepts only the offered nudge delays", () => {
    expect(cleanNudgeDays(3)).toBe(3);
    expect(cleanNudgeDays("5")).toBe(5);
    expect(cleanNudgeDays(4)).toBeNull();
  });
  it("reads a send time as now, later, or unusable", () => {
    expect(cleanSendAt(undefined, now)).toBeNull();
    expect(cleanSendAt(new Date(now + 60_000).toISOString(), now)).toBeNull();
    expect(cleanSendAt(new Date(now + 3_600_000).toISOString(), now)).toEqual(new Date(now + 3_600_000));
    expect(cleanSendAt(new Date(now - 3_600_000).toISOString(), now)).toBeUndefined();
    expect(cleanSendAt(new Date(now + 40 * 86_400_000).toISOString(), now)).toBeUndefined();
    expect(cleanSendAt("soon", now)).toBeUndefined();
  });
  it("nudges only an unanswered send that has waited long enough, once", () => {
    const row = { status: "sent" as const, sent_at: "2026-11-03T12:00:00Z", nudge_after_days: 3, nudged_at: null, replied_at: null };
    expect(nudgeDue(row, now)).toBe(true);
    expect(nudgeDue({ ...row, nudge_after_days: 5 }, now)).toBe(false);
    expect(nudgeDue({ ...row, replied_at: "2026-11-04T00:00:00Z" }, now)).toBe(false);
    expect(nudgeDue({ ...row, nudged_at: "2026-11-06T00:00:00Z" }, now)).toBe(false);
    expect(nudgeDue({ ...row, nudge_after_days: null }, now)).toBe(false);
  });
  it("writes a short nudge on the same subject", () => {
    const n = nudgeEmail({ name: "Ana Ruiz", subject: "Follow-up: Dunbar", hostName: "Hana" });
    expect(n.subject).toBe("Re: Follow-up: Dunbar");
    expect(n.body.startsWith("Hi Ana,")).toBe(true);
    expect(n.body.endsWith("Best,\nHana")).toBe(true);
    expect(nudgeEmail({ name: null, subject: "Re: x", hostName: null }).subject).toBe("Re: x");
  });
});

describe("deliveryLines", () => {
  const row = (over: Partial<SendRow>): SendRow => ({
    id: "1", email: "ana@x.com", name: "Ana", status: "sent", scheduled_for: null, sent_at: "2026-11-06T10:00:00Z",
    error: null, nudge_after_days: null, nudged_at: null, replied_at: null, created_at: "2026-11-06T10:00:00Z", ...over,
  });
  it("shows each person's latest send, read for the host", () => {
    const lines = deliveryLines([
      row({ id: "a", status: "failed", error: "bounced", sent_at: null, created_at: "2026-11-06T09:00:00Z" }),
      row({ id: "b", replied_at: "2026-11-06T11:00:00Z" }),
      row({ id: "c", email: "ben@x.com", name: "Ben", nudged_at: "2026-11-06T11:30:00Z" }),
      row({ id: "d", email: "cy@x.com", name: "Cy", status: "scheduled", sent_at: null, scheduled_for: "2026-11-07T09:00:00Z" }),
    ]);
    expect(lines.map((l) => [l.name, l.state, l.at])).toEqual([
      ["Ana", "replied", "2026-11-06T11:00:00Z"],
      ["Ben", "nudged", "2026-11-06T11:30:00Z"],
      ["Cy", "scheduled", "2026-11-07T09:00:00Z"],
    ]);
  });
});

describe("chasing", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const task = { status: "pending", due_at: "2026-11-06T23:59:00Z", chased_at: null, chase_count: 0 };
  it("chases an overdue open item, every three days, three times at most", () => {
    expect(chaseDue(task, now)).toBe(true);
    expect(chaseDue({ ...task, chased_at: "2026-11-09T12:00:00Z", chase_count: 1 }, now)).toBe(false);
    expect(chaseDue({ ...task, chased_at: "2026-11-07T12:00:00Z", chase_count: 1 }, now)).toBe(true);
    expect(chaseDue({ ...task, chase_count: 3 }, now)).toBe(false);
    expect(chaseDue({ ...task, status: "completed" }, now)).toBe(false);
    expect(chaseDue({ ...task, due_at: "2026-11-12T00:00:00Z" }, now)).toBe(false);
    expect(chaseDue({ ...task, due_at: null }, now)).toBe(false);
  });
  it("writes the reminder", () => {
    const e = chaseEmail({ ownerName: "Ana Ruiz", title: "Send the model", meetingTitle: "Dunbar", dueAt: "2026-11-06T23:59:00Z", link: "https://x/tasks" });
    expect(e.subject).toBe("Overdue: Send the model");
    expect(e.body).toContain('from "Dunbar" was due Nov 6');
    expect(e.body).toContain("https://x/tasks");
  });
});

describe("followUpQueue", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const m = (id: string, status: string | null, ended = "2026-11-05T12:00:00Z") => ({ id, title: id, room_code: id, ended_at: ended, followup_status: status });
  const meetings = [m("a", "draft"), m("b", "done"), m("c", "pending_approval"), m("d", null, "2026-11-08T12:00:00Z"), m("e", "done")];
  it("groups what the host still owes", () => {
    const q = followUpQueue(
      meetings,
      [
        { meeting_id: "b", email: "ana@x.com", name: "Ana", status: "sent", sent_at: "2026-11-06T12:00:00Z", scheduled_for: null, replied_at: null, created_at: "2026-11-06T12:00:00Z" },
        { meeting_id: "b", email: "ben@x.com", name: "Ben", status: "sent", sent_at: "2026-11-06T12:00:00Z", scheduled_for: null, replied_at: "2026-11-07T00:00:00Z", created_at: "2026-11-06T12:00:00Z" },
        { meeting_id: "b", email: "cy@x.com", name: "Cy", status: "sent", sent_at: "2026-11-10T00:00:00Z", scheduled_for: null, replied_at: null, created_at: "2026-11-10T00:00:00Z" },
        { meeting_id: "e", email: "di@x.com", name: "Di", status: "scheduled", sent_at: null, scheduled_for: "2026-11-11T09:00:00Z", replied_at: null, created_at: "2026-11-09T00:00:00Z" },
      ],
      [
        { id: "t1", title: "Send model", due_at: "2026-11-07T23:59:00Z", status: "pending", meeting_id: "a", assignee: "Ana" },
        { id: "t2", title: "Done thing", due_at: "2026-11-07T23:59:00Z", status: "completed", meeting_id: "a", assignee: null },
        { id: "t3", title: "Later", due_at: "2026-11-20T23:59:00Z", status: "pending", meeting_id: "a", assignee: null },
      ],
      now,
    );
    expect(q.notSent.map((x) => x.id)).toEqual(["d", "a"]);
    expect(q.awaiting.map((x) => [x.name, x.days])).toEqual([["Ana", 4]]);
    expect(q.scheduled).toEqual([expect.objectContaining({ count: 1, at: "2026-11-11T09:00:00Z" })]);
    expect(q.overdue.map((t) => [t.title, t.daysLate])).toEqual([["Send model", 2]]);
  });
});
