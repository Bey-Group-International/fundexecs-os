jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => undefined }) }));

let shareRow: Record<string, unknown> | null = null;
let publishedIds: string[] = [];
const inserted: Record<string, unknown>[] = [];
let readers: { share_id: string; email: string }[] = [];
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({
    from: (table: string) => {
      let ids: string[] = [];
      let head = false;
      const eqs: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: (_c?: string, o?: { head?: boolean }) => ((head = Boolean(o?.head)), q),
        eq: (c: string, v: unknown) => ((eqs[c] = v), q),
        in: (_c: string, v: string[]) => ((ids = v), q),
        maybeSingle: async () => ({
          data:
            table === "data_room_link_readers"
              ? (readers.find((r) => r.share_id === eqs.share_id && r.email === eqs.email) ?? null)
              : shareRow,
        }),
        upsert: (row: { share_id: string; email: string }) => {
          if (!readers.some((r) => r.share_id === row.share_id && r.email === row.email)) readers.push(row);
          return Promise.resolve({ data: null });
        },
        insert: (rows: Record<string, unknown>[]) => {
          inserted.push(...rows);
          return Promise.resolve({ data: null });
        },
        then: (resolve: (v: unknown) => unknown) =>
          head
            ? Promise.resolve({ count: readers.filter((r) => r.share_id === eqs.share_id).length }).then(resolve)
            : Promise.resolve({
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

import { passEmailGate, recordRoomOpen, trackReading } from "./viewer-actions";

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
  readers = [];
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

describe("passEmailGate", () => {
  const gated = { ...base, require_email: true, allowed_email_domains: null, max_readers: null };

  it("admits an email and records the reader", async () => {
    shareRow = gated;
    expect(await passEmailGate("tok", "LP@x.com")).toEqual({ ok: true });
    expect(readers).toEqual([expect.objectContaining({ share_id: "share-1", email: "lp@x.com" })]);
  });

  it("refuses an address outside the link's domains, and says which are allowed", async () => {
    shareRow = { ...gated, allowed_email_domains: ["calpers.ca.gov"] };
    expect(await passEmailGate("tok", "lp@gmail.com")).toEqual({
      ok: false,
      error: "This link is for @calpers.ca.gov addresses. Ask the sender for access with another address.",
    });
    expect(await passEmailGate("tok", "lp@calpers.ca.gov")).toEqual({ ok: true });
  });

  it("refuses a new reader once the link is full but lets admitted readers back in", async () => {
    shareRow = { ...gated, max_readers: 1 };
    expect(await passEmailGate("tok", "a@x.com")).toEqual({ ok: true });
    expect(await passEmailGate("tok", "b@x.com")).toEqual({
      ok: false,
      error: "This link has reached its reader limit. Ask the sender for a new link.",
    });
    expect(await passEmailGate("tok", "A@x.com")).toEqual({ ok: true });
  });

  it("rejects something that isn't an email", async () => {
    shareRow = gated;
    expect(await passEmailGate("tok", "nope")).toEqual({ ok: false, error: "Enter a valid email address." });
  });
});
