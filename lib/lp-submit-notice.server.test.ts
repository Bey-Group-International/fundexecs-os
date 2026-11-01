jest.mock("server-only", () => ({}), { virtual: true });

const sendEmail = jest.fn();
jest.mock("@/lib/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
}));
jest.mock("@/lib/integrations/adapters/app-url", () => ({ getAppUrl: () => "https://app.test" }));

import { notifyTeamOfSubmission } from "./lp-submit-notice.server";

let session: unknown;
let org: unknown;
let members: unknown[];
let people: unknown[];
let errors: Record<string, { message: string } | undefined>;
let filters: Array<{ table: string; filters: Array<[string, string, unknown]> }>;

const client = {
  from(table: string) {
    const f: Array<[string, string, unknown]> = [];
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (f.push([c, "eq", v]), q),
      in: (c: string, v: unknown) => (f.push([c, "in", v]), q),
      order: (c: string, o: { ascending: boolean }) => (f.push([c, "order", o.ascending]), q),
      limit: () => q,
      maybeSingle: () =>
        (filters.push({ table, filters: f }),
        Promise.resolve({ data: table === "organizations" ? org : session, error: errors[table] ?? null })),
      then: (resolve: (v: unknown) => void) => {
        filters.push({ table, filters: f });
        if (table === "organization_members") return resolve({ data: members, error: errors.organization_members ?? null });
        return resolve({ data: people, error: errors.principals ?? null });
      },
    };
    return q;
  },
} as never;

const args = { sessionId: "s1", orgId: "org-1", resubmitted: false };

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue({ ok: true });
  session = { lp_name: "Jo Park", lp_type: "individual" };
  org = { name: "Acme Capital" };
  members = [
    { role: "owner", principal_id: "p1" },
    { role: "admin", principal_id: "p2" },
  ];
  people = [
    { id: "p1", email: "owner@x.com", full_name: "Olive Owner" },
    { id: "p2", email: "admin@x.com", full_name: "Adam Admin" },
  ];
  errors = {};
  filters = [];
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("notifyTeamOfSubmission", () => {
  it("emails each owner and admin once, naming the LP and where to review", async () => {
    const res = await notifyTeamOfSubmission(client, args);
    expect(res).toEqual({ sent: 2, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const first = sendEmail.mock.calls[0][0];
    expect(first).toMatchObject({ orgId: "org-1", to: { email: "owner@x.com", name: "Olive Owner" }, subject: "Jo Park submitted their onboarding" });
    expect(first.htmlBody).toContain("https://app.test/run/onboarding");
  });

  it("emails the organization's own team, so the shared sender may stand in", async () => {
    await notifyTeamOfSubmission(client, args);
    for (const [call] of sendEmail.mock.calls) expect(call.allowFallback).toBe(true);
  });

  it("names the organization on every read, and only asks for owners and admins", async () => {
    await notifyTeamOfSubmission(client, args);
    for (const q of filters.filter((x) => x.table !== "principals")) {
      const key = q.table === "organizations" ? "id" : "organization_id";
      expect(q.filters).toContainEqual([key, "eq", "org-1"]);
    }
    const m = filters.find((x) => x.table === "organization_members")!;
    expect(m.filters).toContainEqual(["role", "in", ["owner", "admin"]]);
  });

  it("says so when the LP has resubmitted", async () => {
    await notifyTeamOfSubmission(client, { ...args, resubmitted: true });
    expect(sendEmail.mock.calls[0][0].subject).toBe("Jo Park resubmitted their onboarding");
  });

  it("counts a send that fails and still tries everyone else", async () => {
    sendEmail.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    expect(await notifyTeamOfSubmission(client, args)).toEqual({ sent: 1, failed: 1 });
  });

  it("sends nothing when the session is gone, the team has no address, or nobody is an admin", async () => {
    session = null;
    expect(await notifyTeamOfSubmission(client, args)).toEqual({ sent: 0, failed: 0 });
    session = { lp_name: "Jo", lp_type: "individual" };
    people = [{ id: "p1", email: null, full_name: null }];
    expect(await notifyTeamOfSubmission(client, args)).toEqual({ sent: 0, failed: 0 });
    members = [];
    expect(await notifyTeamOfSubmission(client, args)).toEqual({ sent: 0, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never throws: a failed lookup is logged and nothing is sent", async () => {
    errors.principals = { message: "boom" };
    await expect(notifyTeamOfSubmission(client, args)).resolves.toEqual({ sent: 0, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it.each(["lp_onboarding_sessions", "organizations", "organization_members"])(
    "a failed %s read is logged and sends nothing, rather than being treated as an empty answer",
    async (table) => {
      errors[table] = { message: "connection reset" };
      await expect(notifyTeamOfSubmission(client, args)).resolves.toEqual({ sent: 0, failed: 0 });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[lp-submit-notice]"), expect.objectContaining({ message: "connection reset" }));
    },
  );

  it("asks for owners before admins, so a cap on rows can never cut an owner", async () => {
    await notifyTeamOfSubmission(client, args);
    const m = filters.find((x) => x.table === "organization_members")!;
    expect(m.filters).toContainEqual(["role", "order", true]);
  });

  it("never throws when the mailbox itself throws", async () => {
    sendEmail.mockRejectedValue(new Error("smtp down"));
    await expect(notifyTeamOfSubmission(client, args)).resolves.toEqual({ sent: 0, failed: 0 });
  });
});
