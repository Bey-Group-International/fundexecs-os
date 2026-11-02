let session: Record<string, unknown> | null;
let pass: boolean;
const record = jest.fn(async (_c: unknown, _a: unknown): Promise<{ ok: boolean; alreadyAsked?: boolean }> => ({ ok: true, alreadyAsked: false }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Acme Capital" } }) }) }) }) }),
}));
jest.mock("@/lib/lp-access.server", () => ({ getLinkSession: async () => session, hasLpPass: async () => pass }));
jest.mock("@/lib/lp-privacy-request.server", () => ({ recordPrivacyRequest: (c: unknown, a: unknown) => record(c, a) }));

import { requestPrivacyAction } from "./privacy-actions";

beforeEach(() => {
  session = { id: "s1", organization_id: "org-1", lp_name: "Jane Doe" };
  pass = true;
  record.mockClear();
  record.mockResolvedValue({ ok: true, alreadyAsked: false });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("requestPrivacyAction", () => {
  it("records the request for this LP's session and organization, and confirms who will answer", async () => {
    const r = await requestPrivacyAction("tok", "access");
    expect(record).toHaveBeenCalledWith(expect.anything(), { sessionId: "s1", orgId: "org-1", lpName: "Jane Doe", kind: "access" });
    expect(r).toMatchObject({ ok: true });
    expect((r as { message: string }).message).toContain("Acme Capital");
  });

  it("says so when it was already asked today", async () => {
    record.mockResolvedValue({ ok: true, alreadyAsked: true });
    expect(await requestPrivacyAction("tok", "erasure")).toMatchObject({ ok: true, message: expect.stringContaining("already asked") });
  });

  it("refuses without a live link or without the code check passed, recording nothing", async () => {
    session = null;
    expect(await requestPrivacyAction("tok", "access")).toMatchObject({ ok: false });
    session = { id: "s1", organization_id: "org-1", lp_name: "Jane" };
    pass = false;
    expect(await requestPrivacyAction("tok", "access")).toMatchObject({ ok: false });
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses anything but the two kinds", async () => {
    for (const bad of ["delete", "", undefined, 3]) expect(await requestPrivacyAction("tok", bad)).toMatchObject({ ok: false });
    expect(record).not.toHaveBeenCalled();
  });

  it("allows it in every review state: a rejected LP still has the right", async () => {
    session = { id: "s1", organization_id: "org-1", lp_name: "Jane", review_state: "rejected" };
    expect(await requestPrivacyAction("tok", "erasure")).toMatchObject({ ok: true });
  });

  it("reports a failure to record, without claiming it was sent", async () => {
    record.mockResolvedValue({ ok: false });
    const r = await requestPrivacyAction("tok", "access");
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/Try again/);
  });
});
