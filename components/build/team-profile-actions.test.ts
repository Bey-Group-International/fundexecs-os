jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
let ctx: { orgId: string; role: string; userId: string } | null = {
  orgId: "org-1",
  role: "admin",
  userId: "user-1",
};
jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ctx }));
jest.mock("@/lib/platform-admin", () => ({ isPlatformAdmin: () => false }));
jest.mock("@/lib/team-tasks", () => ({
  createTeamTask: jest.fn(),
  normalizeTeamTaskPriority: jest.fn(),
  recordOperatorFeedback: jest.fn(),
}));

const inserts: Record<string, unknown>[] = [];
let insertError: { code: string } | null = null;
let existingMember: { id: string } | null = null;
jest.mock("@/lib/supabase/server", () => {
  const client = () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: table === "principals" ? { id: "p-1" } : existingMember,
        }),
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return q;
        },
        single: async () => ({
          data: insertError ? null : { id: "prof-1" },
          error: insertError,
        }),
      };
      return q;
    },
  });
  return { createServerClient: async () => client(), createServiceClient: () => client() };
});

import { addTeamProfile } from "./team-actions";
import { normalizeEmail } from "@/lib/member-profile";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  ctx = { orgId: "org-1", role: "admin", userId: "user-1" };
  inserts.length = 0;
  insertError = null;
  existingMember = null;
});

describe("addTeamProfile", () => {
  it("adds a profile with no login, scoped to the caller's org", async () => {
    const res = await addTeamProfile(
      form({ full_name: " Ada Lovelace ", title: "Partner", email: "ADA@Firm.com", bio: "Ran two funds." }),
    );
    expect(res).toEqual({ id: "prof-1" });
    expect(inserts[0]).toMatchObject({
      organization_id: "org-1",
      created_by: "user-1",
      full_name: "Ada Lovelace",
      title: "Partner",
      email: "ada@firm.com",
      bio: "Ran two funds.",
    });
  });

  it("allows a profile with only a name", async () => {
    const res = await addTeamProfile(form({ full_name: "Grace" }));
    expect(res.error).toBeUndefined();
    expect(inserts[0]).toMatchObject({ email: null, title: null, bio: null });
  });

  it("refuses a non-admin", async () => {
    ctx = { orgId: "org-1", role: "member", userId: "user-1" };
    expect((await addTeamProfile(form({ full_name: "Grace" }))).error).toMatch(/admins and owners/);
    expect(inserts).toHaveLength(0);
  });

  it("requires a name and a well-formed email", async () => {
    expect((await addTeamProfile(form({ full_name: "  " }))).error).toMatch(/name/i);
    expect((await addTeamProfile(form({ full_name: "A", email: "nope" }))).error).toMatch(/email/i);
    expect(inserts).toHaveLength(0);
  });

  it("does not duplicate someone who is already a member", async () => {
    existingMember = { id: "m-1" };
    const res = await addTeamProfile(form({ full_name: "A", email: "a@b.co" }));
    expect(res.error).toMatch(/already a member/);
    expect(inserts).toHaveLength(0);
  });

  it("reports a duplicate email", async () => {
    insertError = { code: "23505" };
    expect((await addTeamProfile(form({ full_name: "A", email: "a@b.co" }))).error).toMatch(/already exists/);
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims, and rejects junk", () => {
    expect(normalizeEmail("  A@B.co ")).toBe("a@b.co");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
  });
});
