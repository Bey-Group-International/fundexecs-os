jest.mock("server-only", () => ({}), { virtual: true });
import { recordAudit } from "./lp-audit.server";

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
