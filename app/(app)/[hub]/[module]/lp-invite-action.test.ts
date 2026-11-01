// The invite sent from an allocator's page makes the same kind of link as
// Run › Onboarding does: 7 days, and the email says so.
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

jest.mock("@/lib/auth", () => ({
  getSessionContext: jest.fn(),
  requireOrgContext: async () => ({ ok: true, ctx: { orgId: "org-1", userId: "user-1", role: "admin" } }),
}));

let inserted: Record<string, unknown> | null = null;
let serviceEnv = true;
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => serviceEnv,
  createServiceClient: () => ({ service: true }),
  createServerClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {
        insert: (row: Record<string, unknown>) => ((inserted = row), q),
        select: () => q,
        single: async () => ({ data: { id: "s9", token: "tok-abc" }, error: null }),
      };
      return q;
    },
  }),
}));

const dispatch = jest.fn(async (_a: unknown) => ({ ok: true }));
jest.mock("@/lib/integrations/adapters/gmail", () => ({ gmailAdapter: { dispatch: (a: unknown) => dispatch(a) } }));

const recordAudit = jest.fn(async (..._a: unknown[]) => true);
jest.mock("@/lib/lp-audit.server", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));
const audited = () => recordAudit.mock.calls.map((c) => c[1] as Record<string, unknown>);

const carryForward = jest.fn(async (..._a: unknown[]) => []);
jest.mock("@/lib/lp-reuse.server", () => ({ carryForwardChecks: (...a: unknown[]) => carryForward(...a) }));

import { createLpInviteAction } from "./actions";

const form = () => {
  const f = new FormData();
  f.set("lp_name", "Calpers");
  f.set("lp_email", "ops@calpers.ca.gov");
  return f;
};

beforeEach(() => {
  inserted = null;
  serviceEnv = true;
  dispatch.mockClear();
  carryForward.mockClear();
  recordAudit.mockClear();
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

describe("a returning LP invited from an allocator's page", () => {
  it("keeps their earlier ID verification, as for a link made in Run › Onboarding", async () => {
    await createLpInviteAction(form());
    expect(carryForward).toHaveBeenCalledWith({ service: true }, { orgId: "org-1", sessionId: "s9", email: "ops@calpers.ca.gov" });
  });

  it("records who sent the invite and from where, without the name or address", async () => {
    const f = form();
    f.set("investor_id", "inv-1");
    await createLpInviteAction(f);
    expect(audited()).toEqual([
      { orgId: "org-1", sessionId: "s9", action: "link.created", actorKind: "user", actorId: "user-1", detail: { source: "allocator", has_fund: false, has_investor: true, carried: 0 } },
    ]);
    expect(JSON.stringify(recordAudit.mock.calls)).not.toMatch(/calpers|tok-abc/i);
  });

  it("still makes the invite where the service role isn't configured", async () => {
    serviceEnv = false;
    expect(await createLpInviteAction(form())).toMatchObject({ ok: true, token: "tok-abc" });
    expect(carryForward).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
