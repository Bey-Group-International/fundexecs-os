// Coverage for the two service-client halves of the decline fix.
//
// decideAccess is a pure table and tested next door in access-requests.test.ts.
// What that cannot reach is the DB behaviour either side of it, which is where
// the bug actually lived:
//
//   enforceAccessGate    used to skip the queue lookup entirely for a principal
//                        that carried access_approved_at, so the gate never saw
//                        a decline against exactly the accounts that have one.
//   applyAccessDecision  recorded a decline on the request row but left
//                        principals.access_approved_at standing, so the person
//                        kept signing in.
//
// Migration 20260906120000 backfilled EVERY principal existing at the time as
// approved, so between them those two made declining a no-op for anyone who
// already had an account — the only people worth declining.

const createServiceClient = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
  hasSupabaseServiceEnv: () => true,
  createServerClient: () => ({}),
}));

jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  escapeHtml: (s: string) => s,
}));

const isPlatformAdminEmail = jest.fn((_email: string) => false);
jest.mock("@/lib/platform-admin", () => ({
  isPlatformAdminEmail: (email: string) => isPlatformAdminEmail(email),
  adminAlertRecipients: () => [],
}));

import { applyAccessDecision, enforceAccessGate } from "./access-requests";

type Row = Record<string, unknown> | null;

interface Write {
  table: string;
  patch: Record<string, unknown>;
  filters: Record<string, unknown>;
}

/**
 * A chainable stand-in for the service client, recording every update so a test
 * can assert on what the code tried to write rather than only on what it
 * returned. Reads are served from the rows the test supplies.
 */
function fakeClient(rows: { principals?: Row; access_requests?: Row }) {
  const writes: Write[] = [];

  function from(table: string) {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;

    const builder = {
      select: () => builder,
      update(next: Record<string, unknown>) {
        patch = next;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      is(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      async maybeSingle() {
        // A select ending in maybeSingle reads; an update ending in it (the
        // decision write) reports the row it changed.
        if (patch) {
          writes.push({ table, patch, filters: { ...filters } });
        }
        return { data: rows[table as keyof typeof rows] ?? null, error: null };
      },
      // Update chains are awaited directly, with no maybeSingle to terminate
      // them, so the builder has to be thenable for those to resolve.
      then(
        resolve: (v: { data: null; error: null }) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        if (patch) {
          writes.push({ table, patch, filters: { ...filters } });
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return { client: { from }, writes };
}

beforeEach(() => {
  jest.clearAllMocks();
  isPlatformAdminEmail.mockReturnValue(false);
});

describe("enforceAccessGate — a decline reaches a stamped principal", () => {
  it("blocks a stamped principal whose request was declined", async () => {
    // The backfill hole: before the fix this returned null (session stands),
    // because the queue was never read for a principal carrying a stamp.
    const { client } = fakeClient({
      principals: { access_approved_at: "2026-01-01T00:00:00Z" },
      access_requests: { status: "declined" },
    });
    createServiceClient.mockReturnValue(client);

    const blocked = await enforceAccessGate({
      userId: "user-1",
      email: "alex@firm.com",
    });

    expect(blocked).toBe("/request-access?email=alex%40firm.com&status=declined");
  });

  it("still lets a stamped principal with no request through", async () => {
    const { client } = fakeClient({
      principals: { access_approved_at: "2026-01-01T00:00:00Z" },
      access_requests: null,
    });
    createServiceClient.mockReturnValue(client);

    expect(
      await enforceAccessGate({ userId: "user-1", email: "alex@firm.com" }),
    ).toBeNull();
  });

  it("still lets a stamped principal whose request was approved through", async () => {
    const { client } = fakeClient({
      principals: { access_approved_at: "2026-01-01T00:00:00Z" },
      access_requests: { status: "approved" },
    });
    createServiceClient.mockReturnValue(client);

    expect(
      await enforceAccessGate({ userId: "user-1", email: "alex@firm.com" }),
    ).toBeNull();
  });

  it("stamps an approved-but-unstamped principal and lets them in", async () => {
    const { client, writes } = fakeClient({
      principals: { access_approved_at: null },
      access_requests: { status: "approved" },
    });
    createServiceClient.mockReturnValue(client);

    expect(
      await enforceAccessGate({ userId: "user-1", email: "alex@firm.com" }),
    ).toBeNull();

    const stamp = writes.find((w) => w.table === "principals");
    expect(stamp?.patch.access_approved_at).toEqual(expect.any(String));
    expect(stamp?.filters).toEqual({ id: "user-1" });
  });

  it("never gates a platform admin, even against a declined row", async () => {
    isPlatformAdminEmail.mockReturnValue(true);
    createServiceClient.mockImplementation(() => {
      throw new Error("must not reach the database for an internal email");
    });

    expect(
      await enforceAccessGate({ userId: "admin-1", email: "ops@fundexecs.com" }),
    ).toBeNull();
  });

  it("fails OPEN when the read throws — a broken gate must not lock everyone out", async () => {
    createServiceClient.mockImplementation(() => {
      throw new Error("supabase down");
    });

    expect(
      await enforceAccessGate({ userId: "user-1", email: "alex@firm.com" }),
    ).toBeNull();
  });
});

describe("applyAccessDecision — declining clears the approval stamp", () => {
  it("nulls access_approved_at so the decline actually blocks a sign-in", async () => {
    const { client, writes } = fakeClient({
      access_requests: { email: "Alex@Firm.com", full_name: "Alex Chen" },
    });
    createServiceClient.mockReturnValue(client);

    const result = await applyAccessDecision({
      id: "req-1",
      decision: "declined",
      reviewerId: "admin-1",
      via: "admin",
    });

    expect(result.ok).toBe(true);

    const principalWrite = writes.find((w) => w.table === "principals");
    expect(principalWrite).toBeDefined();
    expect(principalWrite?.patch).toEqual({ access_approved_at: null });
    // Normalized, and an exact match — never ILIKE, whose `_` wildcard is a
    // legal email character and would revoke accounts nobody declined.
    expect(principalWrite?.filters).toEqual({ email: "alex@firm.com" });
  });

  it("records the decline on the request row too", async () => {
    const { client, writes } = fakeClient({
      access_requests: { email: "alex@firm.com", full_name: "Alex Chen" },
    });
    createServiceClient.mockReturnValue(client);

    await applyAccessDecision({
      id: "req-1",
      decision: "declined",
      reviewerId: "admin-1",
      via: "admin",
    });

    const requestWrite = writes.find((w) => w.table === "access_requests");
    expect(requestWrite?.patch).toEqual(
      expect.objectContaining({ status: "declined", decision_token_hash: null }),
    );
  });

  it("approving still stamps rather than clearing — the decision is reversible", async () => {
    const { client, writes } = fakeClient({
      access_requests: { email: "alex@firm.com", full_name: "Alex Chen" },
    });
    createServiceClient.mockReturnValue(client);

    await applyAccessDecision({
      id: "req-1",
      decision: "approved",
      reviewerId: "admin-1",
      via: "admin",
    });

    const principalWrite = writes.find((w) => w.table === "principals");
    expect(principalWrite?.patch.access_approved_at).toEqual(expect.any(String));
    // Re-stamping relies on the cleared column matching this filter, which is
    // what makes approve-after-decline restore access.
    expect(principalWrite?.filters).toEqual({
      email: "alex@firm.com",
      access_approved_at: null,
    });
  });
});
