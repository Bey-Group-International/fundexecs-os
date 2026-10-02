jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

let shareRow: Record<string, unknown> | null = null;
let publishedIds: string[] = [];
const inserted: Record<string, unknown>[] = [];
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({
    from: (table: string) => {
      let ids: string[] = [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        in: (_c: string, v: string[]) => ((ids = v), q),
        maybeSingle: async () => ({ data: shareRow }),
        insert: (rows: Record<string, unknown>[]) => {
          inserted.push(...rows);
          return Promise.resolve({ data: null });
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: table === "data_room_documents" ? ids.filter((i) => publishedIds.includes(i)).map((document_id) => ({ document_id })) : [],
          }).then(resolve),
      };
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

import { recordRoomOpen, trackReading } from "./viewer-actions";

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
  inserted.length = 0;
  publishedIds = [];
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

describe("trackReading", () => {
  const PPM = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";

  it("records reading per published document, with the email from the gate pass", async () => {
    publishedIds = [PPM];
    shareRow = { ...base, require_email: true };
    pass = { shareId: "share-1", email: "lp@x.com", pwd: false, nda: false, iat: Date.now() };
    await trackReading("tok", "abcdef12-3456", [
      { documentId: PPM, seconds: 40 },
      { documentId: null, seconds: 5 },
      { documentId: OTHER, seconds: 30 }, // not in this room
      { documentId: "not-a-uuid", seconds: 30 },
      { documentId: PPM, seconds: -3 },
    ]);
    expect(inserted).toEqual([
      expect.objectContaining({ document_id: PPM, kind: "document", action: "read", duration_seconds: 40, viewer_email: "lp@x.com", session_id: "abcdef12-3456" }),
      expect.objectContaining({ document_id: null, kind: "room", action: "read", duration_seconds: 5 }),
    ]);
  });

  it("caps an implausible stretch", async () => {
    publishedIds = [PPM];
    await trackReading("tok", "abcdef12-3456", [{ documentId: PPM, seconds: 99_999 }]);
    expect(inserted[0]).toEqual(expect.objectContaining({ duration_seconds: 600 }));
  });

  it("records nothing for a reader who has not passed the gate", async () => {
    publishedIds = [PPM];
    shareRow = { ...base, require_nda: true };
    await trackReading("tok", "abcdef12-3456", [{ documentId: PPM, seconds: 40 }]);
    expect(inserted).toEqual([]);
  });
});
