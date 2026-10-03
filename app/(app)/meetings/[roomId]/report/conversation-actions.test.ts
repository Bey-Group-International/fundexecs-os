/**
 * Starting an inbox conversation from a meeting report: only org members, only
 * to someone who was in the meeting, on the thread their reply will land on,
 * and always through the inbox's own gated send.
 */
const requireOrgContext = jest.fn();
const replyToThread = jest.fn();
const recordThreadOnTimeline = jest.fn();
const draftMeetingConversation = jest.fn();
let present: Array<{ name: string; email: string | null }> = [];

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/app/(app)/inbox/actions", () => ({ replyToThread: (fd: FormData) => replyToThread(fd) }));
jest.mock("@/lib/inbox/crm-activity.server", () => ({
  recordThreadOnTimeline: (...a: unknown[]) => recordThreadOnTimeline(...a),
}));
jest.mock("@/lib/meetings/conversation-draft.server", () => ({
  draftMeetingConversation: (...a: unknown[]) => draftMeetingConversation(...a),
}));
jest.mock("@/lib/meetings/recipients.server", () => ({ loadPresentPeople: async () => present }));
jest.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: true }) }));

type Row = Record<string, unknown> | null;
const db: {
  meeting: Row;
  existingThread: Row;
  report: Row;
  inserts: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
} = { meeting: null, existingThread: null, report: null, inserts: [], updates: [] };

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const result = () =>
        table === "live_meetings" ? db.meeting : table === "inbox_threads" ? db.existingThread : db.report;
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: result(), error: null }),
        insert: (row: Record<string, unknown>) => {
          db.inserts.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "thr-new" }, error: null }) }) };
        },
        update: (patch: Record<string, unknown>) => {
          db.updates.push(patch);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      });
      return chain;
    },
  }),
}));

import { draftConversation, startConversation } from "./conversation-actions";

const MEETING = {
  id: "m1",
  title: "Series B sync",
  organization_id: "org-1",
  attendees: [{ name: "Ana Lopez", email: "Ana@Acme.com" }],
};

function form(over: Record<string, string> = {}) {
  const fd = new FormData();
  const values = { meeting_id: "m1", email: "ana@acme.com", subject: "Next steps", body: "Hi Ana", ...over };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.meeting = MEETING;
  db.existingThread = null;
  db.report = null;
  db.inserts = [];
  db.updates = [];
  present = [];
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "u1", email: "host@fund.com" } });
  replyToThread.mockResolvedValue({ ok: true, gated: true, message: "Tier 2 — sent to your approvals before it goes out." });
});

describe("startConversation", () => {
  it("creates the thread on the reply key, linked to the meeting, and sends through the inbox gate", async () => {
    const r = await startConversation(form());
    expect(r).toEqual({ ok: true, threadId: "thr-new", gated: true, message: expect.stringContaining("approvals") });
    expect(db.inserts[0]).toMatchObject({
      organization_id: "org-1",
      channel: "gmail",
      counterparty_email: "ana@acme.com",
      external_id: "email:ana@acme.com:next steps",
      meeting_id: "m1",
      subject: "Next steps",
    });
    expect(recordThreadOnTimeline).toHaveBeenCalledTimes(1);
    const fd = replyToThread.mock.calls[0][0] as FormData;
    expect(fd.get("thread_id")).toBe("thr-new");
    expect(fd.get("body")).toBe("Hi Ana");
  });

  it("continues an existing thread rather than opening a second one", async () => {
    db.existingThread = { id: "thr-1", meeting_id: null };
    const r = await startConversation(form());
    expect(r).toMatchObject({ ok: true, threadId: "thr-1" });
    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([{ meeting_id: "m1" }]);
  });

  it("writes to people who were present, not only the invited", async () => {
    present = [{ name: "Bo Chen", email: "bo@x.io" }];
    expect(await startConversation(form({ email: "bo@x.io" }))).toMatchObject({ ok: true });
  });

  it("refuses someone who was not in the meeting", async () => {
    const r = await startConversation(form({ email: "stranger@else.com" }));
    expect(r).toEqual({ ok: false, error: "That person was not in this meeting." });
    expect(replyToThread).not.toHaveBeenCalled();
  });

  it("refuses a meeting in another organisation", async () => {
    db.meeting = { ...MEETING, organization_id: "org-2" };
    expect(await startConversation(form())).toEqual({ ok: false, error: "Meeting not found." });
  });

  it("checks the message before touching anything", async () => {
    expect(await startConversation(form({ body: " " }))).toEqual({ ok: false, error: "Write a message first." });
    expect(requireOrgContext).not.toHaveBeenCalled();
  });

  it("reports a send that failed", async () => {
    replyToThread.mockResolvedValue({ ok: false, error: "Mailbox not connected" });
    expect(await startConversation(form())).toEqual({ ok: false, error: "Mailbox not connected" });
  });
});

describe("draftConversation", () => {
  it("drafts from the report's own record", async () => {
    db.report = { summary: "Agreed terms.", action_items: ["Send the model"], analysis: { decisions: ["Proceed"] } };
    draftMeetingConversation.mockResolvedValue({ subject: "S", body: "B", live: true });
    const r = await draftConversation("m1", "ana@acme.com");
    expect(r).toEqual({ ok: true, subject: "S", body: "B", live: true });
    expect(draftMeetingConversation).toHaveBeenCalledWith({
      meetingTitle: "Series B sync",
      recipientName: "Ana Lopez",
      summary: "Agreed terms.",
      decisions: ["Proceed"],
      actionItems: ["Send the model"],
    });
  });

  it("refuses an outsider without drafting", async () => {
    const r = await draftConversation("m1", "stranger@else.com");
    expect(r.ok).toBe(false);
    expect(draftMeetingConversation).not.toHaveBeenCalled();
  });
});
