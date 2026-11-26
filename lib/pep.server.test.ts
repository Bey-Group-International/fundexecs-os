jest.mock("server-only", () => ({}), { virtual: true });

import { runPepScreen } from "./pep.server";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const env = { PEP_SCREEN_API_KEY: "secret-key-123" };

let tables: Record<string, unknown>;
let writes: Array<{ table: string; op: string; row: Record<string, unknown>; filters: Record<string, unknown> }>;
let audits: Array<Record<string, unknown>>;
let writeError: { code: string; message: string } | null;

const client = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    let op = "select";
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => ((filters[c] = v), q),
      update: (row: Record<string, unknown>) => ((op = "update"), writes.push({ table, op, row, filters }), q),
      insert: (row: Record<string, unknown>) => {
        op = "insert";
        if (table === "onboarding_audit_log") audits.push(row);
        else writes.push({ table, op, row, filters });
        return q;
      },
      maybeSingle: async () => ({ data: (tables[table] as unknown) ?? null }),
      then: (resolve: (v: unknown) => void) => resolve(op === "select" ? { data: tables[table] ?? [], error: null } : { error: writeError }),
    };
    return q;
  },
} as never;

const flaggedAnswer = { responses: { q0: { results: [{ caption: "Joseph Bloggs", score: 0.9, match: true, properties: { topics: ["role.pep"] } }] } } };
const emptyAnswer = { responses: { q0: { results: [] } } };

let calls: Array<{ url: string; init: RequestInit }>;
const respond = (status: number, body: unknown) =>
  (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }) as unknown as typeof fetch;

const run = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) =>
  runPepScreen(client, "s1", "org-1", { now: NOW, env, fetchImpl, actor: { kind: "user", id: "user-1" }, ...extra });

beforeEach(() => {
  tables = {
    lp_onboarding_sessions: { lp_name: "Jo Bloggs" },
    lp_onboarding_profiles: { legal_name: "Jo Bloggs", signatory_name: null },
    lp_onboarding_owners: [],
    onboarding_checks: null,
  };
  writes = [];
  audits = [];
  calls = [];
  writeError = null;
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("runPepScreen", () => {
  it("does nothing, and sends nothing, when screening isn't set up", async () => {
    const f = respond(200, emptyAnswer);
    const res = await runPepScreen(client, "s1", "org-1", { now: NOW, env: {}, fetchImpl: f });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toMatch(/isn't set up/);
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("sends only the names, with the key in the Authorization header and not in the body", async () => {
    await run(respond(200, emptyAnswer));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.opensanctions.org/match/peps");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("ApiKey secret-key-123");
    expect(String(calls[0].init.body)).not.toContain("secret-key-123");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ queries: { q0: { schema: "LegalEntity", properties: { name: ["Jo Bloggs"] } } } });
  });

  it("flags a possible match on the PEP check, as the system, and never clears", async () => {
    const res = await run(respond(200, flaggedAnswer));
    expect(res).toMatchObject({ ok: true, flagged: 1, screened: 1, wrote: true });
    const w = writes.find((x) => x.table === "onboarding_checks")!;
    expect(w.op).toBe("insert");
    expect(w.row).toMatchObject({ kind: "pep", status: "flagged", method: "manual", recorded_by: null, organization_id: "org-1", session_id: "s1" });
    expect(String(w.row.summary)).toMatch(/^PEP first-pass screen 2026-11-02: possible match\. Jo Bloggs \(the LP\) resembles Joseph Bloggs/);
  });

  it("leaves the check pending, never clear, when nothing matches", async () => {
    const res = await run(respond(200, emptyAnswer));
    expect(res).toMatchObject({ ok: true, flagged: 0, wrote: true });
    expect(writes[0].row).toMatchObject({ kind: "pep", status: "pending", checked_at: null });
  });

  it("logs every run with the provider and counts, but never a name or the provider's answer", async () => {
    await run(respond(200, flaggedAnswer));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ organization_id: "org-1", session_id: "s1", action: "check.screen_run", actor_kind: "user", actor_id: "user-1" });
    expect(audits[0].detail).toEqual({ kind: "pep", status: "flagged", matches: 1, screened: 1, wrote: true, provider: "opensanctions", dataset: "peps" });
    expect(JSON.stringify(audits[0])).not.toMatch(/Bloggs/);
  });

  it("never overwrites a result a person recorded, but still logs that it ran", async () => {
    tables.onboarding_checks = { status: "clear", summary: "Checked by hand.", recorded_by: "user-9" };
    const res = await run(respond(200, flaggedAnswer));
    expect(res).toMatchObject({ ok: true, wrote: false, flagged: 1 });
    expect(writes).toEqual([]);
    expect(audits[0].detail).toMatchObject({ wrote: false });
  });

  it("replaces only its own earlier flag", async () => {
    tables.onboarding_checks = { status: "flagged", summary: "PEP first-pass screen 2026-10-01: possible match. old", recorded_by: null };
    const res = await run(respond(200, emptyAnswer));
    expect(res).toMatchObject({ ok: true, wrote: true });
    expect(writes[0]).toMatchObject({ op: "update", filters: expect.objectContaining({ kind: "pep", status: "flagged" }) });
  });

  it("an error from the provider is an error, never 'no match', and writes nothing", async () => {
    for (const status of [401, 429, 500]) {
      writes = [];
      audits = [];
      const res = await run(respond(status, { error: "Jo Bloggs not allowed" }));
      expect(res).toMatchObject({ ok: false });
      expect(writes).toEqual([]);
      expect(audits).toEqual([]);
    }
  });

  it("an unreachable provider, an unreadable answer, or one that skips a name, writes nothing", async () => {
    const boom = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await run(boom)).toMatchObject({ ok: false });
    expect(await run(respond(200, { nope: true }))).toMatchObject({ ok: false });
    expect(await run(respond(200, { responses: {} }))).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });

  it("does not log the key, the names, or the provider's body when the provider fails", async () => {
    await run(respond(500, { echo: "Jo Bloggs secret-key-123" }));
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toMatch(/Bloggs|secret-key-123/);
  });

  it("says so when the LP can't be found, and when the save fails", async () => {
    tables.lp_onboarding_sessions = null;
    expect(await run(respond(200, emptyAnswer))).toMatchObject({ ok: false, error: "That LP wasn't found." });
    tables.lp_onboarding_sessions = { lp_name: "Jo Bloggs" };
    writeError = { code: "42501", message: "rls" };
    expect(await run(respond(200, emptyAnswer))).toMatchObject({ ok: false });
  });
});
