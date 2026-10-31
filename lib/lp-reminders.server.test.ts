jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/integrations/adapters/app-url", () => ({ getAppUrl: () => "https://app.example.com" }));

let mailboxSource: Record<string, string> = {};
const sendEmail = jest.fn(async (_a: unknown): Promise<{ ok: boolean; channel: string; detail: string }> => ({ ok: true, channel: "gmail", detail: "sent" }));
jest.mock("@/lib/email", () => ({
  escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
  getEmailConfigStatus: async (orgId: string) => ({ source: mailboxSource[orgId] ?? "none" }),
  sendEmail: (a: unknown) => sendEmail(a),
}));

import { runLpReminders } from "./lp-reminders.server";

const DAY = 86_400_000;
const NOW = new Date("2026-11-10T12:00:00Z");
const created = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

interface Row {
  id: string;
  organization_id: string;
  lp_name: string;
  lp_email: string;
  token: string;
  review_state: string;
  status: string;
  created_at: string;
  expires_at: string;
  reminded_day3_at: string | null;
  reminded_day6_at: string | null;
}
const row = (over: Partial<Row> = {}): Row => ({
  id: "s1",
  organization_id: "org-1",
  lp_name: "Jo Park",
  lp_email: "jo@example.com",
  token: "tok-1",
  review_state: "in_progress",
  status: "pending",
  created_at: created(4),
  expires_at: new Date(NOW.getTime() + 3 * DAY).toISOString(),
  reminded_day3_at: null,
  reminded_day6_at: null,
  ...over,
});

let rows: Row[] = [];
let lookupError: { message: string } | null = null;
let claimResult: Array<{ id: string }> = [{ id: "s1" }];
let updates: Array<{ patch: Record<string, unknown>; filters: Array<[string, string, unknown]> }> = [];
let lookups: Array<[string, string, unknown]> = [];
const client = {
  from(table: string) {
    const filters: Array<[string, string, unknown]> = [];
    let patch: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {
      select: () => q,
      in: (c: string, v: unknown) => (filters.push([c, "in", v]), q),
      neq: (c: string, v: unknown) => (filters.push([c, "neq", v]), q),
      gt: (c: string, v: unknown) => (filters.push([c, "gt", v]), q),
      lte: (c: string, v: unknown) => (filters.push([c, "lte", v]), q),
      or: (v: string) => (filters.push(["", "or", v]), q),
      eq: (c: string, v: unknown) => (filters.push([c, "eq", v]), q),
      is: (c: string, v: unknown) => (filters.push([c, "is", v]), q),
      order: () => q,
      limit: () => q,
      update: (p: Record<string, unknown>) => ((patch = p), q),
      maybeSingle: async () => ({ data: table === "organizations" ? { name: "Acme" } : null }),
      then: (resolve: (v: unknown) => void) => {
        if (patch) {
          updates.push({ patch, filters });
          return resolve({ data: claimResult, error: null });
        }
        if (table === "lp_onboarding_sessions") lookups = filters;
        return resolve({ data: lookupError ? null : rows, error: lookupError });
      },
    };
    return q;
  },
} as never;

