jest.mock("server-only", () => ({}), { virtual: true });
import { recordAudit, recordReviewViews } from "./lp-audit.server";

let error: { message: string } | null;
let thrown: Error | null;
let inserted: { table: string; row: Record<string, unknown> } | null;

const client = {
  from(table: string) {
    return {
      insert: async (row: Record<string, unknown>) => {
        inserted = { table, row };
        if (thrown) throw thrown;
        return { error };
      },
    };
  },
} as never;

beforeEach(() => {
  error = null;
  thrown = null;
  inserted = null;
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const ev = { orgId: "org-1", sessionId: "s-1", action: "code.requested" as const, actorKind: "lp" as const, detail: { emailed: true } };

describe("recordAudit", () => {
  it("writes the row to the audit log", async () => {
    expect(await recordAudit(client, ev)).toBe(true);
    expect(inserted?.table).toBe("onboarding_audit_log");
    expect(inserted?.row).toMatchObject({ organization_id: "org-1", session_id: "s-1", actor_id: null, actor_kind: "lp", action: "code.requested", detail: { emailed: true } });
  });

  it("never throws: a database error is logged and reported as not recorded", async () => {
    error = { message: "boom" };
    await expect(recordAudit(client, ev)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("never throws when the call itself fails", async () => {
    thrown = new Error("network");
    await expect(recordAudit(client, ev)).resolves.toBe(false);
  });

  it("writes nothing for an event it may not write", async () => {
    await expect(recordAudit(client, { ...ev, action: "nope" as never })).resolves.toBe(false);
    expect(inserted).toBeNull();
  });
});

describe("recordReviewViews", () => {
  let recent: Array<{ session_id: string }>;
  let selectError: { message: string } | null;
  let filters: Record<string, unknown>;
  let batch: Array<Record<string, unknown>> | null;
  const viewsClient = {
    from() {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((filters[c] = v), q),
        gte: (c: string, v: unknown) => ((filters[c] = v), q),
        in: (c: string, v: unknown) => ((filters[c] = v), Promise.resolve({ data: recent, error: selectError })),
        insert: async (rows: Array<Record<string, unknown>>) => {
          batch = rows;
          return { error };
        },
      };
      return q;
    },
  } as never;
  const NOW = Date.parse("2026-11-02T12:00:00Z");

  beforeEach(() => {
    recent = [];
    selectError = null;
    filters = {};
    batch = null;
  });

  it("records one entry per LP shown, as the person who looked", async () => {
    expect(await recordReviewViews(viewsClient, { orgId: "org-1", actorId: "u1", sessionIds: ["a", "b"], now: NOW })).toBe(2);
    expect(batch).toEqual([
      { organization_id: "org-1", session_id: "a", actor_id: "u1", actor_kind: "user", action: "data.viewed", detail: {} },
      { organization_id: "org-1", session_id: "b", actor_id: "u1", actor_kind: "user", action: "data.viewed", detail: {} },
    ]);
  });

  it("looks only at this person's views in the last hour, in this organization", async () => {
    await recordReviewViews(viewsClient, { orgId: "org-1", actorId: "u1", sessionIds: ["a"], now: NOW });
    expect(filters).toMatchObject({ organization_id: "org-1", action: "data.viewed", actor_id: "u1", created_at: "2026-11-02T11:00:00.000Z" });
  });

  it("does not record an LP this person already viewed within the hour", async () => {
    recent = [{ session_id: "a" }];
    expect(await recordReviewViews(viewsClient, { orgId: "org-1", actorId: "u1", sessionIds: ["a", "b"], now: NOW })).toBe(1);
    expect(batch?.map((r) => r.session_id)).toEqual(["b"]);
    recent = [{ session_id: "a" }, { session_id: "b" }];
    batch = null;
    expect(await recordReviewViews(viewsClient, { orgId: "org-1", actorId: "u1", sessionIds: ["a", "b"], now: NOW })).toBe(0);
    expect(batch).toBeNull();
  });

  it("does nothing for an empty list", async () => {
    expect(await recordReviewViews(viewsClient, { orgId: "org-1", actorId: "u1", sessionIds: [], now: NOW })).toBe(0);
    expect(batch).toBeNull();
  });

  it("never throws: a failed read or write is logged and writes nothing more", async () => {
    selectError = { message: "boom" };
    await expect(recordReviewViews(viewsClient, { orgId: "org-1", actorId: "u1", sessionIds: ["a"], now: NOW })).resolves.toBe(0);
    selectError = null;
    error = { message: "write failed" };
    await expect(recordReviewViews(viewsClient, { orgId: "org-1", actorId: "u1", sessionIds: ["a"], now: NOW })).resolves.toBe(0);
    expect(console.error).toHaveBeenCalled();
  });
});
