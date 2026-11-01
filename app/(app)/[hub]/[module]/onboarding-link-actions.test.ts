jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

let auth: unknown;
jest.mock("@/lib/auth", () => ({ requireOrgContext: async () => auth }));

const sendEmail = jest.fn(async (_i: unknown): Promise<{ ok: boolean; channel: string; detail: string }> => ({ ok: true, channel: "gmail", detail: "sent" }));
jest.mock("@/lib/email", () => ({ escapeHtml: (s: string) => s.replace(/</g, "&lt;"), sendEmail: (i: unknown) => sendEmail(i) }));
jest.mock("@/lib/integrations/adapters/app-url", () => ({ getAppUrl: () => "https://app.example.com" }));

const issueCode = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true, code: "482913", expiresAt: "2099-01-01T00:00:00Z" }));
jest.mock("@/lib/lp-access.server", () => ({ issueCode: (...a: unknown[]) => issueCode(...a) }));

let fundFound = true;
let sessionRow: Record<string, unknown> | null;
let insertError: { code: string; message: string } | null = null;
let inserted: Record<string, unknown> | null = null;
const filters: Record<string, Record<string, unknown>> = {};
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({ service: true }),
  createServerClient: async () => ({
    from(table: string) {
      filters[table] = {};
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((filters[table][c] = v), q),
        insert: (row: Record<string, unknown>) => ((inserted = row), q),
        single: async () => ({ data: insertError ? null : { id: "s9", token: "tok-abc" }, error: insertError }),
        maybeSingle: async () => {
          if (table === "funds") return { data: fundFound ? { id: "f1" } : null };
          if (table === "organizations") return { data: { name: "Acme <Capital>" } };
          return { data: sessionRow };
        },
      };
      return q;
    },
  }),
}));

const recordAudit = jest.fn(async (..._a: unknown[]) => true);
jest.mock("@/lib/lp-audit.server", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));
const audited = () => recordAudit.mock.calls.map((c) => c[1] as Record<string, unknown>);

let carryResult: unknown[] = [];
const carryForward = jest.fn(async (..._a: unknown[]) => carryResult);
jest.mock("@/lib/lp-reuse.server", () => ({ carryForwardChecks: (...a: unknown[]) => carryForward(...a) }));

import { createLpLinkAction, emailLpLinkAction, generateAccessCodeAction } from "./onboarding-link-actions";

const FUTURE = "2099-01-01T00:00:00Z";
const link = { lpName: "Calpers", lpEmail: "ops@calpers.ca.gov", lpType: "institutional" };
const row = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  organization_id: "org-1",
  lp_name: "Calpers",
  lp_email: "ops@calpers.ca.gov",
  token: "tok-abc",
  review_state: "not_started",
  expires_at: FUTURE,
  ...over,
});

