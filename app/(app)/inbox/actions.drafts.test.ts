/**
 * Whether sending a reply actually takes the thread's draft with it.
 *
 * `shouldClearDraft` is tested as a rule and `clearThreadDraft` as a write. Neither
 * can see the two lines in performThreadAction that connect them — and those two
 * lines are the whole guarantee. Break either and every other test still passes
 * while the inbox keeps offering to re-send a message that has already gone.
 *
 * Which is the third time this session that a rule was tested and its call site was
 * not, so it is tested first here.
 *
 * Scoped deliberately: this file is about the draft, not about the gate layer. The
 * gate, the mandate, the dispatcher and the task writes are all stubbed to the
 * shapes performThreadAction reads.
 */
const requireOrgContext = jest.fn();
const from = jest.fn();
const gateDecision = jest.fn();
const dispatchAction = jest.fn();
const clearThreadDraft = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (t: string) => from(t) }),
}));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/gates", () => ({
  gateDecision: (...a: unknown[]) => gateDecision(...a),
  tierForAction: () => 2,
}));
jest.mock("@/lib/grounding", () => ({ isVerifiable: () => true }));
jest.mock("@/lib/mandates", () => ({ getActiveMandate: async () => null }));
jest.mock("@/lib/integrations", () => ({ dispatchAction: (...a: unknown[]) => dispatchAction(...a) }));
jest.mock("@/lib/integrations/gateway", () => ({ orgConnectedChannels: async () => new Set(["gmail"]) }));
jest.mock("@/lib/integrations/log", () => ({ recordDispatch: async () => {} }));
// Delivery itself is tested in lib/inbox/deliver-reply.server.test.ts; here it is
// the dispatcher stub, so a failed send is still one switch away.
jest.mock("@/lib/inbox/deliver-reply.server", () => ({
  checkSendingMailbox: async () => ({ ok: true }),
  isEmailThread: (t: { channel: string; counterparty_email: string | null }) =>
    t.channel === "gmail" && Boolean(t.counterparty_email),
  deliverThreadAction: (_c: unknown, input: unknown) => dispatchAction(input),
}));
jest.mock("@/lib/engine", () => ({ decideApproval: async () => ({ ok: true }) }));
jest.mock("@/lib/team-tasks", () => ({ recordOperatorFeedback: async () => {} }));
jest.mock("@/lib/inbox/intelligence", () => ({
  computePriority: () => 0,
  fallbackSummary: () => "",
  draftReply: async () => ({ draft: "", live: false }),
  smartReplies: async () => ({ replies: [], live: false }),
}));
jest.mock("@/lib/inbox/drafts.server", () => ({
  clearThreadDraft: (...a: unknown[]) => clearThreadDraft(...a),
}));

import { actOnThread, replyToThread } from "./actions";

const THREAD = {
  id: "t1",
  organization_id: "org-1",
  channel: "gmail",
  category: "messaging",
  subject: "Pacing",
  counterparty_name: "Ana Diaz",
  counterparty_email: "ana@acme.com",
  status: "open",
  unread: false,
  priority: 40,
  last_message_at: "2026-09-01T00:00:00.000Z",
  meeting_at: null,
};

/** Task-row updates, so a failure path can be seen to leave no dangling task. */
let taskUpdates: Array<Record<string, unknown>> = [];

function wire(opts: { approvalFails?: boolean } = {}) {
  from.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => Object.assign(Promise.resolve({ error: null }), b),
      update: (row: Record<string, unknown>) => {
        if (table === "tasks") taskUpdates.push(row);
        return b;
      },
      insert: () => b,
      single: async () =>
        table === "approvals" && opts.approvalFails
          ? { data: null, error: { message: "approvals insert denied" } }
          : { data: { id: `${table}-row` }, error: null },
      maybeSingle: async () => ({ data: table === "inbox_threads" ? THREAD : null, error: null }),
    };
    // `insert` on task_events / inbox_messages is awaited as the builder.
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
    return b;
  });
}

const REVISION = "2026-09-30T12:00:00.000Z";

function form(body: string, revision: string | null = REVISION) {
  const f = new FormData();
  f.set("thread_id", "t1");
  f.set("body", body);
  if (revision !== null) f.set("draft_revision", revision);
  return f;
}

