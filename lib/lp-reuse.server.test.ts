jest.mock("server-only", () => ({}), { virtual: true });

import { carryForwardChecks } from "./lp-reuse.server";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-01T12:00:00Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

let sessionsFound: Array<{ id: string; review_state: string; lp_email: string }>;
let priorChecks: unknown[];
let present: Array<{ kind: string }>;
let errors: Record<string, { message: string } | undefined>;
let queries: Array<{ table: string; filters: Array<[string, string, unknown]> }>;
let inserted: Array<Record<string, unknown>> | null;

const client = {
  from(table: string) {
    const filters: Array<[string, string, unknown]> = [];
    let isInsert = false;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, "eq", v]), q),
      neq: (c: string, v: unknown) => (filters.push([c, "neq", v]), q),
      in: (c: string, v: unknown) => (filters.push([c, "in", v]), q),
      ilike: (c: string, v: unknown) => (filters.push([c, "ilike", v]), q),
      limit: (n: number) => (filters.push(["*", "limit", n]), q),
      insert: (rows: Array<Record<string, unknown>>) => ((isInsert = true), (inserted = rows), q),
      then: (resolve: (v: unknown) => void) => {
        if (isInsert) return resolve({ error: errors.insert ?? null });
        queries.push({ table, filters });
        const wantsKinds = filters.some(([c, op]) => c === "kind" && op === "in");
        if (table === "lp_onboarding_sessions") return resolve({ data: sessionsFound, error: errors.sessions ?? null });
        return resolve({ data: wantsKinds ? priorChecks : present, error: wantsKinds ? (errors.checks ?? null) : null });
      },
    };
    return q;
  },
} as never;

const args = { orgId: "org-1", sessionId: "s-new", email: " Jo@Example.com ", now: NOW };
const priorId = { id: "s-old", review_state: "approved", lp_email: "jo@example.com" };
const goodCheck = {
  session_id: "s-old",
  kind: "identity",
  status: "clear",
  method: "stripe_identity",
  vendor_ref: "vs_1",
  summary: "Verified.",
  checked_at: ago(100),
  expires_at: null,
};

beforeEach(() => {
  sessionsFound = [priorId];
  priorChecks = [goodCheck];
  present = [];
  errors = {};
  queries = [];
  inserted = null;
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("carryForwardChecks", () => {
  it("carries a returning LP's ID check onto the new onboarding, as a system record", async () => {
    const res = await carryForwardChecks(client, args);
    expect(res).toEqual([{ kind: "identity", checkedAt: ago(100), expiresAt: new Date(NOW - 100 * DAY + 365 * DAY).toISOString() }]);
    expect(inserted).toHaveLength(1);
    expect(inserted![0]).toMatchObject({
      organization_id: "org-1",
      session_id: "s-new",
      kind: "identity",
      status: "clear",
      method: "stripe_identity",
      vendor_ref: "vs_1",
      recorded_by: null,
    });
    expect(String(inserted![0].summary)).toMatch(/^Carried forward from the/);
  });

  it("names the organization on every read, and looks for the same email with wildcards escaped", async () => {
    await carryForwardChecks(client, { ...args, email: "a_b@x.com" });
    for (const q of queries) expect(q.filters).toContainEqual(["organization_id", "eq", "org-1"]);
    const sessions = queries.find((q) => q.table === "lp_onboarding_sessions")!;
    expect(sessions.filters).toContainEqual(["lp_email", "ilike", "a\\_b@x.com"]);
    expect(sessions.filters).toContainEqual(["id", "neq", "s-new"]);
  });

  it("never caps the earlier-onboardings lookup, so an old rejection can't be cut off", async () => {
    await carryForwardChecks(client, args);
    const sessions = queries.find((q) => q.table === "lp_onboarding_sessions")!;
    expect(sessions.filters.some(([, op]) => op === "limit")).toBe(false);
  });

  it("decides on the exact address, not the pattern match", async () => {
    sessionsFound = [{ id: "s-old", review_state: "approved", lp_email: "joe@example.com" }];
    expect(await carryForwardChecks(client, args)).toEqual([]);
    expect(inserted).toBeNull();
  });

  it("matches the address whatever its case", async () => {
    sessionsFound = [{ ...priorId, lp_email: "JO@Example.COM " }];
    expect(await carryForwardChecks(client, args)).toHaveLength(1);
  });

  it("carries nothing for someone never onboarded, rejected, or not yet approved", async () => {
    sessionsFound = [];
    expect(await carryForwardChecks(client, args)).toEqual([]);
    sessionsFound = [priorId, { id: "s-bad", review_state: "rejected", lp_email: "jo@example.com" }];
    expect(await carryForwardChecks(client, args)).toEqual([]);
    sessionsFound = [{ ...priorId, review_state: "submitted" }];
    expect(await carryForwardChecks(client, args)).toEqual([]);
    expect(inserted).toBeNull();
  });

  it("carries nothing that has expired", async () => {
    priorChecks = [{ ...goodCheck, expires_at: ago(1) }];
    expect(await carryForwardChecks(client, args)).toEqual([]);
  });

  it("never adds a second check of a kind the new onboarding already has", async () => {
    present = [{ kind: "identity" }];
    expect(await carryForwardChecks(client, args)).toEqual([]);
    expect(inserted).toBeNull();
  });

  it("does nothing for an empty or missing email", async () => {
    expect(await carryForwardChecks(client, { ...args, email: "  " })).toEqual([]);
    expect(queries).toEqual([]);
  });

  it("is never an obstacle: any failure is logged and nothing is carried", async () => {
    errors = { sessions: { message: "db down" } };
    expect(await carryForwardChecks(client, args)).toEqual([]);
    errors = { checks: { message: "db down" } };
    expect(await carryForwardChecks(client, args)).toEqual([]);
    errors = { insert: { message: "rls" } };
    expect(await carryForwardChecks(client, args)).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(3);
  });
});
