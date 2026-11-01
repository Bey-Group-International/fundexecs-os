jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

let auth: unknown = { ok: true, ctx: { orgId: "org-1", userId: "user-1", role: "admin" } };
jest.mock("@/lib/auth", () => ({ requireOrgContext: async () => auth }));

// What the fake database returns and what it was asked to write.
let sessionFound = true;
let reviewState = "submitted";
let checkRows: Array<{ kind: string; status: string; expires_at: string | null }> = [];
let writeError: { code: string; message: string } | null = null;
let upserted: { row: Record<string, unknown>; opts: unknown } | null = null;
let inserted: Record<string, unknown> | null = null;
const sessionFilters: Record<string, unknown> = {};

let serviceEnv = true;
const SERVICE_CLIENT = { marker: "service-role" };
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => serviceEnv,
  createServiceClient: () => SERVICE_CLIENT,
  createServerClient: async () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          if (table === "lp_onboarding_sessions") sessionFilters[c] = v;
          return q;
        },
        maybeSingle: async () => ({ data: sessionFound ? { id: "s1", review_state: reviewState } : null }),
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

let refreshResult: unknown = { ok: true, state: "verified", url: null };
const refreshIdentity = jest.fn(async (..._a: unknown[]) => refreshResult);
jest.mock("@/lib/lp-identity.server", () => ({ refreshIdentityCheck: (...a: unknown[]) => refreshIdentity(...a) }));

const recordAudit = jest.fn(async (..._a: unknown[]) => true);
jest.mock("@/lib/lp-audit.server", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));
const audited = () => recordAudit.mock.calls.map((c) => c[1] as Record<string, unknown>);

let ofacResult: unknown = { ok: true, flagged: 0, screened: 2, wrote: true };
const runOfac = jest.fn(async (..._a: unknown[]) => ofacResult);
jest.mock("@/lib/ofac.server", () => ({ runOfacScreen: (...a: unknown[]) => runOfac(...a) }));

import { recordOnboardingCheck, recordOnboardingDecision, refreshIdentityCheckAction, runOfacScreenAction } from "./onboarding-actions";

const allClear = () =>
  ["identity", "sanctions", "pep", "adverse_media", "accreditation"].map((kind) => ({ kind, status: "clear", expires_at: null }));

