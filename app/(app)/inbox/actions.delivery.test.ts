/**
 * What an inbox reply leaves behind when it is sent, held, or cannot be sent.
 *
 *  - held for approval: the task carries the reply itself (inboxReply), which is
 *    what approval sends — before, an approved reply was never sent;
 *  - no mailbox: refused before any task exists, with needsMailbox, never queued
 *    for an approver to clear into nothing;
 *  - a failed send: no outbound message, which everything downstream reads as sent.
 */
const requireOrgContext = jest.fn();
const gateDecision = jest.fn();
const isKnownContact = jest.fn(async (..._a: unknown[]) => false);
const deliverThreadAction = jest.fn();
const checkSendingMailbox = jest.fn();
let inserts: Array<{ table: string; row: Record<string, unknown> }> = [];

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/gates", () => ({
  gateDecision: (...a: unknown[]) => gateDecision(...a),
  tierForAction: () => 2,
  blastRadiusBreach: () => null,
}));
jest.mock("@/lib/inbox/known-contact.server", () => ({ isKnownContact: (...a: unknown[]) => isKnownContact(...a) }));
jest.mock("@/lib/grounding", () => ({ isVerifiable: () => true }));
jest.mock("@/lib/mandates", () => ({ getActiveMandate: async () => null }));
jest.mock("@/lib/integrations/log", () => ({ recordDispatch: async () => {} }));
jest.mock("@/lib/engine", () => ({ decideApproval: async () => ({}) }));
jest.mock("@/lib/team-tasks", () => ({ recordOperatorFeedback: async () => {} }));
jest.mock("@/lib/inbox/intelligence", () => ({
  computePriority: () => 0,
  fallbackSummary: () => "",
  draftReply: async () => ({ draft: "", live: false }),
  smartReplies: async () => ({ replies: [], live: false }),
}));
jest.mock("@/lib/inbox/drafts.server", () => ({ clearThreadDraft: async () => {} }));
jest.mock("@/lib/inbox/deliver-reply.server", () => ({
  checkSendingMailbox: (...a: unknown[]) => checkSendingMailbox(...a),
  deliverThreadAction: (...a: unknown[]) => deliverThreadAction(...a),
  isEmailThread: (t: { channel: string; counterparty_email: string | null }) =>
    t.channel === "gmail" && Boolean(t.counterparty_email),
}));

const THREAD = {
  id: "t1",
  organization_id: "org-1",
  channel: "gmail",
  subject: "Pacing",
  counterparty_name: "Ana Diaz",
  counterparty_email: "ana@acme.com",
  meeting_at: null,
};

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => Object.assign(Promise.resolve({ error: null }), b),
        update: () => b,
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return b;
        },
        single: async () => ({ data: { id: `${table}-row` }, error: null }),
        maybeSingle: async () => ({ data: table === "inbox_threads" ? THREAD : null, error: null }),
      };
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
      return b;
    },
  }),
}));

import { actOnThread, replyToThread } from "./actions";

function form(body = "Hi Ana,") {
  const f = new FormData();
  f.set("thread_id", "t1");
  f.set("body", body);
  return f;
}

beforeEach(() => {
  jest.clearAllMocks();
  inserts = [];
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { userId: "p1", orgId: "org-1", email: "host@fund.test" } });
  gateDecision.mockReturnValue({ tier: 1, requiresApproval: false });
  checkSendingMailbox.mockResolvedValue({ ok: true });
  deliverThreadAction.mockResolvedValue({ ok: true, channel: "gmail", live: true, detail: "Email sent to Ana Diaz." });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it("held for approval, the task carries the reply and its author, so approval can send it", async () => {
  gateDecision.mockReturnValue({ tier: 2, requiresApproval: true });
  const r = await replyToThread(form());
  expect(r).toMatchObject({ ok: true, gated: true });
  const task = inserts.find((i) => i.table === "tasks")?.row;
  expect(task?.result).toEqual({
    inboxReply: { threadId: "t1", action: "send_reply", body: "Hi Ana,", senderId: "p1" },
  });
  expect(deliverThreadAction).not.toHaveBeenCalled();
});

it("with no mailbox, refuses before any task or approval exists", async () => {
  checkSendingMailbox.mockResolvedValue({ ok: false, needsMailbox: true, error: "No Google account is connected." });
  gateDecision.mockReturnValue({ tier: 2, requiresApproval: true });
  const r = await replyToThread(form());
  expect(r).toMatchObject({ ok: false, needsMailbox: true, error: "No Google account is connected." });
  expect(inserts.filter((i) => i.table === "tasks" || i.table === "approvals")).toEqual([]);
});

it("sends from the composer's mailbox and records the outbound message", async () => {
  const r = await replyToThread(form());
  expect(r.ok).toBe(true);
  expect(deliverThreadAction).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ senderId: "p1", action: "send_reply", body: "Hi Ana,", orgId: "org-1" }),
  );
  expect(inserts.some((i) => i.table === "inbox_messages")).toBe(true);
});

it("records no outbound message when the send failed, and says why", async () => {
  deliverThreadAction.mockResolvedValue({
    ok: false,
    channel: "gmail",
    live: true,
    detail: "Email to ana@acme.com could not be delivered.",
    error: "quota",
  });
  const r = await replyToThread(form());
  expect(r).toMatchObject({ ok: false, error: "quota" });
  expect(inserts.some((i) => i.table === "inbox_messages")).toBe(false);
});

it.each(["propose_meeting", "confirm_booking", "create_video_meeting"])(
  "held for approval, %s is parked on its task so approval carries it out",
  async (action) => {
    gateDecision.mockReturnValue({ tier: 2, requiresApproval: true });
    const f = new FormData();
    f.set("thread_id", "t1");
    f.set("action", action);
    const r = await actOnThread(f);
    expect(r).toMatchObject({ ok: true, gated: true });
    expect(inserts.find((i) => i.table === "tasks")?.row.result).toEqual({
      inboxReply: { threadId: "t1", action, body: null, senderId: "p1" },
    });
    // No reply text, so no mailbox is needed to queue it.
    expect(checkSendingMailbox).not.toHaveBeenCalled();
  },
);

describe("known contacts", () => {
  it("send at once, without an approval, and say why on the record", async () => {
    gateDecision.mockReturnValue({ tier: 2, requiresApproval: true });
    isKnownContact.mockResolvedValueOnce(true);
    const r = await replyToThread(form());
    expect(r).toMatchObject({ ok: true, gated: false });
    expect(deliverThreadAction).toHaveBeenCalled();
    expect(inserts.some((i) => i.table === "approvals")).toBe(false);
    const created = inserts.find((i) => i.table === "task_events")?.row as { payload: { auto_approved?: string } };
    expect(created.payload.auto_approved).toBe("known_contact");
  });

  it("still wait when the contact is unknown", async () => {
    gateDecision.mockReturnValue({ tier: 2, requiresApproval: true });
    isKnownContact.mockResolvedValueOnce(false);
    const r = await replyToThread(form());
    expect(r).toMatchObject({ ok: true, gated: true });
    expect(deliverThreadAction).not.toHaveBeenCalled();
  });

  it("never skip a Tier-3 hold", async () => {
    gateDecision.mockReturnValue({ tier: 3, requiresApproval: true });
    isKnownContact.mockResolvedValue(true);
    const r = await replyToThread(form());
    expect(r).toMatchObject({ gated: true });
    expect(isKnownContact).not.toHaveBeenCalled();
  });
});
