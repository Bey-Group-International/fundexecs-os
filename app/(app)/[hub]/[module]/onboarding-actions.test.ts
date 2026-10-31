jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

let auth: unknown = { ok: true, ctx: { orgId: "org-1", userId: "user-1", role: "admin" } };
jest.mock("@/lib/auth", () => ({ requireOrgContext: async () => auth }));

// What the fake database returns and what it was asked to write.
let sessionFound = true;
let checkRows: Array<{ kind: string; status: string; expires_at: string | null }> = [];
let writeError: { code: string; message: string } | null = null;
let upserted: { row: Record<string, unknown>; opts: unknown } | null = null;
let inserted: Record<string, unknown> | null = null;
const sessionFilters: Record<string, unknown> = {};

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          if (table === "lp_onboarding_sessions") sessionFilters[c] = v;
          return q;
        },
        maybeSingle: async () => ({ data: sessionFound ? { id: "s1" } : null }),
        upsert: async (row: Record<string, unknown>, opts: unknown) => {
          upserted = { row, opts };
          return { error: writeError };
        },
        insert: async (row: Record<string, unknown>) => {
          inserted = row;
          return { error: writeError };
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: checkRows, error: null }),
      };
      return q;
    },
  }),
}));

import { recordOnboardingCheck, recordOnboardingDecision } from "./onboarding-actions";

const allClear = () =>
  ["identity", "sanctions", "pep", "adverse_media", "accreditation"].map((kind) => ({ kind, status: "clear", expires_at: null }));

beforeEach(() => {
  auth = { ok: true, ctx: { orgId: "org-1", userId: "user-1", role: "admin" } };
  sessionFound = true;
  checkRows = [];
  writeError = null;
  upserted = null;
  inserted = null;
  for (const k of Object.keys(sessionFilters)) delete sessionFilters[k];
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const check = { sessionId: "s1", kind: "identity", status: "clear", summary: "ID matched", validForDays: 90 };
const decision = { sessionId: "s1", decision: "rejected", reason: "Could not verify the source of funds" };

describe.each([
  ["recordOnboardingCheck", () => recordOnboardingCheck(check)],
  ["recordOnboardingDecision", () => recordOnboardingDecision(decision)],
])("%s access", (_name, call) => {
  it("needs a signed-in member of an organization", async () => {
    auth = { ok: false, status: 401, error: "Not authenticated" };
    expect(await call()).toEqual({ ok: false, error: "Sign in again to continue." });
    expect(upserted).toBeNull();
    expect(inserted).toBeNull();
  });

  it.each(["member", "viewer"])("refuses the %s role", async (role) => {
    auth = { ok: true, ctx: { orgId: "org-1", userId: "user-1", role } };
    expect(await call()).toEqual({ ok: false, error: "Only organization owners and admins can review LPs." });
    expect(upserted).toBeNull();
    expect(inserted).toBeNull();
  });

  it("accepts an owner", async () => {
    auth = { ok: true, ctx: { orgId: "org-1", userId: "user-1", role: "owner" } };
    expect((await call()).ok).toBe(true);
  });

  it("refuses an LP outside the caller's organization, and says nothing more", async () => {
    sessionFound = false;
    expect(await call()).toEqual({ ok: false, error: "That LP wasn't found." });
    expect(sessionFilters).toEqual({ id: "s1", organization_id: "org-1" });
    expect(upserted).toBeNull();
    expect(inserted).toBeNull();
  });
});

describe("recordOnboardingCheck", () => {
  it("records the check against the session's organization and the signed-in admin", async () => {
    const res = await recordOnboardingCheck({ ...check, organization_id: "org-other", recorded_by: "someone-else" });
    expect(res).toEqual({ ok: true });
    expect(upserted!.opts).toEqual({ onConflict: "session_id,kind" });
    expect(upserted!.row).toMatchObject({
      organization_id: "org-1",
      session_id: "s1",
      kind: "identity",
      status: "clear",
      method: "manual",
      summary: "ID matched",
      recorded_by: "user-1",
    });
    expect(upserted!.row.expires_at).toEqual(expect.any(String));
    expect(upserted!.row.checked_at).toEqual(expect.any(String));
  });

  it("only gives a clearance an expiry", async () => {
    await recordOnboardingCheck({ ...check, status: "flagged", summary: "On a watch list", validForDays: 90 });
    expect(upserted!.row.expires_at).toBeNull();
  });

  it("stamps no date on a check that is not done", async () => {
    await recordOnboardingCheck({ ...check, status: "pending" });
    expect(upserted!.row.checked_at).toBeNull();
  });

  it("rejects bad input without touching the database", async () => {
    expect((await recordOnboardingCheck({ ...check, kind: "nope" })).ok).toBe(false);
    expect((await recordOnboardingCheck({ ...check, status: "failed", summary: "" })).ok).toBe(false);
    expect(upserted).toBeNull();
  });

  it("hides the database error from the caller", async () => {
    writeError = { code: "42501", message: "row-level security policy" };
    expect(await recordOnboardingCheck(check)).toEqual({ ok: false, error: "Couldn't save. Try again." });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("recordOnboardingDecision", () => {
  it("records a decision as the signed-in admin, in the session's organization", async () => {
    const res = await recordOnboardingDecision({ ...decision, organization_id: "org-other", decided_by: "someone-else" });
    expect(res).toEqual({ ok: true });
    expect(inserted).toEqual({
      organization_id: "org-1",
      session_id: "s1",
      decision: "rejected",
      reason: "Could not verify the source of funds",
      decided_by: "user-1",
    });
  });

  it("will not approve while a required check is missing", async () => {
    checkRows = allClear().filter((c) => c.kind !== "sanctions");
    const res = await recordOnboardingDecision({ ...decision, decision: "approved", reason: "Looks fine" });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("not done: Sanctions") });
    expect(inserted).toBeNull();
  });

  it("will not approve with a flagged check", async () => {
    checkRows = allClear().map((c) => (c.kind === "adverse_media" ? { ...c, status: "flagged" } : c));
    const res = await recordOnboardingDecision({ ...decision, decision: "approved", reason: "Looks fine" });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("flagged: Adverse media") });
    expect(inserted).toBeNull();
  });

  it("will not approve on an expired clearance", async () => {
    checkRows = allClear().map((c) => (c.kind === "identity" ? { ...c, expires_at: "2020-01-01T00:00:00Z" } : c));
    const res = await recordOnboardingDecision({ ...decision, decision: "approved", reason: "Looks fine" });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("expired: Identity") });
    expect(inserted).toBeNull();
  });

  it("approves once every required check is clear", async () => {
    checkRows = allClear();
    expect(await recordOnboardingDecision({ ...decision, decision: "approved", reason: "All clear" })).toEqual({ ok: true });
    expect(inserted).toMatchObject({ decision: "approved", decided_by: "user-1" });
  });

  it("lets an LP be rejected or sent back for information with nothing recorded", async () => {
    expect((await recordOnboardingDecision({ ...decision, decision: "rejected" })).ok).toBe(true);
    expect((await recordOnboardingDecision({ ...decision, decision: "more_info" })).ok).toBe(true);
  });

  it("requires reasoning", async () => {
    expect((await recordOnboardingDecision({ ...decision, reason: "  " })).ok).toBe(false);
    expect(inserted).toBeNull();
  });

  it("hides the database error from the caller", async () => {
    writeError = { code: "42501", message: "row-level security policy" };
    expect(await recordOnboardingDecision(decision)).toEqual({ ok: false, error: "Couldn't save. Try again." });
  });
});
