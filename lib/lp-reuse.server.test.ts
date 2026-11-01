jest.mock("server-only", () => ({}), { virtual: true });

import { decideCarryover, proposeCarryover } from "./lp-reuse.server";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-01T12:00:00Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let failOn: Record<string, string | undefined>;
let filtersSeen: Array<{ table: string; filters: Array<[string, string, unknown]> }>;

/** A tiny in-memory stand-in for the parts of the Supabase client these functions use. */
const client = {
  from(table: string) {
    const filters: Array<[string, string, unknown]> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] = {};
    let wantRows = false;
    const matches = (r: Row) =>
      filters.every(([c, o, v]) => {
        const x = r[c];
        if (o === "eq") return x === v;
        if (o === "neq") return x !== v;
        if (o === "is") return x === v;
        if (o === "in") return (v as unknown[]).includes(x);
        if (o === "ilike") return String(x).toLowerCase() === String(v).replace(/\\(.)/g, "$1").toLowerCase();
        return true;
      });
    const run = () => {
      const err = failOn[`${table}.${op}`];
      if (err) return { data: null, error: { message: err } };
      const rows = db[table] ?? (db[table] = []);
      if (op === "insert") {
        for (const r of [payload].flat()) rows.push({ ...(r as Row) });
        return { data: null, error: null };
      }
      if (op === "update") {
        const hit = rows.filter(matches);
        hit.forEach((r) => Object.assign(r, payload));
        return { data: wantRows ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      return { data: rows.filter(matches).map((r) => ({ ...r })), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => ((wantRows = true), q),
      eq: (c: string, v: unknown) => (filters.push([c, "eq", v]), q),
      neq: (c: string, v: unknown) => (filters.push([c, "neq", v]), q),
      in: (c: string, v: unknown) => (filters.push([c, "in", v]), q),
      ilike: (c: string, v: unknown) => (filters.push([c, "ilike", v]), q),
      insert: (r: Row | Row[]) => ((op = "insert"), (payload = r), q),
      update: (r: Row) => ((op = "update"), (payload = r), q),
      maybeSingle: async () => {
        filtersSeen.push({ table, filters });
        const res = run();
        return { data: (res.data as Row[] | null)?.[0] ?? null, error: res.error };
      },
      then: (resolve: (v: unknown) => void) => {
        filtersSeen.push({ table, filters });
        resolve(run());
      },
    };
    return q;
  },
} as never;

const args = { orgId: "org-1", sessionId: "s-new", email: " Jo@Example.com ", lpName: "Jo Bloggs", now: NOW };

beforeEach(() => {
  failOn = {};
  filtersSeen = [];
  db = {
    lp_onboarding_sessions: [{ id: "s-old", organization_id: "org-1", review_state: "approved", lp_email: "jo@example.com", lp_name: "Jo Bloggs" }],
    onboarding_checks: [
      {
        organization_id: "org-1",
        session_id: "s-old",
        kind: "identity",
        status: "clear",
        method: "stripe_identity",
        vendor_ref: "vs_1",
        summary: "Verified.",
        checked_at: ago(100),
        expires_at: null,
      },
    ],
    lp_identity_carryover: [],
  };
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("proposeCarryover", () => {
  it("records a PROPOSAL and writes no check: nothing is trusted until a person confirms", async () => {
    const res = await proposeCarryover(client, args);
    expect(res).toEqual([{ kind: "identity", checkedAt: ago(100), expiresAt: new Date(NOW - 100 * DAY + 365 * DAY).toISOString(), namesMatch: true }]);
    expect(db.lp_identity_carryover).toHaveLength(1);
    expect(db.lp_identity_carryover[0]).toMatchObject({
      session_id: "s-new",
      organization_id: "org-1",
      from_session_id: "s-old",
      prior_name: "Jo Bloggs",
      names_match: true,
      status: "proposed",
      method: "stripe_identity",
    });
    // The new onboarding still has no ID check of its own.
    expect(db.onboarding_checks.filter((c) => c.session_id === "s-new")).toEqual([]);
  });

  it("flags when the names differ, so the person confirming is warned", async () => {
    const res = await proposeCarryover(client, { ...args, lpName: "Someone Else" });
    expect(res[0].namesMatch).toBe(false);
    expect(db.lp_identity_carryover[0].names_match).toBe(false);
  });

  it("names the organization on every read, and looks for the same email with wildcards escaped", async () => {
    await proposeCarryover(client, { ...args, email: "a_b@x.com" });
    for (const q of filtersSeen) expect(q.filters).toContainEqual(["organization_id", "eq", "org-1"]);
    const sessions = filtersSeen.find((q) => q.table === "lp_onboarding_sessions")!;
    expect(sessions.filters).toContainEqual(["lp_email", "ilike", "a\\_b@x.com"]);
    expect(sessions.filters).toContainEqual(["id", "neq", "s-new"]);
  });

  it("decides on the exact address, not the pattern match", async () => {
    db.lp_onboarding_sessions[0].lp_email = "joe@example.com";
    expect(await proposeCarryover(client, args)).toEqual([]);
    expect(db.lp_identity_carryover).toEqual([]);
  });

  it("proposes nothing for someone never onboarded, rejected, or not yet approved", async () => {
    db.lp_onboarding_sessions = [];
    expect(await proposeCarryover(client, args)).toEqual([]);
    db.lp_onboarding_sessions = [
      { id: "s-old", organization_id: "org-1", review_state: "approved", lp_email: "jo@example.com", lp_name: "Jo" },
      { id: "s-bad", organization_id: "org-1", review_state: "rejected", lp_email: "jo@example.com", lp_name: "Jo" },
    ];
    expect(await proposeCarryover(client, args)).toEqual([]);
    db.lp_onboarding_sessions = [{ id: "s-old", organization_id: "org-1", review_state: "submitted", lp_email: "jo@example.com", lp_name: "Jo" }];
    expect(await proposeCarryover(client, args)).toEqual([]);
    expect(db.lp_identity_carryover).toEqual([]);
  });

  it("proposes nothing that has expired, and nothing when the new onboarding already has an ID check", async () => {
    db.onboarding_checks[0].expires_at = ago(1);
    expect(await proposeCarryover(client, args)).toEqual([]);
    db.onboarding_checks[0].expires_at = null;
    db.onboarding_checks.push({ organization_id: "org-1", session_id: "s-new", kind: "identity", status: "pending" });
    expect(await proposeCarryover(client, args)).toEqual([]);
  });

  it("does nothing for an empty email, and is never an obstacle when the database fails", async () => {
    expect(await proposeCarryover(client, { ...args, email: "  " })).toEqual([]);
    failOn = { "lp_onboarding_sessions.select": "db down" };
    expect(await proposeCarryover(client, args)).toEqual([]);
    failOn = { "lp_identity_carryover.insert": "rls" };
    expect(await proposeCarryover(client, args)).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("decideCarryover", () => {
  const proposeFirst = () => proposeCarryover(client, args);
  const decide = (decision: "confirm" | "decline", extra: Partial<Parameters<typeof decideCarryover>[1]> = {}) =>
    decideCarryover(client, { orgId: "org-1", sessionId: "s-new", decision, actorId: "user-1", now: NOW, ...extra });

  it("confirming writes the earlier clearance as a clear check, dated as it was, by the person who confirmed", async () => {
    await proposeFirst();
    expect(await decide("confirm")).toBe("confirmed");
    const check = db.onboarding_checks.find((c) => c.session_id === "s-new")!;
    expect(check).toMatchObject({ organization_id: "org-1", kind: "identity", status: "clear", method: "stripe_identity", vendor_ref: "vs_1", checked_at: ago(100), recorded_by: "user-1" });
    expect(db.lp_identity_carryover[0]).toMatchObject({ status: "confirmed", decided_by: "user-1" });
  });

  it("declining writes no check and closes the proposal", async () => {
    await proposeFirst();
    expect(await decide("decline")).toBe("declined");
    expect(db.onboarding_checks.filter((c) => c.session_id === "s-new")).toEqual([]);
    expect(db.lp_identity_carryover[0].status).toBe("declined");
  });

  it("cannot be acted on twice", async () => {
    await proposeFirst();
    expect(await decide("confirm")).toBe("confirmed");
    expect(await decide("confirm")).toBe("not_found");
    expect(db.onboarding_checks.filter((c) => c.session_id === "s-new")).toHaveLength(1);
  });

  it("will not confirm a check that has lapsed since it was proposed", async () => {
    await proposeFirst();
    expect(await decide("confirm", { now: NOW + 400 * DAY })).toBe("expired");
    expect(db.onboarding_checks.filter((c) => c.session_id === "s-new")).toEqual([]);
    expect(db.lp_identity_carryover[0].status).toBe("proposed");
  });

  it("does not add a second ID check if the LP verified for themselves in the meantime", async () => {
    await proposeFirst();
    db.onboarding_checks.push({ organization_id: "org-1", session_id: "s-new", kind: "identity", status: "clear", method: "stripe_identity" });
    expect(await decide("confirm")).toBe("already_has_check");
    expect(db.onboarding_checks.filter((c) => c.session_id === "s-new")).toHaveLength(1);
  });

  it("only acts on its own organization's proposal", async () => {
    await proposeFirst();
    expect(await decide("confirm", { orgId: "org-2" })).toBe("not_found");
    expect(db.lp_identity_carryover[0].status).toBe("proposed");
  });

  it("puts the proposal back if writing the check fails, so the manager can try again", async () => {
    await proposeFirst();
    failOn = { "onboarding_checks.insert": "rls" };
    expect(await decide("confirm")).toBe("error");
    expect(db.lp_identity_carryover[0]).toMatchObject({ status: "proposed", decided_by: null });
  });
});
