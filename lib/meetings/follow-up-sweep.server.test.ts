/** The follow-up sweep: scheduled sends, nudges and chases, against a fake database. */
const sendEmailMock = jest.fn();
const mailboxMock = jest.fn();
const mandateMock = jest.fn();
const taskMock = jest.fn();
const threadsMock = jest.fn();

jest.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));
jest.mock("@/lib/meetings/mailbox.server", () => ({ mailboxFor: (...a: unknown[]) => mailboxMock(...a) }));
jest.mock("@/lib/mandates", () => ({ getActiveMandateForOrg: (...a: unknown[]) => mandateMock(...a) }));
jest.mock("@/lib/team-tasks", () => ({ createTeamTask: (...a: unknown[]) => taskMock(...a) }));
jest.mock("@/lib/meetings/follow-up-threads.server", () => ({ recordFollowUpThreads: (...a: unknown[]) => threadsMock(...a) }));

import { runFollowUpSweep } from "./follow-up-sweep.server";

type Update = { table: string; patch: Record<string, unknown>; id?: unknown };

function fakeDb(tables: Record<string, unknown[]>) {
  const updates: Update[] = [];
  const db = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "not", "is", "lte", "lt", "in"]) {
        q[m] = (...args: unknown[]) => {
          if (m === "is" || m === "not") filters.push([m, String(args[0]), args[args.length - 1]]);
          if (m === "in") filters.push(["in", String(args[0]), args[1]]);
          return q;
        };
      }
      q.eq = (col: string, val: unknown) => {
        filters.push(["eq", col, val]);
        return q;
      };
      q.maybeSingle = async () => {
        const rows = (tables[table] ?? []) as Record<string, unknown>[];
        const id = filters.find(([op, col]) => op === "eq" && col === "id")?.[2];
        return { data: rows.find((r) => r.id === id) ?? rows[0] ?? null, error: null };
      };
      q.then = (resolve: (v: unknown) => unknown) => {
        let rows = (tables[table] ?? []) as Record<string, unknown>[];
        for (const [op, col, val] of filters) {
          if (op === "eq") rows = rows.filter((r) => r[col] === val);
          if (op === "in") rows = rows.filter((r) => (val as unknown[]).includes(r[col]));
        }
        return resolve({ data: rows, error: null });
      };
      q.update = (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          updates.push({ table, patch, id });
          return { error: null };
        },
      });
      return q;
    },
  };
  return { db, updates };
}

const NOW = new Date("2026-11-10T12:00:00Z");
const base = {
  meeting_id: "m1", organization_id: "o1", created_by: "host", subject: "Follow-up: Dunbar", body: "Hi Ana",
  email: "ana@x.com", name: "Ana", scheduled_for: null, sent_at: null, error: null, nudge_after_days: null,
  nudged_at: null, replied_at: null, created_at: "2026-11-01T00:00:00Z",
};

beforeEach(() => {
  [sendEmailMock, mailboxMock, mandateMock, taskMock, threadsMock].forEach((m) => m.mockReset());
  sendEmailMock.mockResolvedValue({ ok: true });
  mailboxMock.mockResolvedValue({ ok: true, token: "t", email: "host@x.com", source: "member" });
  mandateMock.mockResolvedValue({ autoApprove: ["send_reply"], autonomyCeiling: 2 });
});

it("sends a scheduled follow-up whose time has come, and records it", async () => {
  const { db, updates } = fakeDb({
    live_meeting_followup_sends: [{ ...base, id: "s1", status: "scheduled", scheduled_for: "2026-11-10T11:00:00Z" }],
    principals: [{ id: "host", full_name: "Hana" }],
  });
  const stats = await runFollowUpSweep(db as never, { now: NOW });
  expect(stats.scheduledSent).toBe(1);
  expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: { name: "Ana", email: "ana@x.com" }, subject: "Follow-up: Dunbar" }));
  expect(updates).toContainEqual(expect.objectContaining({ table: "live_meeting_followup_sends", id: "s1", patch: expect.objectContaining({ status: "sent" }) }));
  expect(updates).toContainEqual(expect.objectContaining({ table: "live_meetings", patch: { followup_status: "done" } }));
  expect(threadsMock).toHaveBeenCalled();
});