beforeEach(() => {
  rows = [row()];
  lookupError = null;
  claimResult = [{ id: "s1" }];
  updates = [];
  lookups = [];
  mailboxSource = { "org-1": "org-oauth" };
  sendEmail.mockClear();
  sendEmail.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent" });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("runLpReminders", () => {
  it("emails a quiet LP from the organization's own mailbox, with no backup sender", async () => {
    const stats = await runLpReminders(client, { now: NOW });
    expect(stats).toEqual({ reminded: 1, noMailbox: 0, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0] as { orgId: string; to: { email: string }; htmlBody: string; allowFallback: boolean };
    expect(mail).toMatchObject({ orgId: "org-1", to: { email: "jo@example.com" }, allowFallback: false });
    expect(mail.htmlBody).toContain("https://app.example.com/lp/tok-1");
  });

  it("claims the reminder before sending, and only if nobody else already has", async () => {
    await runLpReminders(client, { now: NOW });
    const claim = updates[0];
    expect(claim.patch).toEqual({ reminded_day3_at: NOW.toISOString() });
    expect(claim.filters).toEqual(expect.arrayContaining([["id", "eq", "s1"], ["reminded_day3_at", "is", null]]));
  });

  it("looks only at LPs still filling in the wizard, whose link is live and at least 3 days old", async () => {
    await runLpReminders(client, { now: NOW });
    expect(lookups).toEqual(
      expect.arrayContaining([
        ["review_state", "in", ["not_started", "in_progress"]],
        ["status", "neq", "expired"],
        ["expires_at", "gt", NOW.toISOString()],
        ["created_at", "lte", new Date(NOW.getTime() - 3 * DAY).toISOString()],
      ]),
    );
  });

  it("a day-6 reminder also marks the day-3 one as covered", async () => {
    rows = [row({ created_at: created(6.5) })];
    await runLpReminders(client, { now: NOW });
    expect(updates[0].patch).toEqual({ reminded_day6_at: NOW.toISOString(), reminded_day3_at: NOW.toISOString() });
    expect((sendEmail.mock.calls[0][0] as { subject: string }).subject).toMatch(/expires soon/);
  });

  it("keeps an earlier day-3 stamp when sending day 6", async () => {
    const earlier = created(3);
    rows = [row({ created_at: created(6.5), reminded_day3_at: earlier })];
    await runLpReminders(client, { now: NOW });
    expect(updates[0].patch).toEqual({ reminded_day6_at: NOW.toISOString() });
  });

  it("sends nothing, and stamps nothing, where the organization has no mailbox of its own", async () => {
    for (const source of ["none", "deploy-env"]) {
      mailboxSource = { "org-1": source };
      updates = [];
      expect(await runLpReminders(client, { now: NOW })).toEqual({ reminded: 0, noMailbox: 1, failed: 0 });
      expect(updates).toEqual([]);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("accepts a stored organization token as the organization's own mailbox", async () => {
    mailboxSource = { "org-1": "org-token" };
    expect((await runLpReminders(client, { now: NOW })).reminded).toBe(1);
  });

  it("checks each organization's mailbox once, and keeps one organization's from deciding another's", async () => {
    mailboxSource = { "org-1": "org-oauth", "org-2": "none" };
    rows = [row({ id: "a" }), row({ id: "b", organization_id: "org-2" }), row({ id: "c" })];
    claimResult = [{ id: "x" }];
    const stats = await runLpReminders(client, { now: NOW });
    expect(stats).toEqual({ reminded: 2, noMailbox: 1, failed: 0 });
  });

  it("skips a reminder someone else already claimed", async () => {
    claimResult = [];
    expect(await runLpReminders(client, { now: NOW })).toEqual({ reminded: 0, noMailbox: 0, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("gives the claim back when the email fails, so the next sweep tries again", async () => {
    sendEmail.mockResolvedValueOnce({ ok: false, channel: "gmail", detail: "boom" });
    expect(await runLpReminders(client, { now: NOW })).toEqual({ reminded: 0, noMailbox: 0, failed: 1 });
    const release = updates[1];
    expect(release.patch).toEqual({ reminded_day3_at: null });
    expect(release.filters).toEqual(expect.arrayContaining([["reminded_day3_at", "eq", NOW.toISOString()]]));
  });

  it("releases both stamps when a failed day-6 had also covered day 3", async () => {
    rows = [row({ created_at: created(6.5) })];
    sendEmail.mockResolvedValueOnce({ ok: false, channel: "gmail", detail: "boom" });
    await runLpReminders(client, { now: NOW });
    expect(updates[1].patch).toEqual({ reminded_day6_at: null, reminded_day3_at: null });
  });

  it("does not remind LPs the rules say are not due", async () => {
    rows = [row({ created_at: created(1) }), row({ id: "b", review_state: "submitted" }), row({ id: "c", reminded_day3_at: created(1) })];
    expect(await runLpReminders(client, { now: NOW })).toEqual({ reminded: 0, noMailbox: 0, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns quietly if the lookup fails", async () => {
    lookupError = { message: "db down" };
    expect(await runLpReminders(client, { now: NOW })).toEqual({ reminded: 0, noMailbox: 0, failed: 0 });
  });

  it("one bad row doesn't stop the rest", async () => {
    rows = [row({ id: "a" }), row({ id: "b" })];
    sendEmail.mockRejectedValueOnce(new Error("smtp exploded"));
    const stats = await runLpReminders(client, { now: NOW });
    expect(stats).toEqual({ reminded: 1, noMailbox: 0, failed: 1 });
  });
});
