// Coverage for connection audit history (audit P2 — "connection
// connect/disconnect writes nothing; the upsert destroys history"). The
// contract: every successful connect/disconnect also appends an
// integration.connected / integration.revoked audit_log row carrying the
// prior status, and a failed upsert writes NO history (nothing happened).

const getSessionContext = jest.fn();
jest.mock("@/lib/auth", () => ({
  getSessionContext: (...a: unknown[]) => getSessionContext(...a),
}));

const writeDashboardAudit = jest.fn();
jest.mock("@/lib/dashboard/audit", () => ({
  writeDashboardAudit: (...a: unknown[]) => writeDashboardAudit(...a),
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

jest.mock("@/lib/integrations/catalog", () => ({
  integrationCatalog: () => [{ channel: "gmail" }, { channel: "calendly" }],
  envConfiguredChannels: () => new Set<string>(),
}));

const upsert = jest.fn();
const maybeSingle = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({
    from: () => ({
      upsert: (...a: unknown[]) => upsert(...a),
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
      }),
    }),
  }),
}));

import { disconnectIntegration } from "./connections-actions";

function form(channel: string): FormData {
  const fd = new FormData();
  fd.set("channel", channel);
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  getSessionContext.mockResolvedValue({ orgId: "org-1", userId: "user-1" });
  upsert.mockResolvedValue({ error: null });
  maybeSingle.mockResolvedValue({ data: null, error: null });
});

// connectIntegration's tests are gone with the function. They asserted that a
// button press writes a 'connected' row with a placeholder label and no
// credential — which was the defect, so keeping them would have pinned it.

describe("disconnectIntegration", () => {
  it("appends an integration.revoked audit row with the prior status", async () => {
    maybeSingle.mockResolvedValue({ data: { status: "connected" }, error: null });
    const result = await disconnectIntegration(form("gmail"));
    expect(result).toEqual({});

    const event = writeDashboardAudit.mock.calls[0][0];
    expect(event.action).toBe("integration.revoked");
    expect(event.beforeState).toMatchObject({ channel: "gmail", status: "connected" });
    expect(event.afterState).toMatchObject({ channel: "gmail", status: "revoked" });
    expect(typeof event.afterState.revoked_at).toBe("string");
  });

  it("writes no history when the upsert fails", async () => {
    upsert.mockResolvedValue({ error: { message: "denied" } });
    expect(await disconnectIntegration(form("gmail"))).toEqual({ error: "denied" });
    expect(writeDashboardAudit).not.toHaveBeenCalled();
  });
});
