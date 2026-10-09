import { SELF_APPROVAL_REFUSED, canOverrideOwnApproval, selfApprovalRefusal } from "./approver.server";

function client(task: Record<string, unknown> | null, role: string | null) {
  return {
    from: (table: string) => {
      const b: Record<string, unknown> = { select: () => b, eq: () => b };
      b.maybeSingle = async () => ({ data: table === "tasks" ? task : role ? { role } : null });
      return b;
    },
  } as never;
}
const reply = (senderId: string) => ({ result: { inboxReply: { threadId: "t1", action: "send_reply", body: "Hi", senderId } } });

it("refuses an author approving their own message", async () => {
  expect(await selfApprovalRefusal(client(reply("u1"), "member"), "org", "u1", "task")).toBe(SELF_APPROVAL_REFUSED);
});

it("lets owners and admins approve their own, and anyone approve someone else's", async () => {
  expect(await selfApprovalRefusal(client(reply("u1"), "owner"), "org", "u1", "task")).toBeNull();
  expect(await selfApprovalRefusal(client(reply("u1"), "admin"), "org", "u1", "task")).toBeNull();
  expect(await selfApprovalRefusal(client(reply("u1"), "member"), "org", "u2", "task")).toBeNull();
});

it("applies to older tasks by their creator, and to nothing that is not an inbox message", async () => {
  const legacy = { created_by: "u1", title: "Reply — Ana", description: 'Unified-inbox reply on the gmail thread "S":\n\nHi' };
  expect(await selfApprovalRefusal(client(legacy, "member"), "org", "u1", "task")).toBe(SELF_APPROVAL_REFUSED);
  expect(await selfApprovalRefusal(client({ created_by: "u1", title: "Draft memo", description: "x" }, "member"), "org", "u1", "task")).toBeNull();
  expect(await selfApprovalRefusal(client(null, "member"), "org", "u1", "task")).toBeNull();
});

it("knows which roles override", () => {
  expect(["owner", "admin", "member", "viewer", null].map(canOverrideOwnApproval)).toEqual([true, true, false, false, false]);
});
