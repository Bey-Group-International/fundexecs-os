/**
 * Starting an inbox conversation from a meeting report: only org members, only
 * to someone who was in the meeting, on the meeting's thread with them, always
 * through the inbox's own gated send — and Earn drafts reused per report.
 */
const requireOrgContext = jest.fn();
const replyToThread = jest.fn();
const ensureMeetingThread = jest.fn();
const draftMeetingConversation = jest.fn();
let present: Array<{ name: string; email: string | null }> = [];

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/app/(app)/inbox/actions", () => ({ replyToThread: (fd: FormData) => replyToThread(fd) }));
jest.mock("@/lib/meetings/meeting-thread.server", () => ({
  ensureMeetingThread: (...a: unknown[]) => ensureMeetingThread(...a),
}));
jest.mock("@/lib/meetings/conversation-draft.server", () => ({
  draftMeetingConversation: (...a: unknown[]) => draftMeetingConversation(...a),
}));
jest.mock("@/lib/meetings/recipients.server", () => ({ loadPresentPeople: async () => present }));
jest.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: true }) }));
const checkSendingMailbox = jest.fn();
jest.mock("@/lib/inbox/deliver-reply.server", () => ({
  checkSendingMailbox: (...a: unknown[]) => checkSendingMailbox(...a),
}));

type Row = Record<string, unknown> | null;
const db: { meeting: Row; report: Row; cached: Row; upserts: unknown[]; deletes: string[] } = {
  meeting: null,
  report: null,
  cached: null,
  upserts: [],
  deletes: [],
};

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data: table === "live_meetings" ? db.meeting : table === "live_meeting_reports" ? db.report : db.cached,
          error: null,
        }),
        upsert: async (row: unknown) => {
          db.upserts.push(row);
          return { error: null };
        },
        delete: () => {
          db.deletes.push(table);
          return chain;
        },
      });
      return chain;
    },
  }),
}));

import { draftConversation, startConversation, startConversations } from "./conversation-actions";

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
  Object.assign(db, { meeting: MEETING, report: null, cached: null, upserts: [], deletes: [] });
  present = [];
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "u1", email: "host@fund.com" } });
  ensureMeetingThread.mockResolvedValue({ ok: true, threadId: "thr-new", subject: "Next steps", continued: false });
  replyToThread.mockResolvedValue({ ok: true, gated: true, message: "Tier 2 — sent to your approvals before it goes out." });
  checkSendingMailbox.mockResolvedValue({ ok: true });
});

describe("startConversation", () => {
  it("sends on the meeting's thread with them, through the inbox gate", async () => {
    const r = await startConversation(form());
    expect(r).toMatchObject({ ok: true, threadId: "thr-new", gated: true, continued: false });
    const [, input] = ensureMeetingThread.mock.calls[0] as [unknown, Record<string, any>];
    expect(input).toMatchObject({ orgId: "org-1", meetingId: "m1", subject: "Next steps", preview: "Hi Ana" });
    expect(input.recipient.email.toLowerCase()).toBe("ana@acme.com");
    const fd = replyToThread.mock.calls[0][0] as FormData;
    expect(fd.get("thread_id")).toBe("thr-new");
    expect(fd.get("body")).toBe("Hi Ana");
    // The cached Earn draft is spent.
    expect(db.deletes).toEqual(["meeting_conversation_drafts"]);
  });

  it("reports when it continued an existing meeting thread", async () => {
    ensureMeetingThread.mockResolvedValue({ ok: true, threadId: "thr-1", subject: "Follow-up: Series B sync", continued: true });
    expect(await startConversation(form())).toMatchObject({ ok: true, threadId: "thr-1", continued: true, subject: "Follow-up: Series B sync" });
  });

  it("writes to people who were present, not only the invited", async () => {
    present = [{ name: "Bo Chen", email: "bo@x.io" }];
    expect(await startConversation(form({ email: "bo@x.io" }))).toMatchObject({ ok: true });
  });

  it("refuses someone who was not in the meeting", async () => {
    expect(await startConversation(form({ email: "stranger@else.com" }))).toEqual({
      ok: false,
      error: "That person was not in this meeting.",
    });
    expect(ensureMeetingThread).not.toHaveBeenCalled();
  });

  it("refuses a meeting in another organisation", async () => {
    db.meeting = { ...MEETING, organization_id: "org-2" };
    expect(await startConversation(form())).toEqual({ ok: false, error: "Meeting not found." });
  });

  it("checks the message before touching anything", async () => {
    expect(await startConversation(form({ body: " " }))).toEqual({ ok: false, error: "Write a message first." });
    expect(requireOrgContext).not.toHaveBeenCalled();
  });

  it("reports a send that failed, and keeps the cached draft", async () => {
    replyToThread.mockResolvedValue({ ok: false, error: "Mailbox not connected" });
    expect(await startConversation(form())).toEqual({ ok: false, error: "Mailbox not connected" });
    expect(db.deletes).toEqual([]);
  });
});

