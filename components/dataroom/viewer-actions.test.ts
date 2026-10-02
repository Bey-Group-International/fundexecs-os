jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

let shareRow: Record<string, unknown> | null = null;
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: shareRow }) };
      return q;
    },
  }),
}));
let pass: Record<string, unknown> | null = null;
jest.mock("@/lib/data-room-gate", () => ({
  ...jest.requireActual("@/lib/data-room-gate"),
  readGatePass: async () => pass,
}));
const recordFirstOpen = jest.fn(async () => true);
jest.mock("@/lib/data-room-alerts.server", () => ({ recordFirstOpen: (...a: unknown[]) => recordFirstOpen(...(a as [])) }));

import { recordRoomOpen } from "./viewer-actions";

const base = {
  id: "share-1",
  organization_id: "org-1",
  room_id: "room-1",
  label: "Fund II",
  notify_on_open: true,
  created_by: "gp-1",
  revoked_at: null,
  expires_at: null,
  require_email: false,
  require_nda: false,
  password_hash: null,
};

beforeEach(() => {
  recordFirstOpen.mockClear();
  shareRow = { ...base };
  pass = null;
});

describe("recordRoomOpen", () => {
  it("records an ungated open under the browser id", async () => {
    await recordRoomOpen("tok", "abcdef12-3456");
    expect(recordFirstOpen).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "share-1" }), "visitor:abcdef12-3456", null);
  });

  it("keys on the email the reader gave the gate", async () => {
    shareRow = { ...base, require_email: true };
    pass = { shareId: "share-1", email: "LP@x.com", pwd: false, nda: false, iat: Date.now() };
    await recordRoomOpen("tok", "abcdef12-3456");
    expect(recordFirstOpen).toHaveBeenCalledWith(expect.anything(), expect.anything(), "email:lp@x.com", "LP@x.com");
  });

  it("ignores a reader who has not passed the gate", async () => {
    shareRow = { ...base, password_hash: "pbkdf2:x:y" };
    await recordRoomOpen("tok", "abcdef12-3456");
    expect(recordFirstOpen).not.toHaveBeenCalled();
  });

  it("ignores revoked and expired links", async () => {
    shareRow = { ...base, revoked_at: "2026-10-01T00:00:00Z" };
    await recordRoomOpen("tok", "abcdef12-3456");
    shareRow = { ...base, expires_at: "2020-01-01T00:00:00Z" };
    await recordRoomOpen("tok", "abcdef12-3456");
    expect(recordFirstOpen).not.toHaveBeenCalled();
  });
});
