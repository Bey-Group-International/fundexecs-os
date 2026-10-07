/** "Send back to Earn": the reply is rewritten with the note and re-opened for approval; nothing is lost. */
const create = jest.fn();
jest.mock("@/lib/anthropic-client", () => ({
  anthropicClient: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }),
  isAnthropicTimeout: () => false,
}));
jest.mock("@/lib/claude", () => ({ effortConfig: () => ({}) }));

import { reviseInboxReply, rewriteReply } from "./revise-reply.server";

type Write = { table: string; op: string; row: Record<string, unknown> };
function client() {
  const writes: Write[] = [];
  const c = {
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({
          data: { subject: "Follow-up: IC", channel: "gmail", counterparty_name: "Ana Diaz", counterparty_email: "ana@acme.com" },
        }),
        update: (row: Record<string, unknown>) => {
          writes.push({ table, op: "update", row });
          return b;
        },
        insert: (row: Record<string, unknown>) => {
          writes.push({ table, op: "insert", row });
          return Promise.resolve({ error: null });
        },
      };
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
      return b;
    },
  };
  return { c: c as never, writes };
}

const ENV = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "k";
});
afterAll(() => {
  process.env.ANTHROPIC_API_KEY = ENV;
});

const reply = { threadId: "t1", action: "send_reply" as const, body: "Hi Ana, long text.", senderId: "author-1" };

it("rewrites with the note and puts it back in approvals on the same task", async () => {
  create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ body: "Hi Ana, short." }) }] });
  const { c, writes } = client();
  const r = await reviseInboxReply(c, { orgId: "org-1", taskId: "task-1", title: "Reply — Ana Diaz", agent: "investor_relations", reply, note: "Shorter" });
  expect(r).toMatchObject({ ok: true, revised: true });
  const task = writes.find((w) => w.table === "tasks")!.row as { status: string; description: string; result: { inboxReply: { body: string } } };
  expect(task.status).toBe("awaiting_approval");
  expect(task.result.inboxReply.body).toBe("Hi Ana, short.");
  expect(task.description).toBe('Unified-inbox reply on the gmail thread "Follow-up: IC":\n\nHi Ana, short.');
  expect(writes.find((w) => w.table === "approvals")?.row).toMatchObject({ task_id: "task-1", summary: "Revised — Reply — Ana Diaz" });
  const prompt = create.mock.calls[0][0].messages[0].content as string;
  expect(prompt).toContain("Hi Ana, long text.");
  expect(prompt).toContain("Shorter");
});

it("with no model, returns it unchanged to approvals and says so", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { c, writes } = client();
  const r = await reviseInboxReply(c, { orgId: "org-1", taskId: "task-1", title: "Reply — Ana", agent: null, reply, note: "Shorter" });
  expect(r).toMatchObject({ ok: true, revised: false });
  expect(r.notice).toMatch(/unchanged/);
  expect((writes.find((w) => w.table === "tasks")!.row as { result: { inboxReply: { body: string } } }).result.inboxReply.body).toBe(
    "Hi Ana, long text.",
  );
  expect(writes.some((w) => w.table === "approvals")).toBe(true);
  expect(create).not.toHaveBeenCalled();
});

it("keeps the draft when the model answers with nothing usable", async () => {
  create.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  expect(await rewriteReply({ body: "Keep me", note: "x", subject: null, recipient: null })).toEqual({ body: "Keep me", live: false });
});