it("fails a scheduled send with no mailbox, saying why", async () => {
  mailboxMock.mockResolvedValue({ ok: false, problem: "not_connected" });
  const { db, updates } = fakeDb({ live_meeting_followup_sends: [{ ...base, id: "s1", status: "scheduled", scheduled_for: "2026-11-10T11:00:00Z" }] });
  const stats = await runFollowUpSweep(db as never, { now: NOW });
  expect(stats.scheduledFailed).toBe(1);
  expect(sendEmailMock).not.toHaveBeenCalled();
  expect(updates.find((u) => u.id === "s1")!.patch.status).toBe("failed");
});

it("does not send a scheduled follow-up once the firm requires approval", async () => {
  mandateMock.mockResolvedValue(undefined);
  const { db, updates } = fakeDb({ live_meeting_followup_sends: [{ ...base, id: "s1", status: "scheduled", scheduled_for: "2026-11-10T11:00:00Z" }] });
  await runFollowUpSweep(db as never, { now: NOW });
  expect(sendEmailMock).not.toHaveBeenCalled();
  expect(String(updates.find((u) => u.id === "s1")!.patch.error)).toMatch(/approves outbound email/);
});

it("nudges someone who has not replied, once", async () => {
  const { db, updates } = fakeDb({
    live_meeting_followup_sends: [{ ...base, id: "s2", status: "sent", sent_at: "2026-11-06T12:00:00Z", nudge_after_days: 3 }],
    inbox_threads: [],
    principals: [{ id: "host", full_name: "Hana" }],
  });
  const stats = await runFollowUpSweep(db as never, { now: NOW });
  expect(stats.nudged).toBe(1);
  expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ subject: "Re: Follow-up: Dunbar" }));
  expect(updates.find((u) => u.id === "s2")!.patch.nudged_at).toBe(NOW.toISOString());
});

it("leaves someone who replied alone, and marks the reply", async () => {
  const { db, updates } = fakeDb({
    live_meeting_followup_sends: [{ ...base, id: "s2", status: "sent", sent_at: "2026-11-06T12:00:00Z", nudge_after_days: 3 }],
    inbox_threads: [{ id: "t1", counterparty_email: "ana@x.com", meeting_id: "m1" }],
    inbox_messages: [{ thread_id: "t1", occurred_at: "2026-11-07T09:00:00Z", direction: "inbound" }],
  });
  const stats = await runFollowUpSweep(db as never, { now: NOW });
  expect(stats.nudged).toBe(0);
  expect(sendEmailMock).not.toHaveBeenCalled();
  expect(updates.find((u) => u.id === "s2")!.patch.replied_at).toBe("2026-11-07T09:00:00Z");
});

it("gives the host a task instead of nudging where sends need approval", async () => {
  mandateMock.mockResolvedValue(undefined);
  const { db } = fakeDb({
    live_meeting_followup_sends: [{ ...base, id: "s2", status: "sent", sent_at: "2026-11-06T12:00:00Z", nudge_after_days: 3 }],
    inbox_threads: [],
  });
  const stats = await runFollowUpSweep(db as never, { now: NOW });
  expect(stats.nudgeTasks).toBe(1);
  expect(taskMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ assignedTo: "host", meetingId: "m1" }));
  expect(sendEmailMock).not.toHaveBeenCalled();
});

it("chases an overdue action item with its owner", async () => {
  const { db, updates } = fakeDb({
    team_tasks: [{ id: "k1", organization_id: "o1", assigned_to: "u2", title: "Send the model", status: "pending", due_at: "2026-11-06T23:59:00Z", chased_at: null, chase_count: 0, meeting_id: "m1" }],
    principals: [{ id: "u2", full_name: "Ana Ruiz", email: "ana@fund.com" }],
    live_meetings: [{ id: "m1", title: "Dunbar", room_code: "abc-def" }],
  });
  const stats = await runFollowUpSweep(db as never, { now: NOW });
  expect(stats.chased).toBe(1);
  const call = sendEmailMock.mock.calls[0][0];
  expect(call.to.email).toBe("ana@fund.com");
  expect(call.subject).toBe("Overdue: Send the model");
  expect(call.htmlBody).toContain("/meetings/abc-def/report");
  expect(updates).toContainEqual(expect.objectContaining({ table: "team_tasks", id: "k1", patch: expect.objectContaining({ chase_count: 1 }) }));
});
