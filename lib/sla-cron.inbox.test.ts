// Inbox messages held for approval are reminded by their own sweep, addressed to
// people who can approve them — never a "Stuck" task for their author.
const createTeamTask = jest.fn(async (..._a: unknown[]) => ({ id: "tt" }));
jest.mock("@/lib/team-tasks", () => ({ createTeamTask: (...a: unknown[]) => createTeamTask(...a), recordOperatorFeedback: async () => {} }));

import { runSlaEscalations } from "./sla-cron";

it("leaves held inbox messages to the inbox's own reminders", async () => {
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const tasks = [
    {
      id: "inbox-task",
      title: "Reply — Ana",
      status: "awaiting_approval",
      created_at: old,
      organization_id: "org",
      created_by: "author",
      result: { inboxReply: { threadId: "t1", action: "send_reply", senderId: "author" } },
    },
  ];
  const client = {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "is", "in", "order", "limit", "not", "eq", "ilike"]) b[m] = () => b;
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "tasks" ? tasks : [] }).then(resolve);
      return b;
    },
  } as never;
  expect(await runSlaEscalations(client)).toBe(0);
  expect(createTeamTask).not.toHaveBeenCalled();
});