describe("draftConversation", () => {
  const REPORT = { summary: "Agreed terms.", action_items: ["Send the model"], analysis: { decisions: ["Proceed"] }, created_at: "2026-10-03T10:00:00Z" };

  it("drafts from the report's own record and remembers a live draft", async () => {
    db.report = REPORT;
    draftMeetingConversation.mockResolvedValue({ subject: "S", body: "B", live: true });
    const r = await draftConversation("m1", "ana@acme.com");
    expect(r).toEqual({ ok: true, cached: false, subject: "S", body: "B", live: true });
    expect(draftMeetingConversation).toHaveBeenCalledWith({
      meetingTitle: "Series B sync",
      recipientName: "Ana Lopez",
      summary: "Agreed terms.",
      decisions: ["Proceed"],
      actionItems: ["Send the model"],
    });
    expect(db.upserts).toEqual([
      expect.objectContaining({ meeting_id: "m1", email_lower: "ana@acme.com", subject: "S", report_created_at: REPORT.created_at }),
    ]);
  });

  it("reuses a draft written from the same report, with no model call", async () => {
    db.report = REPORT;
    db.cached = { subject: "Cached", body: "Cached body", report_created_at: REPORT.created_at };
    const r = await draftConversation("m1", "ana@acme.com");
    expect(r).toEqual({ ok: true, live: true, cached: true, subject: "Cached", body: "Cached body" });
    expect(draftMeetingConversation).not.toHaveBeenCalled();
  });

  it("drafts afresh once the report has been regenerated", async () => {
    db.report = REPORT;
    db.cached = { subject: "Old", body: "Old", report_created_at: "2026-10-01T00:00:00Z" };
    draftMeetingConversation.mockResolvedValue({ subject: "New", body: "New", live: true });
    expect(await draftConversation("m1", "ana@acme.com")).toMatchObject({ cached: false, subject: "New" });
  });

  it("does not remember the template fallback", async () => {
    draftMeetingConversation.mockResolvedValue({ subject: "T", body: "T", live: false });
    await draftConversation("m1", "ana@acme.com");
    expect(db.upserts).toEqual([]);
  });

  it("refuses an outsider without drafting", async () => {
    expect((await draftConversation("m1", "stranger@else.com")).ok).toBe(false);
    expect(draftMeetingConversation).not.toHaveBeenCalled();
  });
});

describe("with no mailbox to send from", () => {
  const NO_MAILBOX = { ok: false, needsMailbox: true, error: "No Google account is connected." };

  it("refuses one message before making a thread, and says how to fix it", async () => {
    checkSendingMailbox.mockResolvedValue(NO_MAILBOX);
    expect(await startConversation(form())).toEqual(NO_MAILBOX);
    expect(ensureMeetingThread).not.toHaveBeenCalled();
    expect(replyToThread).not.toHaveBeenCalled();
  });

  it("refuses a group message once, not person by person", async () => {
    checkSendingMailbox.mockResolvedValue(NO_MAILBOX);
    const r = await startConversations({ meetingId: "m1", subject: "S", body: "Hi", emails: ["ana@acme.com"] });
    expect(r).toEqual(NO_MAILBOX);
    expect(checkSendingMailbox).toHaveBeenCalledTimes(1);
    expect(replyToThread).not.toHaveBeenCalled();
  });

  it("passes on a send refused for want of a mailbox", async () => {
    replyToThread.mockResolvedValue({ ok: false, error: "Reconnect your Google account", needsMailbox: true });
    expect(await startConversation(form())).toMatchObject({ ok: false, needsMailbox: true });
  });
});

describe("startConversations", () => {
  const TEAM = {
    ...MEETING,
    attendees: [
      { name: "Ana Lopez", email: "ana@acme.com" },
      { name: "Bo Chen", email: "bo@x.io" },
    ],
  };

  it("reads the meeting once and sends each person their own greeting on their own thread", async () => {
    db.meeting = TEAM;
    ensureMeetingThread.mockImplementation(async (_c: unknown, i: { recipient: { email: string } }) => ({
      ok: true,
      threadId: `thr-${i.recipient.email}`,
      subject: "Next steps",
      continued: false,
    }));
    const r = await startConversations({
      meetingId: "m1",
      subject: "Next steps",
      body: "Hi {first_name},\n\nThanks.",
      emails: ["ana@acme.com", "BO@x.io", "ana@acme.com"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results.map((o) => [o.email, o.ok, o.gated])).toEqual([
      ["ana@acme.com", true, true],
      ["bo@x.io", true, true],
    ]);
    expect(requireOrgContext).toHaveBeenCalledTimes(1);
    const bodies = replyToThread.mock.calls.map((c) => String((c[0] as FormData).get("body"))).sort();
    expect(bodies).toEqual(["Hi Ana,\n\nThanks.", "Hi Bo,\n\nThanks."]);
  });

  it("reports someone not in the meeting, and a failed send, by person without stopping the rest", async () => {
    db.meeting = TEAM;
    replyToThread
      .mockResolvedValueOnce({ ok: false, error: "Mailbox not connected" })
      .mockResolvedValue({ ok: true, gated: false });
    const r = await startConversations({
      meetingId: "m1",
      subject: "Next steps",
      body: "Hi {first_name}",
      emails: ["ana@acme.com", "stranger@else.com", "bo@x.io"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results.find((o) => o.email === "stranger@else.com")).toMatchObject({ ok: false, error: "not in this meeting" });
    expect(r.results.filter((o) => o.ok)).toHaveLength(1);
    expect(r.results.filter((o) => !o.ok && o.error === "Mailbox not connected")).toHaveLength(1);
  });

  it("refuses an empty message, an empty list, an oversized list and an outsider", async () => {
    expect(await startConversations({ meetingId: "m1", subject: "S", body: "  ", emails: ["ana@acme.com"] })).toMatchObject({ ok: false });
    expect(await startConversations({ meetingId: "m1", subject: "S", body: "Hi", emails: [] })).toMatchObject({ ok: false });
    const many = Array.from({ length: 51 }, (_, i) => `p${i}@x.io`);
    expect(await startConversations({ meetingId: "m1", subject: "S", body: "Hi", emails: many })).toMatchObject({ ok: false });
    db.meeting = { ...MEETING, organization_id: "org-2" };
    expect(await startConversations({ meetingId: "m1", subject: "S", body: "Hi", emails: ["ana@acme.com"] })).toEqual({
      ok: false,
      error: "Meeting not found.",
    });
    expect(replyToThread).not.toHaveBeenCalled();
  });
});
