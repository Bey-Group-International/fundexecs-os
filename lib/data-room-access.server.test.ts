/**
 * The one access check behind every public document route. These pin the
 * boundaries that matter: a room link reaches only published documents in its
 * allowed sections; a single-document link reaches exactly its document and
 * nothing else; and nothing is served before the gate is passed.
 */
jest.mock("server-only", () => ({}), { virtual: true });

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let gatePassed = true;

jest.mock("@/lib/data-room-gate", () => ({
  readGatePass: async () => ({ email: "lp@example.com", pwd: true, nda: true }),
  gateSatisfied: () => gatePassed,
}));
jest.mock("@/lib/data-room-viewer.server", () => ({ isRoomOpen: async () => true }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return q;
        },
        maybeSingle: async () => ({
          data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
        }),
      };
      return q;
    },
  }),
}));

import { isShareLive, resolveSharedDocument, watermarkLabel } from "./data-room-access.server";

const ORG = "org-1";
const share = (over: Row = {}): Row => ({
  id: "s1",
  token: "tok",
  organization_id: ORG,
  room_id: "room-1",
  revoked_at: null,
  expires_at: null,
  require_email: true,
  require_nda: false,
  password_hash: null,
  allowed_sections: null,
  document_id: null,
  ...over,
});

beforeEach(() => {
  gatePassed = true;
  tables.documents = [
    { id: "pub", organization_id: ORG, doc_type: "fund_terms", storage_key: "org-1/pub/a.pdf" },
    { id: "draft", organization_id: ORG, doc_type: "fund_terms", storage_key: "org-1/draft/b.pdf" },
  ];
  tables.data_room_documents = [{ id: "m1", organization_id: ORG, room_id: "room-1", document_id: "pub" }];
});

describe("room links", () => {
  it("serve a published document", async () => {
    tables.data_room_shares = [share()];
    expect((await resolveSharedDocument("tok", "pub")).ok).toBe(true);
  });

  it("refuse an unpublished document", async () => {
    tables.data_room_shares = [share()];
    expect((await resolveSharedDocument("tok", "draft")).ok).toBe(false);
  });

  it("refuse a document outside the section allowlist", async () => {
    tables.data_room_shares = [share({ allowed_sections: ["marketing"] })];
    expect((await resolveSharedDocument("tok", "pub")).ok).toBe(false);
  });

  it("refuse everything until the gate is passed", async () => {
    tables.data_room_shares = [share()];
    gatePassed = false;
    expect((await resolveSharedDocument("tok", "pub")).ok).toBe(false);
  });

  it("refuse revoked and expired links", async () => {
    tables.data_room_shares = [share({ revoked_at: "2026-01-01T00:00:00Z" })];
    expect((await resolveSharedDocument("tok", "pub")).ok).toBe(false);
    tables.data_room_shares = [share({ expires_at: "2000-01-01T00:00:00Z" })];
    expect((await resolveSharedDocument("tok", "pub")).ok).toBe(false);
  });
});

describe("single-document links", () => {
  it("serve their document even when it is not published", async () => {
    tables.data_room_shares = [share({ document_id: "draft" })];
    const res = await resolveSharedDocument("tok", "draft");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.viewerEmail).toBe("lp@example.com");
  });

  it("refuse every other document, published ones included", async () => {
    tables.data_room_shares = [share({ document_id: "draft" })];
    expect((await resolveSharedDocument("tok", "pub")).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("isShareLive", () => {
    expect(isShareLive(null)).toBe(false);
    expect(isShareLive({ revoked_at: null, expires_at: null })).toBe(true);
  });

  it("watermarkLabel prefers the gate email, then the recipient, then the label", () => {
    const now = new Date("2026-09-30T14:05:00Z");
    expect(watermarkLabel({ recipient_email: "r@x.com", label: "L" }, "v@x.com", now)).toBe(
      "v@x.com · 2026-09-30 14:05 UTC",
    );
    expect(watermarkLabel({ recipient_email: null, label: "Q3 raise" }, null, now)).toBe("Q3 raise · 2026-09-30 14:05 UTC");
  });
});
