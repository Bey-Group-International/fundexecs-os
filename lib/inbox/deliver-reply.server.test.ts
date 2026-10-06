/**
 * Delivering an inbox reply: the subject, the mailbox, the refusal, the tracking,
 * and an approved reply recorded the way an immediate one is.
 */
const mailboxFor = jest.fn();
const sendEmail = jest.fn();
const dispatchAction = jest.fn();
const recordDispatch = jest.fn();

jest.mock("@/lib/meetings/mailbox.server", () => ({ mailboxFor: (...a: unknown[]) => mailboxFor(...a) }));
jest.mock("@/lib/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
}));
jest.mock("@/lib/integrations", () => ({ dispatchAction: (...a: unknown[]) => dispatchAction(...a) }));
jest.mock("@/lib/integrations/gateway", () => ({ orgConnectedChannels: async () => new Set(["slack"]) }));
jest.mock("@/lib/integrations/log", () => ({ recordDispatch: (...a: unknown[]) => recordDispatch(...a) }));
jest.mock("@/lib/grounding", () => ({ isVerifiable: (a: { verification_status: string }) => a.verification_status === "verified" }));
jest.mock("@/lib/supabase/server", () => ({ hasSupabaseServiceEnv: () => false, createServiceClient: () => null }));

import {
  deliverApprovedReply,
  deliverThreadAction,
  extractInboxReply,
  legacyInboxReply,
  replySubject,
} from "./deliver-reply.server";

type Write = { table: string; op: string; row: Record<string, unknown> };
let eventRow: Record<string, unknown> | null = null;

function client(thread: Record<string, unknown> | null) {
  const writes: Write[] = [];
  const c = {
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        limit: () => b,
        maybeSingle: async () => ({
          data: table === "inbox_threads" ? thread : table === "task_events" ? eventRow : null,
          error: null,
        }),
        insert: (row: Record<string, unknown>) => {
          writes.push({ table, op: "insert", row });
          return Promise.resolve({ error: null });
        },
        update: (row: Record<string, unknown>) => {
          writes.push({ table, op: "update", row });
          return b;
        },
        upsert: (row: Record<string, unknown>) => {
          writes.push({ table, op: "upsert", row });
          return Promise.resolve({ error: null });
        },
      };
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
      return b;
    },
  };
  return { c: c as never, writes };
}

const THREAD = {
  id: "t1",
  organization_id: "org-1",
  channel: "gmail",
  subject: "Follow-up: Series B sync",
  counterparty_name: "Ana Diaz",
  counterparty_email: "ana@acme.com",
  meeting_id: "m1",
};

