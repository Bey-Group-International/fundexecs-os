jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
let ctx: { orgId: string; role: string; userId: string } | null = {
  orgId: "org-1",
  role: "admin",
  userId: "me",
};
jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ctx }));
jest.mock("@/lib/platform-admin", () => ({ isPlatformAdmin: () => false }));
jest.mock("@/lib/team-tasks", () => ({
  createTeamTask: jest.fn(),
  normalizeTeamTaskPriority: jest.fn(),
  recordOperatorFeedback: jest.fn(),
}));

const sent: Record<string, unknown>[] = [];
let sendOk = true;
jest.mock("@/lib/team-invites.server", () => ({
  savePendingInvite: jest.fn(),
  sendMemberAddedEmail: async (_svc: unknown, args: Record<string, unknown>) => {
    sent.push(args);
    return { sent: sendOk, detail: sendOk ? "sent" : "no mailbox connected" };
  },
}));

// Rows keyed by table, filtered by the .eq() calls so a lookup scoped to the
// wrong organization finds nothing, as the database would.
let rows: Record<string, Record<string, unknown>[]> = {};
const updates: { table: string; patch: Record<string, unknown> }[] = [];
jest.mock("@/lib/supabase/server", () => {
  const client = () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return q;
        },
        update: (patch: Record<string, unknown>) => {
          updates.push({ table, patch });
          return q;
        },
        maybeSingle: async () => ({
          data:
            (rows[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
        }),
      };
      return q;
    },
  });
  return { createServerClient: async () => client(), createServiceClient: () => client() };
});

import { resendInvite } from "./team-actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

let n = 0;
beforeEach(() => {
  n += 1; // a fresh address each test, so the in-memory rate limit never carries over
  ctx = { orgId: "org-1", role: "admin", userId: "me" };
  sent.length = 0;
  updates.length = 0;
  sendOk = true;
  rows = {
    organization_members: [
      { id: "m-1", organization_id: "org-1", principal_id: "p-1", role: "member" },
      { id: "m-self", organization_id: "org-1", principal_id: "me", role: "admin" },
      { id: "m-other", organization_id: "org-2", principal_id: "p-9", role: "member" },
    ],
    principals: [
      { id: "p-1", email: `Ann${n}@Firm.com` },
      { id: "me", email: "me@firm.com" },
      { id: "p-9", email: "other@elsewhere.com" },
    ],
    organization_invites: [
      { id: "i-1", organization_id: "org-1", email: `new${n}@firm.com`, role: "admin", accepted_at: null },
      { id: "i-done", organization_id: "org-1", email: "done@firm.com", role: "member", accepted_at: "2026-11-01" },
      { id: "i-other", organization_id: "org-2", email: "x@else.com", role: "member", accepted_at: null },
    ],
  };
});

describe("resendInvite", () => {
  it("reminds an existing member by their lower-cased address", async () => {
    const res = await resendInvite(form({ memberId: "m-1" }));
    expect(res.error).toBeUndefined();
    expect(res.notice).toContain(`ann${n}@firm.com`);
    expect(sent[0]).toMatchObject({
      orgId: "org-1",
      email: `ann${n}@firm.com`,
      role: "member",
      inviterId: "me",
      pending: false,
      reminder: true,
    });
  });

  it("reminds a waiting invite as pending and refreshes its expiry", async () => {
    const res = await resendInvite(form({ inviteId: "i-1" }));
    expect(res.error).toBeUndefined();
    expect(sent[0]).toMatchObject({ email: `new${n}@firm.com`, role: "admin", pending: true, reminder: true });
    expect(updates[0]).toMatchObject({ table: "organization_invites" });
    expect(updates[0].patch.expires_at).toEqual(expect.any(String));
  });

  it("refuses a non-admin", async () => {
    ctx = { orgId: "org-1", role: "member", userId: "me" };
    expect((await resendInvite(form({ memberId: "m-1" }))).error).toMatch(/admins and owners/);
    expect(sent).toHaveLength(0);
  });

  it("will not mail a member or invite from another organization", async () => {
    expect((await resendInvite(form({ memberId: "m-other" }))).error).toMatch(/isn't on this team/);
    expect((await resendInvite(form({ inviteId: "i-other" }))).error).toMatch(/no longer pending/);
    expect(sent).toHaveLength(0);
  });

  it("will not remind an accepted invite or yourself", async () => {
    expect((await resendInvite(form({ inviteId: "i-done" }))).error).toMatch(/no longer pending/);
    expect((await resendInvite(form({ memberId: "m-self" }))).error).toMatch(/yourself/);
    expect(sent).toHaveLength(0);
  });

  it("needs a target", async () => {
    expect((await resendInvite(form({}))).error).toMatch(/who to remind/);
  });

  it("sends at most one reminder per address in the window", async () => {
    expect((await resendInvite(form({ memberId: "m-1" }))).error).toBeUndefined();
    expect((await resendInvite(form({ memberId: "m-1" }))).error).toMatch(/just sent/);
    expect(sent).toHaveLength(1);
  });

  it("says so when the mail could not be sent", async () => {
    sendOk = false;
    const res = await resendInvite(form({ memberId: "m-1" }));
    expect(res.notice).toBeUndefined();
    expect(res.error).toMatch(/couldn't be sent/);
  });
});
