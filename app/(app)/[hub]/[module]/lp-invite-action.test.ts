// The invite sent from an allocator's page makes the same kind of link as
// Run › Onboarding does: 7 days, and the email says so.
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

jest.mock("@/lib/auth", () => ({
  getSessionContext: jest.fn(),
  requireOrgContext: async () => ({ ok: true, ctx: { orgId: "org-1", userId: "user-1", role: "admin" } }),
}));

let inserted: Record<string, unknown> | null = null;
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: jest.fn(),
  createServerClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {
        insert: (row: Record<string, unknown>) => ((inserted = row), q),
        select: () => q,
        single: async () => ({ data: { token: "tok-abc" }, error: null }),
      };
      return q;
    },
  }),
}));

const dispatch = jest.fn(async (_a: unknown) => ({ ok: true }));
jest.mock("@/lib/integrations/adapters/gmail", () => ({ gmailAdapter: { dispatch: (a: unknown) => dispatch(a) } }));

import { createLpInviteAction } from "./actions";

const form = () => {
  const f = new FormData();
  f.set("lp_name", "Calpers");
  f.set("lp_email", "ops@calpers.ca.gov");
  return f;
};

beforeEach(() => {
  inserted = null;
  dispatch.mockClear();
});

describe("createLpInviteAction", () => {
  it("makes a link that lasts 7 days", async () => {
    const before = Date.now();
    const res = await createLpInviteAction(form());
    expect(res).toMatchObject({ ok: true, token: "tok-abc" });
    const days = (new Date(inserted!.expires_at as string).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });

  it("tells the LP the link lasts 7 days and that a code will be asked for", async () => {
    await createLpInviteAction(form());
    const body = (dispatch.mock.calls[0][0] as { metadata: { body: string } }).metadata.body;
    expect(body).toContain("expires in 7 days");
    expect(body).toContain("code we email you");
    expect(body).not.toContain("30 days");
  });
});
