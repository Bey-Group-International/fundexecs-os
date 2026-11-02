jest.mock("server-only", () => ({}), { virtual: true });

const sendEmail = jest.fn(async (_a: unknown) => ({ ok: true }));
jest.mock("@/lib/email", () => ({ sendEmail: (a: unknown) => sendEmail(a), escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") }));
jest.mock("@/lib/integrations/adapters/app-url", () => ({ getAppUrl: () => "https://app.test" }));
const recordAudit = jest.fn(async (_c: unknown, _e: unknown) => true);
jest.mock("@/lib/lp-audit.server", () => ({ recordAudit: (c: unknown, e: unknown) => recordAudit(c, e) }));

import { recordPrivacyRequest } from "./lp-privacy-request.server";

let recent: Array<{ detail: { request?: string } | null }>;
let readError: { message: string } | null;
let auditFilters: Record<string, unknown>;
let threads: Array<Record<string, unknown>>;
let messages: Array<Record<string, unknown>>;
let threadError: { message: string } | null;
let members: Array<{ role: string; principal_id: string }>;
const NOW = Date.parse("2026-11-02T12:00:00Z");

const client = {
  from(table: string) {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => ((auditFilters[`${table}.${c}`] = v), q),
      gte: (c: string, v: unknown) => ((auditFilters[`${table}.${c}`] = v), q),
      in: () => q,
      order: () => q,
      limit: () => q,
      insert: (row: Record<string, unknown>) => {
        if (table === "inbox_threads") threads.push(row);
        if (table === "inbox_messages") messages.push(row);
        return q;
      },
      single: async () => (threadError ? { data: null, error: threadError } : { data: { id: "t1" }, error: null }),
      maybeSingle: async () => ({ data: { name: "Acme" }, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (table === "onboarding_audit_log") return resolve({ data: recent, error: readError });
        if (table === "organization_members") return resolve({ data: members, error: null });
        if (table === "principals") return resolve({ data: [{ id: "p1", email: "owner@acme.test", full_name: "Olive" }, { id: "p2", email: "admin@acme.test", full_name: "Adam" }], error: null });
        resolve({ error: null });
      },
    };
    return q;
  },
} as never;

const args = { sessionId: "s1", orgId: "org-1", lpName: "Jane Doe", kind: "erasure" as const, now: NOW };

beforeEach(() => {
  recent = [];
  readError = null;
  auditFilters = {};
  threads = [];
  messages = [];
  threadError = null;
  members = [{ role: "owner", principal_id: "p1" }, { role: "admin", principal_id: "p2" }];
  sendEmail.mockClear();
  recordAudit.mockClear();
  recordAudit.mockResolvedValue(true);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("recordPrivacyRequest", () => {
  it("records the request as the LP, posts an Inbox thread and emails the owners and admins", async () => {
    expect(await recordPrivacyRequest(client, args)).toEqual({ ok: true, alreadyAsked: false });
    expect(recordAudit).toHaveBeenCalledWith(client, { orgId: "org-1", sessionId: "s1", action: "privacy.requested", actorKind: "lp", detail: { request: "erasure" } });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ organization_id: "org-1", channel: "lp_onboarding", subject: "Jane Doe asked for their data to be erased" });
    expect(messages).toHaveLength(1);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls.map((c) => (c[0] as { to: { email: string } }).to.email).sort()).toEqual(["admin@acme.test", "owner@acme.test"]);
  });

  it("looks only at this LP's requests in the last day", async () => {
    await recordPrivacyRequest(client, args);
    expect(auditFilters).toMatchObject({
      "onboarding_audit_log.organization_id": "org-1",
      "onboarding_audit_log.session_id": "s1",
      "onboarding_audit_log.action": "privacy.requested",
      "onboarding_audit_log.created_at": "2026-11-01T12:00:00.000Z",
    });
  });

  it("does not repeat a request of the same kind within the day, and tells nobody again", async () => {
    recent = [{ detail: { request: "erasure" } }];
    expect(await recordPrivacyRequest(client, args)).toEqual({ ok: true, alreadyAsked: true });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(threads).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("lets the other kind through", async () => {
    recent = [{ detail: { request: "access" } }];
    expect(await recordPrivacyRequest(client, args)).toEqual({ ok: true, alreadyAsked: false });
  });

  it("fails, and tells nobody, if the request cannot be recorded", async () => {
    recordAudit.mockResolvedValue(false);
    expect(await recordPrivacyRequest(client, args)).toEqual({ ok: false });
    expect(threads).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("fails if it cannot tell whether it was already asked", async () => {
    readError = { message: "boom" };
    expect(await recordPrivacyRequest(client, args)).toEqual({ ok: false });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("still succeeds when the Inbox alert or an email cannot go: the request itself is recorded", async () => {
    threadError = { message: "no thread" };
    sendEmail.mockResolvedValue({ ok: false } as never);
    expect(await recordPrivacyRequest(client, args)).toEqual({ ok: true, alreadyAsked: false });
    expect(recordAudit).toHaveBeenCalledWith(client, expect.objectContaining({ action: "email.sent", detail: { kind: "privacy_notice", sent: 0, failed: 2 } }));
  });

  it("never puts the LP's details in what it sends", async () => {
    await recordPrivacyRequest(client, args);
    const body = JSON.stringify([threads, messages, sendEmail.mock.calls]);
    expect(body).not.toMatch(/@jane|passport|ssn|\d{9}/i);
  });
});
