/** The approval card's context, built in a fixed number of reads for any number of cards. */
jest.mock("@/lib/supabase/server", () => ({ hasSupabaseServiceEnv: () => false, createServiceClient: () => null }));

import { fetchFailedInboxMessages, loadMessageApprovals, threadHref } from "./message-approvals.server";

const ROWS: Record<string, unknown[]> = {
  task_events: [{ task_id: "legacy-1", payload: { inbox_thread_id: "t2" } }],
  inbox_threads: [
    { id: "t1", subject: "Follow-up: IC", channel: "gmail", counterparty_name: "Ana Diaz", counterparty_email: "Ana@Acme.com", meeting_id: "m1" },
    { id: "t2", subject: "Intro", channel: "slack", counterparty_name: "Bo", counterparty_email: null, meeting_id: null },
  ],
  live_meetings: [{ id: "m1", title: "Series B sync", room_code: "abc-def" }],
  inbox_messages: [
    { thread_id: "t1", body: "Can you  send\nthe deck?", occurred_at: "2026-10-05T10:00:00Z" },
    { thread_id: "t1", body: "older", occurred_at: "2026-10-01T10:00:00Z" },
  ],
  network_contacts: [{ email: "ana@acme.com", company: "Acme", title: "Partner" }],
  google_calendar_connections: [{ user_id: "author-1", google_email: "host@fund.com", granted_scope: "https://www.googleapis.com/auth/gmail.send" }],
  tasks: [],
};
const reads: string[] = [];
function client() {
  return {
    from: (table: string) => {
      reads.push(table);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "not", "gte", "order", "limit"]) b[m] = () => b;
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: ROWS[table] ?? [], error: null }).then(resolve);
      return b;
    },
  } as never;
}

beforeEach(() => {
  reads.length = 0;
});

it("shows the recipient, reply subject, mailbox, meeting, contact and their last words", async () => {
  const map = await loadMessageApprovals(client(), "org-1", [
    {
      id: "task-1",
      status: "awaiting_approval",
      result: { inboxReply: { threadId: "t1", action: "send_reply", body: "Here it is.", senderId: "author-1" } },
    },
  ]);
  expect(map.get("task-1")).toEqual({
    taskId: "task-1",
    threadId: "t1",
    action: "send_reply",
    actionLabel: "Reply",
    body: "Here it is.",
    sharePreface: null,
    to: { name: "Ana Diaz", email: "Ana@Acme.com" },
    subject: "Re: Follow-up: IC",
    from: "host@fund.com",
    threadHref: "/inbox?q=Ana%40Acme.com",
    meeting: { id: "m1", title: "Series B sync", roomCode: "abc-def" },
    contact: { company: "Acme", title: "Partner" },
    lastInbound: { body: "Can you send the deck?", at: "2026-10-05T10:00:00Z" },
    editable: true,
    failed: null,
  });
});

it("recovers an older task's action and thread, and marks a failed one", async () => {
  const map = await loadMessageApprovals(client(), "org-1", [
    {
      id: "legacy-1",
      title: "Propose a time — Bo",
      description: 'Unified-inbox action on the slack thread "Intro".',
      created_by: "author-1",
    },
    {
      id: "failed-1",
      status: "failed",
      result: { inboxReply: { threadId: "t1", action: "send_reply", body: "Hi", senderId: "author-1", delivered: false, error: "Mailbox revoked" } },
    },
  ]);
  expect(map.get("legacy-1")).toMatchObject({ action: "propose_meeting", actionLabel: "Propose a time", editable: false, from: null, subject: "Intro" });
  expect(map.get("failed-1")?.failed).toEqual({ error: "Mailbox revoked" });
});

it("costs nothing for tasks that are not inbox messages", async () => {
  const map = await loadMessageApprovals(client(), "org-1", [{ id: "x", title: "Draft an IC memo", description: "Draft it" }]);
  expect(map.size).toBe(0);
  expect(reads).toEqual([]);
});

it("lists only failed messages that were never delivered", async () => {
  ROWS.tasks = [
    { id: "a", result: { inboxReply: { threadId: "t1", action: "send_reply", senderId: "u", delivered: false } } },
    { id: "b", result: { inboxReply: { threadId: "t1", action: "send_reply", senderId: "u", delivered: true } } },
    { id: "c", result: { other: true } },
  ];
  expect((await fetchFailedInboxMessages(client(), "org-1")).map((t) => t.id)).toEqual(["a"]);
});

it("links to the conversation by address, else subject", () => {
  expect(threadHref({ counterparty_email: "a@b.co", subject: "S" })).toBe("/inbox?q=a%40b.co");
  expect(threadHref({ counterparty_email: null, subject: "Intro call" })).toBe("/inbox?q=Intro%20call");
  expect(threadHref({})).toBe("/inbox");
});
