jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const sendEmail = jest.fn(async (_i: unknown) => ({ ok: true, channel: "gmail", detail: "" }));
jest.mock("@/lib/email", () => ({
  escapeHtml: (s: string) => s.replace(/</g, "&lt;"),
  sendEmail: (i: unknown) => sendEmail(i),
}));

let envReady = true;
// Per-table results, and a log of every write.
let tables: Record<string, { data?: unknown; error?: { code: string; message: string } | null }> = {};
let writes: Array<{ table: string; op: string; row?: unknown; opts?: unknown; filters: Record<string, unknown> }> = [];
let updateReturn: unknown[] = [{ id: "s1" }];
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => envReady,
  createServiceClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let op = "select";
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((filters[c] = v), q),
        in: (c: string, v: unknown) => ((filters[c] = v), q),
        update: (row: unknown) => ((op = "update"), writes.push({ table, op, row, filters }), q),
        insert: (row: unknown) => ((op = "insert"), writes.push({ table, op, row, filters }), q),
        upsert: (row: unknown, opts: unknown) => ((op = "upsert"), writes.push({ table, op, row, opts, filters }), q),
        delete: () => ((op = "delete"), writes.push({ table, op, filters }), q),
        maybeSingle: async () => ({ data: tables[table]?.data ?? null, error: tables[table]?.error ?? null }),
        then: (resolve: (v: unknown) => void) =>
          resolve(op === "update" && table === "lp_onboarding_sessions" ? { data: updateReturn, error: tables[table]?.error ?? null } : { data: tables[table]?.data ?? [], error: tables[table]?.error ?? null }),
      };
      return q;
    },
  }),
}));

let session: Record<string, unknown> | null;
let pass = true;
let issue: unknown = { ok: true, code: "123456", expiresAt: "2099-01-01T00:00:00Z" };
let verify: unknown = { ok: true };
const grant = jest.fn(async (_id: string) => undefined);
jest.mock("@/lib/lp-access.server", () => ({
  getLinkSession: async () => session,
  hasLpPass: async () => pass,
  grantLpPass: (id: string) => grant(id),
  issueCode: async () => issue,
  verifyCode: async () => verify,
}));

import {
  grantConsentAction,
  requestAccessCodeAction,
  saveAccreditationAction,
  saveDetailsAction,
  saveOwnersAction,
  submitWizardAction,
  verifyAccessCodeAction,
} from "./wizard-actions";
import { CONSENT_SCOPES, CONSENT_TEXT_VERSION } from "@/lib/lp-wizard";

const liveSession = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  organization_id: "org-1",
  lp_name: "Jo Park",
  lp_email: "jo@example.com",
  status: "pending",
  review_state: "in_progress",
  lp_type: "individual",
  owner_threshold_pct: 25,
  expires_at: "2099-01-01T00:00:00Z",
  ...over,
});

const details = { legalName: "Jo Park", entityType: "individual", country: "US" };
const accreditation = { basis: "accredited_investor", statement: true, sourceOfFunds: "Sale of my company in 2022" };