beforeEach(() => {
  auth = { ok: true, ctx: { orgId: "org-1", userId: "user-1", role: "admin" } };
  sessionFound = true;
  serviceEnv = true;
  reviewState = "submitted";
  checkRows = [];
  writeError = null;
  upserted = null;
  inserted = null;
  recordAudit.mockClear();
  for (const k of Object.keys(sessionFilters)) delete sessionFilters[k];
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const check = { sessionId: "s1", kind: "identity", status: "clear", summary: "ID matched", validForDays: 90 };
const decision = { sessionId: "s1", decision: "rejected", reason: "Could not verify the source of funds" };

describe.each([
  ["recordOnboardingCheck", () => recordOnboardingCheck(check)],
  ["recordOnboardingDecision", () => recordOnboardingDecision(decision)],
  ["refreshIdentityCheckAction", () => refreshIdentityCheckAction("s1")],
  ["runOfacScreenAction", () => runOfacScreenAction("s1")],
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

  describe("by the LP's stage", () => {
    it.each(["not_started", "in_progress", "changes_requested"])("will not approve or send back an LP who is %s", async (state) => {
      reviewState = state;
      checkRows = allClear();
      for (const d of ["approved", "more_info"] as const) {
        const res = await recordOnboardingDecision({ ...decision, decision: d, reason: "Because" });
        expect(res.ok).toBe(false);
      }
      expect(inserted).toBeNull();
    });

    it.each(["not_started", "in_progress", "changes_requested", "submitted"])("can always reject an LP who is %s", async (state) => {
      reviewState = state;
      expect((await recordOnboardingDecision(decision)).ok).toBe(true);
    });

    it.each(["approved", "rejected"])("takes no further decision on an LP who is %s", async (state) => {
      reviewState = state;
      checkRows = allClear();
      for (const d of ["approved", "more_info", "rejected"] as const) {
        expect((await recordOnboardingDecision({ ...decision, decision: d, reason: "Because" })).ok).toBe(false);
      }
      expect(inserted).toBeNull();
    });
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

describe("refreshIdentityCheckAction", () => {
  beforeEach(() => {
    refreshResult = { ok: true, state: "verified", url: null };
    refreshIdentity.mockClear();
  });

  it("asks Stripe for this organization's LP and says whether they are verified", async () => {
    expect(await refreshIdentityCheckAction("s1")).toEqual({ ok: true, verified: true });
    expect(refreshIdentity).toHaveBeenCalledWith(SERVICE_CLIENT, "s1", "org-1");
    refreshResult = { ok: true, state: "processing", url: null };
    expect(await refreshIdentityCheckAction("s1")).toEqual({ ok: true, verified: false });
  });

  it("records who asked for the refresh, and what it found, on the row the system wrote", async () => {
    refreshResult = { ok: true, state: "processing", url: null };
    await refreshIdentityCheckAction("s1");
    expect(recordAudit).toHaveBeenCalledWith(SERVICE_CLIENT, { orgId: "org-1", sessionId: "s1", action: "check.refreshed", actorKind: "user", actorId: "user-1", detail: { state: "processing" } });
  });

  it("records nothing for a refresh that failed", async () => {
    refreshResult = { ok: false, error: "We couldn't reach the verification service. Try again in a moment." };
    await refreshIdentityCheckAction("s1");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("passes on a failure to reach Stripe", async () => {
    refreshResult = { ok: false, error: "We couldn't reach the verification service. Try again in a moment." };
    expect(await refreshIdentityCheckAction("s1")).toEqual({ ok: false, error: expect.stringContaining("couldn't reach") });
  });

  it("refuses a missing or non-text id without asking Stripe", async () => {
    expect((await refreshIdentityCheckAction(undefined)).ok).toBe(false);
    expect((await refreshIdentityCheckAction("")).ok).toBe(false);
    expect(refreshIdentity).not.toHaveBeenCalled();
  });
});

describe("runOfacScreenAction", () => {
  beforeEach(() => {
    ofacResult = { ok: true, flagged: 0, screened: 2, wrote: true };
    runOfac.mockClear();
  });

  it("screens this organization's LP and reports what it found", async () => {
    expect(await runOfacScreenAction("s1")).toEqual({ ok: true, flagged: 0, screened: 2, wrote: true });
    expect(runOfac).toHaveBeenCalledWith(SERVICE_CLIENT, "s1", "org-1", { actor: { kind: "user", id: "user-1" } });
    ofacResult = { ok: true, flagged: 1, screened: 2, wrote: false };
    expect(await runOfacScreenAction("s1")).toEqual({ ok: true, flagged: 1, screened: 2, wrote: false });
  });

  it("passes on a failure to get the list", async () => {
    ofacResult = { ok: false, error: "Couldn't get OFAC's list just now." };
    expect(await runOfacScreenAction("s1")).toEqual({ ok: false, error: expect.stringContaining("OFAC's list") });
  });

  it("refuses a missing id without screening", async () => {
    expect((await runOfacScreenAction(undefined)).ok).toBe(false);
    expect((await runOfacScreenAction("")).ok).toBe(false);
    expect(runOfac).not.toHaveBeenCalled();
  });
});

// The checks table lets a signed-in user write only rows stamped with their own id
// (recorded_by = auth.uid()). These two results are recorded by the system, so
// done with the signed-in client the database would refuse every write. They run
// on the service role instead, only after the caller is confirmed an admin of
// the LP's own organization.
describe.each([
  ["refreshIdentityCheckAction", () => refreshIdentityCheckAction("s1"), refreshIdentity],
  ["runOfacScreenAction", () => runOfacScreenAction("s1"), runOfac],
] as const)("%s writes as the system", (_name, call, work) => {
  beforeEach(() => {
    refreshResult = { ok: true, state: "verified", url: null };
    ofacResult = { ok: true, flagged: 0, screened: 1, wrote: true };
    work.mockClear();
  });

  it("uses the service role, never the signed-in client", async () => {
    await call();
    expect(work).toHaveBeenCalledTimes(1);
    expect(work.mock.calls[0][0]).toBe(SERVICE_CLIENT);
  });

  it("still checks the caller and the LP's organization first", async () => {
    sessionFound = false;
    expect(await call()).toEqual({ ok: false, error: "That LP wasn't found." });
    auth = { ok: true, ctx: { orgId: "org-1", userId: "user-1", role: "member" } };
    expect((await call()).ok).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });

  it("does nothing, and says so, where the service role isn't configured", async () => {
    serviceEnv = false;
    expect(await call()).toEqual({ ok: false, error: "Couldn't save. Try again." });
    expect(work).not.toHaveBeenCalled();
  });
});
