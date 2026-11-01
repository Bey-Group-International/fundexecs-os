jest.mock("server-only", () => ({}), { virtual: true });

let row: { status: string; method: string; vendor_ref: string | null } | null = null;
let updateError: { code: string; message: string } | null = null;
let update: { patch: Record<string, unknown>; filters: Record<string, unknown> } | null = null;
const supabase = {
  from: () => {
    const filters: Record<string, unknown> = {};
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => ((filters[c] = v), q),
      update: (patch: Record<string, unknown>) => ((update = { patch, filters }), q),
      maybeSingle: async () => ({ data: row }),
      then: (resolve: (v: unknown) => void) => resolve({ error: updateError }),
    };
    return q;
  },
} as never;

let status: unknown;
const getStatus = jest.fn(async (_id: string, _org: string): Promise<unknown> => status);
jest.mock("@/lib/providers/stripe-identity", () => ({ stripeIdentityProvider: { getStatus: (id: string, org: string) => getStatus(id, org) } }));

import { readIdentityCheck, refreshIdentityCheck } from "./lp-identity.server";

const stripe = (providerStatus: string, mapped: string, extra: Record<string, unknown> = {}, reference?: string) => ({
  ok: true,
  live: true,
  detail: "",
  ...(reference ? { reference } : {}),
  data: { verificationId: "vs_1", level: "kyc", status: mapped, providerStatus, ...extra },
});

beforeEach(() => {
  row = { status: "pending", method: "stripe_identity", vendor_ref: "vs_1" };
  updateError = null;
  update = null;
  getStatus.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("refreshIdentityCheck", () => {
  it("records a verified result as cleared, scoped to a still-pending Stripe check", async () => {
    status = stripe("verified", "approved");
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toEqual({ ok: true, state: "verified", url: null });
    expect(getStatus).toHaveBeenCalledWith("vs_1", "org-1");
    expect(update!.patch).toMatchObject({ status: "clear", expires_at: expect.any(String), checked_at: expect.any(String) });
    expect(update!.filters).toEqual({ session_id: "s1", organization_id: "org-1", kind: "identity", method: "stripe_identity", status: "pending" });
  });

  it("keeps a verification in progress pending, and offers the link while it can be finished", async () => {
    status = stripe("requires_input", "pending", {}, "https://verify.stripe.com/start/x");
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toEqual({ ok: true, state: "needs_input", url: "https://verify.stripe.com/start/x" });
    expect((update!.patch as { status: string }).status).toBe("pending");
    status = stripe("processing", "pending");
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toEqual({ ok: true, state: "processing", url: null });
  });

  it("fails a canceled verification", async () => {
    status = stripe("canceled", "rejected");
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toMatchObject({ ok: true, state: "canceled" });
    expect((update!.patch as { status: string }).status).toBe("failed");
  });

  it("doesn't call Stripe for a check that's already settled, and never rewrites it", async () => {
    row = { status: "clear", method: "stripe_identity", vendor_ref: "vs_1" };
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toEqual({ ok: true, state: "verified", url: null });
    row = { status: "failed", method: "stripe_identity", vendor_ref: "vs_1" };
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toMatchObject({ state: "canceled" });
    expect(getStatus).not.toHaveBeenCalled();
    expect(update).toBeNull();
  });

  it("leaves a check recorded by hand, or not started, alone", async () => {
    row = { status: "pending", method: "manual", vendor_ref: null };
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toEqual({ ok: true, state: "none", url: null });
    row = { status: "clear", method: "manual", vendor_ref: null };
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toMatchObject({ state: "verified" });
    row = null;
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toMatchObject({ state: "none" });
    expect(getStatus).not.toHaveBeenCalled();
    expect(update).toBeNull();
  });

  it("reports a Stripe failure without changing the check", async () => {
    status = { ok: false, live: false, detail: "x" };
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toMatchObject({ ok: false });
    expect(update).toBeNull();
  });

  it("hides a database error", async () => {
    status = stripe("verified", "approved");
    updateError = { code: "42501", message: "rls" };
    expect(await refreshIdentityCheck(supabase, "s1", "org-1")).toEqual({ ok: false, error: "Couldn't save the result. Try again." });
  });
});

describe("organization scoping", () => {
  it("names the organization on the read and on the write, since the service role bypasses row-level security", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const spy = {
      from: () => {
        const filters: Record<string, unknown> = {};
        const q: Record<string, unknown> = {
          select: () => q,
          eq: (c: string, v: unknown) => ((filters[c] = v), q),
          update: () => ((q as { __u: boolean }).__u = true, q),
          maybeSingle: async () => (seen.push({ ...filters }), { data: row }),
          then: (resolve: (v: unknown) => void) => (seen.push({ ...filters, write: true }), resolve({ error: null })),
        };
        return q;
      },
    } as never;
    status = stripe("verified", "approved");
    await refreshIdentityCheck(spy, "s1", "org-1");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ session_id: "s1", organization_id: "org-1" });
    expect(seen[1]).toMatchObject({ session_id: "s1", organization_id: "org-1", write: true });
  });
});

describe("readIdentityCheck", () => {
  it("returns the check on file, or null", async () => {
    expect(await readIdentityCheck(supabase, "s1")).toEqual(row);
    row = null;
    expect(await readIdentityCheck(supabase, "s1")).toBeNull();
  });
});