beforeEach(() => {
  jest.clearAllMocks();
  mailboxFor.mockResolvedValue({ ok: true, token: "tok", email: "host@fund.com", source: "member" });
  sendEmail.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent", gmailMessageId: "gm1", gmailThreadId: "gt1" });
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("replySubject", () => {
  it("prefixes once and never sends a blank subject when there is one", () => {
    expect(replySubject("Follow-up: IC")).toBe("Re: Follow-up: IC");
    expect(replySubject("RE: Follow-up: IC")).toBe("RE: Follow-up: IC");
    expect(replySubject("  ")).toBe("(no subject)");
  });
});

describe("extractInboxReply", () => {
  it("reads a parked reply and ignores anything else", () => {
    expect(extractInboxReply({ inboxReply: { threadId: "t1", action: "send_reply", body: "Hi", senderId: "u1" } })).toEqual({
      threadId: "t1",
      action: "send_reply",
      body: "Hi",
      senderId: "u1",
      delivered: false,
    });
    expect(extractInboxReply({ dispatch: {} })).toBeNull();
    expect(extractInboxReply(null)).toBeNull();
    expect(extractInboxReply({ inboxReply: { threadId: "t1" } })).toBeNull();
  });
});

describe("deliverThreadAction", () => {
  it("emails from the sender's own mailbox under Re: <subject>, and tracks the Gmail thread", async () => {
    const { c, writes } = client(THREAD);
    const r = await deliverThreadAction(c, {
      orgId: "org-1",
      senderId: "u1",
      thread: THREAD as never,
      action: "send_reply",
      body: "Hi Ana,\n\nThanks.",
    });
    expect(r).toMatchObject({ ok: true, live: true, channel: "gmail" });
    expect(mailboxFor).toHaveBeenCalledWith(expect.anything(), "u1", "org-1");
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.subject).toBe("Re: Follow-up: Series B sync");
    expect(sent.to).toEqual({ name: "Ana Diaz", email: "ana@acme.com" });
    expect(sent.credentials).toEqual({ gmailAccessToken: "tok" });
    expect(sent.htmlBody).toBe("<p>Hi Ana,</p><p>Thanks.</p>");
    expect(writes.find((w) => w.table === "tracked_mail_threads")?.row).toMatchObject({
      gmail_thread_id: "gt1",
      inbox_thread_id: "t1",
      meeting_id: "m1",
      user_id: "u1",
    });
    expect(dispatchAction).not.toHaveBeenCalled();
  });

  it("does not track a send from the org mailbox, which is swept already", async () => {
    mailboxFor.mockResolvedValue({ ok: true, token: "tok", email: null, source: "organization" });
    const { c, writes } = client(THREAD);
    await deliverThreadAction(c, { orgId: "org-1", senderId: "u1", thread: THREAD as never, action: "send_reply", body: "Hi" });
    expect(writes.some((w) => w.table === "tracked_mail_threads")).toBe(false);
  });

  it("refuses with the reason when no mailbox can send — never a draft reported as sent", async () => {
    mailboxFor.mockResolvedValue({ ok: false, problem: "not_connected" });
    const { c } = client(THREAD);
    const r = await deliverThreadAction(c, { orgId: "org-1", senderId: "u1", thread: THREAD as never, action: "send_reply", body: "Hi" });
    expect(r).toMatchObject({ ok: false, needsMailbox: true });
    expect(r.error).toMatch(/No Google account is connected/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports a send Gmail refused", async () => {
    sendEmail.mockResolvedValue({ ok: false, channel: "gmail", detail: "quota exceeded" });
    const { c } = client(THREAD);
    const r = await deliverThreadAction(c, { orgId: "org-1", senderId: "u1", thread: THREAD as never, action: "send_reply", body: "Hi" });
    expect(r).toMatchObject({ ok: false, error: "quota exceeded" });
  });

  it("keeps the trust gate for unverified work product", async () => {
    const { c } = client(THREAD);
    const r = await deliverThreadAction(c, {
      orgId: "org-1",
      senderId: "u1",
      thread: THREAD as never,
      action: "send_reply",
      body: "Hi",
      backingArtifact: { verification_status: "unverified", grounding_score: 0 },
    });
    expect(r).toMatchObject({ ok: false, gated: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("dispatches other channels through their adapter, with the reply subject", async () => {
    dispatchAction.mockResolvedValue({ ok: true, channel: "slack", live: true, detail: "Posted." });
    const slack = { ...THREAD, channel: "slack" };
    const { c } = client(slack);
    await deliverThreadAction(c, { orgId: "org-1", senderId: "u1", thread: slack as never, action: "send_reply", body: "Hi" });
    expect(dispatchAction).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "slack", connected: true, subject: "Re: Follow-up: Series B sync", body: "Hi" }),
    );
  });
});

describe("deliverApprovedReply", () => {
  const reply = { threadId: "t1", action: "send_reply" as const, body: "Hi Ana", senderId: "author-1" };

  it("sends from the author's mailbox, records the message, and marks the task delivered", async () => {
    const { c, writes } = client(THREAD);
    const r = await deliverApprovedReply(c, { orgId: "org-1", approverId: "approver-1", taskId: "task-1", agent: null, hub: "source", reply });
    expect(r).toEqual({ ok: true, error: undefined });
    expect(mailboxFor).toHaveBeenCalledWith(expect.anything(), "author-1", "org-1");
    expect(writes.find((w) => w.table === "inbox_messages")?.row).toMatchObject({ direction: "outbound", body: "Hi Ana" });
    const task = writes.find((w) => w.table === "tasks")?.row as { status: string; result: { inboxReply: { delivered: boolean } } };
    expect(task.status).toBe("completed");
    expect(task.result.inboxReply.delivered).toBe(true);
    expect(recordDispatch).toHaveBeenCalled();
  });

  it("marks the task failed, with no outbound message, when it could not be sent", async () => {
    mailboxFor.mockResolvedValue({ ok: false, problem: "revoked" });
    const { c, writes } = client(THREAD);
    const r = await deliverApprovedReply(c, { orgId: "org-1", approverId: "a", taskId: "task-1", agent: null, hub: null, reply });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/revoked/);
    expect(writes.some((w) => w.table === "inbox_messages")).toBe(false);
    const task = writes.find((w) => w.table === "tasks")?.row as { status: string; result: { inboxReply: { delivered: boolean } } };
    expect(task.status).toBe("failed");
    expect(task.result.inboxReply.delivered).toBe(false);
  });

  it("fails cleanly when the conversation is gone", async () => {
    const { c } = client(null);
    const r = await deliverApprovedReply(c, { orgId: "org-1", approverId: "a", taskId: "task-1", agent: null, hub: null, reply });
    expect(r).toEqual({ ok: false, error: "The conversation no longer exists." });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("legacyInboxReply", () => {
  const task = {
    id: "task-0",
    created_by: "author-1",
    description: 'Unified-inbox reply on the gmail thread "Follow-up: IC":\n\nHi Ana,\n\nThanks.',
  };

  it("rebuilds a reply queued before replies were parked on the task", async () => {
    eventRow = { payload: { inbox_thread_id: "t1" } };
    const { c } = client(null);
    expect(await legacyInboxReply(c, task)).toEqual({
      threadId: "t1",
      action: "send_reply",
      body: "Hi Ana,\n\nThanks.",
      senderId: "author-1",
    });
  });

  it("leaves every other task alone", async () => {
    eventRow = { payload: { inbox_thread_id: "t1" } };
    const { c } = client(null);
    expect(await legacyInboxReply(c, { ...task, description: "Unified-inbox action on the gmail thread \"X\"." })).toBeNull();
    expect(await legacyInboxReply(c, { ...task, description: "Draft an IC memo" })).toBeNull();
    expect(await legacyInboxReply(c, { ...task, created_by: null })).toBeNull();
    eventRow = null;
    expect(await legacyInboxReply(c, task)).toBeNull();
  });
});