beforeEach(() => {
  jest.clearAllMocks();
  taskUpdates = [];
  wire();
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { userId: "p1", orgId: "org-1", email: "host@fund.test" } });
  gateDecision.mockReturnValue({ tier: 1, requiresApproval: false });
  dispatchAction.mockResolvedValue({ ok: true, channel: "gmail", live: true, detail: "Sent." });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("when the reply goes out", () => {
  it("clears the thread's draft", async () => {
    const res = await replyToThread(form("Hi Ana,"));
    expect(res.ok).toBe(true);
    expect(clearThreadDraft).toHaveBeenCalledWith(expect.anything(), "t1", REVISION);
  });

  /**
   * The composed text is on the task, waiting for an approver. Leaving the draft
   * would be the same words in two places, and the composer would offer to send
   * them again — a second approval for one reply.
   */
  it("clears it on the gated path too, where nothing has actually been sent yet", async () => {
    gateDecision.mockReturnValue({ tier: 2, requiresApproval: true });
    const res = await replyToThread(form("Hi Ana,"));
    expect(res.gated).toBe(true);
    expect(clearThreadDraft).toHaveBeenCalledWith(expect.anything(), "t1", REVISION);
  });
});

describe("when it does not", () => {
  /**
   * Nothing else is holding the text at this point — unlike the gated path, there
   * is no task carrying it — so deleting the draft would leave the operator with
   * nothing to retry from after a reload.
   */
  /**
   * The seam for the lost-update fix: the revision has to survive FormData, the
   * action signature and the gate branch to reach the delete. Nothing else in this
   * file would notice it being dropped — the draft would still be cleared, just
   * unconditionally, which is the bug.
   */
  it("keeps the draft when the reply cannot say which revision it came from", async () => {
    const res = await replyToThread(form("Hi Ana,", null));
    expect(res.ok).toBe(true);
    expect(clearThreadDraft).not.toHaveBeenCalled();
  });

  it("keeps the draft when the dispatch fails", async () => {
    dispatchAction.mockResolvedValue({ ok: false, channel: "gmail", live: false, detail: "No mailbox.", error: "No mailbox." });
    const res = await replyToThread(form("Hi Ana,"));
    expect(res.ok).toBe(false);
    expect(clearThreadDraft).not.toHaveBeenCalled();
  });

  // A suggested action fired from the card carries no composed text. It is a
  // different move on the same thread, and it must not take an unsent follow-up
  // with it.
  it("keeps the draft when a suggested reply is fired with no composed text", async () => {
    const f = new FormData();
    f.set("thread_id", "t1");
    f.set("action", "send_reply");
    await actOnThread(f);
    expect(clearThreadDraft).not.toHaveBeenCalled();
  });

  it.each(["propose_meeting", "confirm_booking", "create_video_meeting"])(
    "keeps the draft when the action is %s",
    async (action) => {
      const f = new FormData();
      f.set("thread_id", "t1");
      f.set("action", action);
      await actOnThread(f);
      expect(clearThreadDraft).not.toHaveBeenCalled();
    },
  );

  /**
   * The approval IS the release mechanism for a gated reply. Without a row the task
   * holds the composed text and nothing can ever clear it — so deleting the draft
   * on that path leaves the operator told "sent to your approvals", with no
   * approval and no draft to retry from.
   *
   * The task insert above it was already checked; this one was not, and the draft
   * deletion is what turned a recoverable state into a lossy one.
   */
  it("keeps the draft when the approval could not be created", async () => {
    gateDecision.mockReturnValue({ tier: 2, requiresApproval: true });
    wire({ approvalFails: true });
    const res = await replyToThread(form("Hi Ana,"));

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/approvals insert denied/);
    expect(clearThreadDraft).not.toHaveBeenCalled();
  });

  // And leaves no task stuck at awaiting_approval, which is a queue entry no
  // approver can act on and no sweep clears.
  it("marks the orphaned task failed rather than leaving it awaiting approval", async () => {
    gateDecision.mockReturnValue({ tier: 2, requiresApproval: true });
    wire({ approvalFails: true });
    await replyToThread(form("Hi Ana,"));
    expect(taskUpdates).toEqual([expect.objectContaining({ status: "failed" })]);
  });

  it("does nothing at all for a caller with no organisation", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, error: "Not authorized." });
    expect((await replyToThread(form("Hi Ana,"))).ok).toBe(false);
    expect(clearThreadDraft).not.toHaveBeenCalled();
  });
});
