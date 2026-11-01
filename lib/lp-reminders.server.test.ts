jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/integrations/adapters/app-url", () => ({ getAppUrl: () => "https://app.example.com" }));

let mailboxSource: Record<string, string> = {};
const sendEmail = jest.fn(async (_a: unknown): Promise<{ ok: boolean; channel: string; detail: string }> => ({ ok: true, channel: "gmail", detail: "sent" }));
jest.mock("@/lib/email", () => ({
  escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
  getEmailConfigStatus: async (orgId: string) => ({ source: mailboxSource[orgId] ?? "none" }),
  sendEmail: (a: unknown) => sendEmail(a),
}));

const recordAudit = jest.fn(async (..._a: unknown[]) => true);
jest.mock("@/lib/lp-audit.server", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));

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
// A link lasts 7 days from when it was made, as a real one does.
const row = (over: Partial<Row> = {}): Row => {
  const made = over.created_at ?? created(4);
  return {
    id: "s1",
    organization_id: "org-1",
    lp_name: "Jo Park",
    lp_email: "jo@example.com",
    token: "tok-1",
    review_state: "in_progress",
    status: "pending",
    created_at: made,
    expires_at: new Date(new Date(made).getTime() + 7 * DAY).toISOString(),
    reminded_day3_at: null,
    reminded_day6_at: null,
    ...over,
  };
};