beforeEach(() => {
  envReady = true;
  tables = {};
  writes = [];
  updateReturn = [{ id: "s1" }];
  session = liveSession();
  pass = true;
  issue = { ok: true, code: "123456", expiresAt: "2099-01-01T00:00:00Z" };
  verify = { ok: true };
  grant.mockClear();
  sendEmail.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const UNAVAILABLE = { ok: false, error: "This link isn't available. Contact your fund manager." };

describe("every step needs a live link and a code pass", () => {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["saveDetails", () => saveDetailsAction("tok", details)],
    ["saveOwners", () => saveOwnersAction("tok", [{ fullName: "A", role: "controller" }])],
    ["grantConsent", () => grantConsentAction("tok", { scope: "identity_verification", typedName: "Jo" })],
    ["saveAccreditation", () => saveAccreditationAction("tok", accreditation)],
    ["submit", () => submitWizardAction("tok")],
  ];

  it.each(steps)("%s refuses without a pass", async (_n, call) => {
    pass = false;
    expect(await call()).toEqual(UNAVAILABLE);
    expect(writes).toEqual([]);
  });

  it.each(steps)("%s refuses an unknown or expired link", async (_n, call) => {
    session = null;
    expect(await call()).toEqual(UNAVAILABLE);
    expect(writes).toEqual([]);
  });

  it.each(steps)("%s refuses when the service is not configured", async (_n, call) => {
    envReady = false;
    expect(await call()).toEqual(UNAVAILABLE);
    expect(writes).toEqual([]);
  });

  it.each(["submitted", "approved", "rejected"])("%s is read-only for every step once the LP is %s", async (state) => {
    session = liveSession({ review_state: state, lp_type: "entity" });
    for (const [, call] of steps) {
      const res = (await call()) as { ok: boolean };
      expect(res.ok).toBe(false);
    }
    expect(writes).toEqual([]);
  });

  it("stays open to an LP who was asked for changes", async () => {
    session = liveSession({ review_state: "changes_requested" });
    expect(await saveDetailsAction("tok", details)).toEqual({ ok: true });
  });
});

describe("requestAccessCodeAction", () => {
  it("emails the code to the address the fund manager entered, and masks it back", async () => {
    tables.organizations = { data: { name: "Acme <Capital>" } };
    const res = await requestAccessCodeAction("tok");
    expect(res).toEqual({ ok: true, sent: true, maskedEmail: "j•••@example.com" });
    const mail = sendEmail.mock.calls[0][0] as { orgId: string; to: { email: string }; htmlBody: string; subject: string };
    expect(mail.orgId).toBe("org-1");
    expect(mail.to.email).toBe("jo@example.com");
    expect(mail.htmlBody).toContain("123456");
    expect(mail.htmlBody).not.toContain("<Capital>");
  });

  it("still succeeds, saying so, when the email could not go out", async () => {
    sendEmail.mockResolvedValueOnce({ ok: false, channel: "none", detail: "no mailbox" });
    expect(await requestAccessCodeAction("tok")).toMatchObject({ ok: true, sent: false });
  });

  it("passes on the rate limit and sends nothing", async () => {
    issue = { ok: false, error: "A code was just sent." };
    expect(await requestAccessCodeAction("tok")).toEqual({ ok: false, error: "A code was just sent." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses an unknown or rejected link", async () => {
    session = null;
    expect(await requestAccessCodeAction("tok")).toEqual(UNAVAILABLE);
    session = liveSession({ review_state: "rejected" });
    expect(await requestAccessCodeAction("tok")).toEqual(UNAVAILABLE);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("verifyAccessCodeAction", () => {
  it("grants the pass and starts the review the first time in", async () => {
    session = liveSession({ review_state: "not_started" });
    expect(await verifyAccessCodeAction("tok", "123456")).toEqual({ ok: true });
    expect(grant).toHaveBeenCalledWith("s1");
    expect(writes).toEqual([expect.objectContaining({ table: "lp_onboarding_sessions", op: "update", row: { review_state: "in_progress" }, filters: { id: "s1" } })]);
  });

  it("leaves the state alone on a return visit", async () => {
    session = liveSession({ review_state: "submitted" });
    expect(await verifyAccessCodeAction("tok", "123456")).toEqual({ ok: true });
    expect(writes).toEqual([]);
  });

  it("grants nothing for a wrong code", async () => {
    verify = { ok: false, error: "That code isn't right." };
    expect(await verifyAccessCodeAction("tok", "000000")).toEqual({ ok: false, error: "That code isn't right." });
    expect(grant).not.toHaveBeenCalled();
  });

  it("grants nothing on a rejected or unknown link", async () => {
    session = liveSession({ review_state: "rejected" });
    expect(await verifyAccessCodeAction("tok", "123456")).toEqual(UNAVAILABLE);
    session = null;
    expect(await verifyAccessCodeAction("tok", "123456")).toEqual(UNAVAILABLE);
    expect(grant).not.toHaveBeenCalled();
  });
});

describe("saveDetailsAction", () => {
  it("saves against the session's own organization, ignoring anything the client adds", async () => {
    const res = await saveDetailsAction("tok", { ...details, organization_id: "org-evil", session_id: "other" });
    expect(res).toEqual({ ok: true });
    expect(writes[0]).toMatchObject({ table: "lp_onboarding_profiles", op: "upsert", opts: { onConflict: "session_id" } });
    expect(writes[0].row).toMatchObject({ session_id: "s1", organization_id: "org-1", legal_name: "Jo Park" });
  });
  it("rejects bad input before writing", async () => {
    expect((await saveDetailsAction("tok", { ...details, legalName: "" })).ok).toBe(false);
    expect(writes).toEqual([]);
  });
  it("hides a database error", async () => {
    tables.lp_onboarding_profiles = { error: { code: "42501", message: "rls" } };
    expect(await saveDetailsAction("tok", details)).toEqual({ ok: false, error: "Couldn't save. Try again." });
  });
});

describe("saveOwnersAction", () => {
  const list = [
    { fullName: "Jo Park", role: "controller", ownershipPct: "", country: "US" },
    { fullName: "Sam Lee", role: "owner", ownershipPct: 40, country: "" },
  ];
  it("is only for entities", async () => {
    session = liveSession({ lp_type: "individual" });
    expect((await saveOwnersAction("tok", list)).ok).toBe(false);
    expect(writes).toEqual([]);
  });
  it("adds the new list before removing the old one", async () => {
    session = liveSession({ lp_type: "entity" });
    tables.lp_onboarding_owners = { data: [{ id: "old1" }] };
    expect(await saveOwnersAction("tok", list)).toEqual({ ok: true });
    expect(writes.map((w) => w.op)).toEqual(["insert", "delete"]);
    expect((writes[0].row as Array<Record<string, unknown>>)[0]).toMatchObject({ organization_id: "org-1", session_id: "s1", full_name: "Jo Park" });
    expect(writes[1].filters).toEqual({ id: ["old1"] });
  });
  it("clears the old rows first when both lists together would pass the 25-person cap", async () => {
    session = liveSession({ lp_type: "entity" });
    tables.lp_onboarding_owners = { data: Array.from({ length: 24 }, (_, i) => ({ id: `o${i}` })) };
    await saveOwnersAction("tok", list);
    expect(writes.map((w) => w.op)).toEqual(["delete", "insert"]);
  });
  it("needs a controller", async () => {
    session = liveSession({ lp_type: "entity" });
    expect((await saveOwnersAction("tok", [list[1]])).ok).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("grantConsentAction", () => {
  it("records the consent at the current wording, with the typed name", async () => {
    expect(await grantConsentAction("tok", { scope: "background_screening", typedName: " Jo Park " })).toEqual({ ok: true });
    expect(writes[0]).toMatchObject({
      table: "lp_onboarding_consents",
      op: "insert",
      row: { organization_id: "org-1", session_id: "s1", scope: "background_screening", text_version: CONSENT_TEXT_VERSION, typed_name: "Jo Park" },
    });
  });
  it("rejects an unknown scope or an unsigned consent", async () => {
    expect((await grantConsentAction("tok", { scope: "everything", typedName: "Jo" })).ok).toBe(false);
    expect((await grantConsentAction("tok", { scope: "identity_verification", typedName: "" })).ok).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("saveAccreditationAction", () => {
  it("records the statement with a timestamp", async () => {
    expect(await saveAccreditationAction("tok", accreditation)).toEqual({ ok: true });
    expect(writes[0].row).toMatchObject({ session_id: "s1", organization_id: "org-1", accreditation_basis: "accredited_investor", source_of_funds: "Sale of my company in 2022" });
    expect((writes[0].row as { accreditation_statement_at: string }).accreditation_statement_at).toEqual(expect.any(String));
  });
  it("does not accept an unticked statement", async () => {
    expect((await saveAccreditationAction("tok", { ...accreditation, statement: false })).ok).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("submitWizardAction", () => {
  const completeProfile = {
    legal_name: "Jo Park",
    entity_type: "individual",
    country: "US",
    signatory_name: null,
    signatory_title: null,
    source_of_funds: "Sale of my company in 2022",
    accreditation_basis: "accredited_investor",
    accreditation_statement_at: "2026-10-31T00:00:00Z",
  };
  const consents = CONSENT_SCOPES.map((scope) => ({ scope, text_version: CONSENT_TEXT_VERSION }));

  it("will not submit with steps outstanding, and names them", async () => {
    tables.lp_onboarding_profiles = { data: null };
    tables.lp_onboarding_consents = { data: [] };
    const res = await submitWizardAction("tok");
    expect(res).toEqual({ ok: false, error: expect.stringContaining("Your details") });
    expect(writes).toEqual([]);
  });

  it("submits a finished wizard, and queues the accreditation claim for the reviewer without overwriting one", async () => {
    tables.lp_onboarding_profiles = { data: completeProfile };
    tables.lp_onboarding_consents = { data: consents };
    expect(await submitWizardAction("tok")).toEqual({ ok: true });
    const update = writes.find((w) => w.table === "lp_onboarding_sessions")!;
    expect(update.row).toMatchObject({ review_state: "submitted" });
    expect(update.filters).toMatchObject({ id: "s1", review_state: ["not_started", "in_progress", "changes_requested"] });
    const check = writes.find((w) => w.table === "onboarding_checks")!;
    expect(check.opts).toEqual({ onConflict: "session_id,kind", ignoreDuplicates: true });
    expect(check.row).toMatchObject({ kind: "accreditation", status: "pending", organization_id: "org-1", session_id: "s1" });
    expect((check.row as { summary: string }).summary).toContain("Accredited investor");
  });

  it("does nothing, and says so, if the session already moved on (a double click)", async () => {
    tables.lp_onboarding_profiles = { data: completeProfile };
    tables.lp_onboarding_consents = { data: consents };
    updateReturn = [];
    expect((await submitWizardAction("tok")).ok).toBe(false);
    expect(writes.some((w) => w.table === "onboarding_checks")).toBe(false);
  });
});