beforeEach(() => {
  auth = { ok: true, ctx: { orgId: "org-1", userId: "user-1", role: "admin" } };
  fundFound = true;
  sessionRow = row();
  insertError = null;
  inserted = null;
  for (const k of Object.keys(filters)) delete filters[k];
  sendEmail.mockClear();
  issueCode.mockClear();
  carryResult = [];
  carryForward.mockClear();
  recordAudit.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe.each([
  ["createLpLinkAction", () => createLpLinkAction(link)],
  ["emailLpLinkAction", () => emailLpLinkAction("s1")],
  ["generateAccessCodeAction", () => generateAccessCodeAction("s1")],
])("%s access", (_n, call) => {
  it("needs a signed-in member", async () => {
    auth = { ok: false, status: 401, error: "no" };
    expect(await call()).toEqual({ ok: false, error: "Sign in again to continue." });
  });
  it.each(["member", "viewer"])("refuses the %s role, touching nothing", async (role) => {
    auth = { ok: true, ctx: { orgId: "org-1", userId: "user-1", role } };
    expect(await call()).toEqual({ ok: false, error: "Only organization owners and admins can onboard LPs." });
    expect(inserted).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(issueCode).not.toHaveBeenCalled();
  });
});

describe("createLpLinkAction", () => {
  it("makes a session in the caller's organization that lasts seven days, and returns the link", async () => {
    const before = Date.now();
    const res = await createLpLinkAction({ ...link, organization_id: "org-evil", ownerThresholdPct: 10 });
    expect(res).toEqual({ ok: true, sessionId: "s9", url: "https://app.example.com/lp/tok-abc", carried: [] });
    expect(inserted).toMatchObject({ organization_id: "org-1", lp_name: "Calpers", lp_email: "ops@calpers.ca.gov", lp_type: "institutional", owner_threshold_pct: 10 });
    const days = (new Date(inserted!.expires_at as string).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });

  it("carries a returning LP's earlier ID verification onto the new link, as the system", async () => {
    carryResult = [{ kind: "identity", checkedAt: "2026-07-24T00:00:00Z", expiresAt: "2027-07-24T00:00:00Z" }];
    const res = await createLpLinkAction(link);
    expect(res).toMatchObject({ ok: true, carried: carryResult });
    expect(carryForward).toHaveBeenCalledWith({ service: true }, { orgId: "org-1", sessionId: "s9", email: "ops@calpers.ca.gov" });
  });

  it("does not look for an earlier onboarding when the link wasn't made", async () => {
    insertError = { code: "42501", message: "rls" };
    await createLpLinkAction(link);
    fundFound = false;
    insertError = null;
    await createLpLinkAction({ ...link, fundId: "f-other" });
    await createLpLinkAction({ ...link, lpEmail: "nope" });
    expect(carryForward).not.toHaveBeenCalled();
  });

  it("records who made the link, as that person, with no name or address", async () => {
    carryResult = [{ kind: "identity", checkedAt: "x", expiresAt: "y" }];
    await createLpLinkAction({ ...link, fundId: "f1" });
    expect(audited()).toEqual([
      { orgId: "org-1", sessionId: "s9", action: "link.created", actorKind: "user", actorId: "user-1", detail: { source: "run", lp_type: "institutional", has_fund: true, carried: 1 } },
    ]);
    expect(JSON.stringify(recordAudit.mock.calls)).not.toMatch(/calpers|tok-abc/i);
  });

  it("records nothing for a link that wasn't made", async () => {
    insertError = { code: "42501", message: "rls" };
    await createLpLinkAction(link);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("still makes the link when the audit write fails", async () => {
    recordAudit.mockResolvedValueOnce(false);
    expect(await createLpLinkAction(link)).toMatchObject({ ok: true, sessionId: "s9" });
  });

  it("defaults the owner threshold to 25%", async () => {
    await createLpLinkAction(link);
    expect(inserted!.owner_threshold_pct).toBe(25);
  });

  it("refuses a fund from another organization", async () => {
    fundFound = false;
    expect(await createLpLinkAction({ ...link, fundId: "f-other" })).toEqual({ ok: false, error: "That fund wasn't found." });
    expect(filters.funds).toEqual({ id: "f-other", organization_id: "org-1" });
    expect(inserted).toBeNull();
  });

  it("rejects bad input", async () => {
    expect((await createLpLinkAction({ ...link, lpEmail: "nope" })).ok).toBe(false);
    expect(inserted).toBeNull();
  });

  it("hides a database error", async () => {
    insertError = { code: "42501", message: "rls" };
    expect(await createLpLinkAction(link)).toEqual({ ok: false, error: "Couldn't do that. Try again." });
  });
});

describe("emailLpLinkAction", () => {
  it("emails the LP their link from the organization's mailbox", async () => {
    expect(await emailLpLinkAction("s1")).toEqual({ ok: true, sent: true, detail: "sent" });
    const mail = sendEmail.mock.calls[0][0] as { orgId: string; to: { email: string }; htmlBody: string; allowFallback: boolean };
    expect(mail.orgId).toBe("org-1");
    expect(mail.to.email).toBe("ops@calpers.ca.gov");
    expect(mail.htmlBody).toContain("https://app.example.com/lp/tok-abc");
    expect(mail.htmlBody).not.toContain("<Capital>");
    expect(mail.allowFallback).toBe(true);
    expect(filters.lp_onboarding_sessions).toEqual({ id: "s1", organization_id: "org-1" });
  });

  it("says plainly when the email could not be sent", async () => {
    sendEmail.mockResolvedValueOnce({ ok: false, channel: "none", detail: "no mailbox" });
    expect(await emailLpLinkAction("s1")).toMatchObject({ ok: true, sent: false });
  });

  it("records that the manager sent the link, and whether it went, without the address", async () => {
    await emailLpLinkAction("s1");
    sendEmail.mockResolvedValueOnce({ ok: false, channel: "none", detail: "no mailbox" });
    await emailLpLinkAction("s1");
    expect(audited()).toEqual([
      { orgId: "org-1", sessionId: "s1", action: "email.sent", actorKind: "user", actorId: "user-1", detail: { kind: "link", ok: true } },
      { orgId: "org-1", sessionId: "s1", action: "email.sent", actorKind: "user", actorId: "user-1", detail: { kind: "link", ok: false } },
    ]);
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("ops@calpers");
  });

  it("will not email a link for an LP outside the organization, a decided LP, or an expired link", async () => {
    sessionRow = null;
    expect(await emailLpLinkAction("s-other")).toEqual({ ok: false, error: "That LP wasn't found." });
    sessionRow = row({ review_state: "approved" });
    expect((await emailLpLinkAction("s1")).ok).toBe(false);
    sessionRow = row({ review_state: "rejected" });
    expect((await emailLpLinkAction("s1")).ok).toBe(false);
    sessionRow = row({ expires_at: "2020-01-01T00:00:00Z" });
    expect(await emailLpLinkAction("s1")).toEqual({ ok: false, error: "This link has expired. Make a new one." });
    expect(await emailLpLinkAction(42)).toEqual({ ok: false, error: "That LP wasn't found." });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("generateAccessCodeAction", () => {
  it("issues a fund-manager code through the service client, recorded against the signed-in user", async () => {
    expect(await generateAccessCodeAction("s1")).toEqual({ ok: true, code: "482913", expiresAt: FUTURE });
    expect(issueCode).toHaveBeenCalledWith({ service: true }, { id: "s1", organization_id: "org-1" }, "gp", "user-1");
  });

  it("passes on a rate-limit refusal", async () => {
    issueCode.mockResolvedValueOnce({ ok: false, error: "A code was just sent." });
    expect(await generateAccessCodeAction("s1")).toEqual({ ok: false, error: "A code was just sent." });
  });

  it("records that the manager issued a code, never the code, and nothing for a refusal", async () => {
    await generateAccessCodeAction("s1");
    expect(audited()).toEqual([{ orgId: "org-1", sessionId: "s1", action: "code.issued_by_manager", actorKind: "user", actorId: "user-1" }]);
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("482913");
    recordAudit.mockClear();
    issueCode.mockResolvedValueOnce({ ok: false, error: "A code was just sent." });
    await generateAccessCodeAction("s1");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses an LP outside the organization, a decided LP, and an expired link", async () => {
    sessionRow = null;
    expect((await generateAccessCodeAction("s-other")).ok).toBe(false);
    sessionRow = row({ review_state: "rejected" });
    expect((await generateAccessCodeAction("s1")).ok).toBe(false);
    sessionRow = row({ expires_at: "2020-01-01T00:00:00Z" });
    expect((await generateAccessCodeAction("s1")).ok).toBe(false);
    expect(issueCode).not.toHaveBeenCalled();
  });
});