let rows: Row[] = [];
let lookupError: { message: string } | null = null;
let claimResult: Array<{ id: string }> = [{ id: "s1" }];
let updates: Array<{ patch: Record<string, unknown>; filters: Array<[string, string, unknown]> }> = [];
let lookups: Array<[string, string, unknown]> = [];
let pagesRead = 0;
let releaseFailures = 0;
const client = {
  from(table: string) {
    const filters: Array<[string, string, unknown]> = [];
    let patch: Record<string, unknown> | null = null;
    let limitN = Infinity;
    const q: Record<string, unknown> = {
      select: () => q,
      in: (c: string, v: unknown) => (filters.push([c, "in", v]), q),
      neq: (c: string, v: unknown) => (filters.push([c, "neq", v]), q),
      gt: (c: string, v: unknown) => (filters.push([c, "gt", v]), q),
      lte: (c: string, v: unknown) => (filters.push([c, "lte", v]), q),
      or: (v: string) => (filters.push(["", "or", v]), q),
      eq: (c: string, v: unknown) => (filters.push([c, "eq", v]), q),
      is: (c: string, v: unknown) => (filters.push([c, "is", v]), q),
      gte: (c: string, v: unknown) => (filters.push([c, "gte", v]), q),
      order: () => q,
      limit: (n: number) => ((limitN = n), q),
      update: (p: Record<string, unknown>) => ((patch = p), q),
      maybeSingle: async () => ({ data: table === "organizations" ? { name: "Acme" } : null }),
      then: (resolve: (v: unknown) => void) => {
        if (patch) {
          updates.push({ patch, filters });
          const isRelease = Object.values(patch).every((v) => v === null);
          if (isRelease && releaseFailures > 0) {
            releaseFailures -= 1;
            return resolve({ data: null, error: { message: "release failed" } });
          }
          return resolve({ data: claimResult, error: null });
        }
        if (table === "lp_onboarding_sessions") {
          lookups = filters;
          pagesRead += 1;
          if (lookupError) return resolve({ data: null, error: lookupError });
          const gte = filters.find(([c, op]) => c === "created_at" && op === "gte")?.[2] as string | undefined;
          const page = [...rows]
            .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
            .filter((r) => !gte || r.created_at >= gte)
            .slice(0, limitN);
          return resolve({ data: page, error: null });
        }
        return resolve({ data: rows, error: null });
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
  pagesRead = 0;
  releaseFailures = 0;
  mailboxSource = { "org-1": "org-oauth" };
  sendEmail.mockClear();
  recordAudit.mockClear();
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

  describe("the audit trail", () => {
    it("records each reminder as the system's, with its day and whether it went", async () => {
      await runLpReminders(client, { now: NOW });
      expect(recordAudit).toHaveBeenCalledTimes(1);
      expect(recordAudit).toHaveBeenCalledWith(client, { orgId: "org-1", sessionId: "s1", action: "email.sent", actorKind: "system", detail: { kind: "reminder", day: 3, ok: true } });
    });

    it("records a reminder that failed to send", async () => {
      sendEmail.mockResolvedValue({ ok: false, channel: "gmail", detail: "boom" });
      await runLpReminders(client, { now: NOW });
      expect(recordAudit.mock.calls[0][1]).toMatchObject({ detail: { kind: "reminder", ok: false } });
    });

    it("records nothing where no email was attempted: no mailbox, or a claim someone else won", async () => {
      mailboxSource = { "org-1": "none" };
      await runLpReminders(client, { now: NOW });
      mailboxSource = { "org-1": "org-oauth" };
      claimResult = [];
      await runLpReminders(client, { now: NOW });
      expect(recordAudit).not.toHaveBeenCalled();
    });

    it("never records the LP's address or the link", async () => {
      await runLpReminders(client, { now: NOW });
      const logged = JSON.stringify(recordAudit.mock.calls);
      expect(logged).not.toContain("jo@example.com");
      expect(logged).not.toContain("tok-1");
    });
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

  describe("reading candidates a page at a time", () => {
    it("reaches LPs behind a page of organizations with no mailbox", async () => {
      mailboxSource = { "org-1": "org-oauth", "org-old": "none" };
      // 100 older LPs whose organization has no mailbox, then a newer one that does.
      const old = Array.from({ length: 100 }, (_, i) => row({ id: `old${String(i).padStart(3, "0")}`, organization_id: "org-old", created_at: created(6.5 - i * 0.001) }));
      rows = [...old, row({ id: "new", created_at: created(4) })];
      claimResult = [{ id: "x" }];
      const stats = await runLpReminders(client, { now: NOW });
      expect(stats.reminded).toBe(1);
      expect(stats.noMailbox).toBe(100);
      expect(pagesRead).toBeGreaterThan(1);
      expect((sendEmail.mock.calls[0][0] as { orgId: string }).orgId).toBe("org-1");
    });

    it("moves on from where the last page ended, without skipping rows that share a timestamp", async () => {
      const same = created(5);
      rows = Array.from({ length: 150 }, (_, i) => row({ id: `r${String(i).padStart(3, "0")}`, created_at: same }));
      mailboxSource = { "org-1": "none" };
      const stats = await runLpReminders(client, { now: NOW });
      // 100 on the first page; the second page re-reads the same timestamp and gets the rest only once.
      expect(stats.noMailbox).toBeGreaterThanOrEqual(100);
      expect(stats.noMailbox).toBeLessThanOrEqual(150);
    });

    it("stops after a bounded number of pages", async () => {
      rows = Array.from({ length: 5000 }, (_, i) => row({ id: `r${String(i).padStart(5, "0")}`, created_at: created(6.9 - i * 0.0001) }));
      mailboxSource = { "org-1": "none" };
      await runLpReminders(client, { now: NOW });
      expect(pagesRead).toBeLessThanOrEqual(10);
    });

    it("stops after one page when it isn't full", async () => {
      await runLpReminders(client, { now: NOW });
      expect(pagesRead).toBe(1);
    });
  });

  describe("giving back a claim when the email fails", () => {
    beforeEach(() => sendEmail.mockResolvedValue({ ok: false, channel: "gmail", detail: "boom" }));

    it("tries the release again if it fails once", async () => {
      releaseFailures = 1;
      await runLpReminders(client, { now: NOW });
      const releases = updates.filter((u) => Object.values(u.patch).every((v) => v === null));
      expect(releases).toHaveLength(2);
      expect(console.error).not.toHaveBeenCalled();
    });

    it("says so, loudly, when it can't be given back", async () => {
      releaseFailures = 5;
      const stats = await runLpReminders(client, { now: NOW });
      expect(stats.failed).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("could not release the claim"), "s1", "release failed");
    });
  });

  it("one bad row doesn't stop the rest", async () => {
    rows = [row({ id: "a" }), row({ id: "b" })];
    sendEmail.mockRejectedValueOnce(new Error("smtp exploded"));
    const stats = await runLpReminders(client, { now: NOW });
    expect(stats).toEqual({ reminded: 1, noMailbox: 0, failed: 1 });
  });
});
