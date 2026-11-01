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
// What each mocked dependency answers. Reset before every test.
let roomState: "open" | "closed" | "error" = "open";
let signedIds: Set<string> | "error" = new Set();
const failTables = new Set<string>();
let queries = 0;

jest.mock("@/lib/data-room-gate", () => ({
  readGatePass: async () => ({ email: "lp@example.com", pwd: true, nda: true }),
  gateSatisfied: () => gatePassed,
}));
jest.mock("@/lib/data-room-viewer.server", () => ({
  isRoomOpen: async () => {
    if (roomState === "error") {
      const { DataRoomReadError } = jest.requireActual("@/lib/data-room-errors");
      throw new DataRoomReadError("room", { code: "08006" });
    }
    return roomState === "open";
  },
}));
jest.mock("@/lib/document-signing.server", () => ({
  signedDocumentIds: async () => {
    if (signedIds === "error") {
      const { DataRoomReadError } = jest.requireActual("@/lib/data-room-errors");
      throw new DataRoomReadError("signatures", { code: "08006" });
    }
    return signedIds;
  },
}));
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
        maybeSingle: async () => {
          queries += 1;
          if (failTables.has(table)) return { data: null, error: { message: "injected", code: "08006" } };
          return {
            data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
            error: null,
          };
        },
      };
      return q;
    },
  }),
}));

import { isShareLive, resolveSharedDocument, watermarkLabel } from "./data-room-access.server";

const ORG = "org-1";
// Document ids are uuids; the access check refuses anything else before querying.
const PUB = "00000000-0000-4000-8000-0000000000a1";
const DRAFT = "00000000-0000-4000-8000-0000000000a2";
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
  roomState = "open";
  signedIds = new Set();
  failTables.clear();
  queries = 0;
  tables.documents = [
    { id: PUB, organization_id: ORG, doc_type: "fund_terms", storage_key: "org-1/pub/a.pdf" },
    { id: DRAFT, organization_id: ORG, doc_type: "fund_terms", storage_key: "org-1/draft/b.pdf" },
  ];
  tables.data_room_documents = [{ id: "m1", organization_id: ORG, room_id: "room-1", document_id: PUB }];
});

describe("room links", () => {
  it("serve a published document", async () => {
    tables.data_room_shares = [share()];
    expect((await resolveSharedDocument("tok", PUB)).ok).toBe(true);
  });

  it("refuse an unpublished document", async () => {
    tables.data_room_shares = [share()];
    expect((await resolveSharedDocument("tok", DRAFT)).ok).toBe(false);
  });

  it("refuse a document outside the section allowlist", async () => {
    tables.data_room_shares = [share({ allowed_sections: ["marketing"] })];
    expect((await resolveSharedDocument("tok", PUB)).ok).toBe(false);
  });

  it("refuse everything until the gate is passed", async () => {
    tables.data_room_shares = [share()];
    gatePassed = false;
    expect((await resolveSharedDocument("tok", PUB)).ok).toBe(false);
  });

  it("refuse revoked and expired links", async () => {
    tables.data_room_shares = [share({ revoked_at: "2026-01-01T00:00:00Z" })];
    expect((await resolveSharedDocument("tok", PUB)).ok).toBe(false);
    tables.data_room_shares = [share({ expires_at: "2000-01-01T00:00:00Z" })];
    expect((await resolveSharedDocument("tok", PUB)).ok).toBe(false);
  });
});

describe("single-document links", () => {
  it("serve their document even when it is not published", async () => {
    tables.data_room_shares = [share({ document_id: DRAFT })];
    const res = await resolveSharedDocument("tok", DRAFT);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.viewerEmail).toBe("lp@example.com");
  });

  it("refuse every other document, published ones included", async () => {
    tables.data_room_shares = [share({ document_id: DRAFT })];
    expect((await resolveSharedDocument("tok", PUB)).ok).toBe(false);
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


describe("a room that is archived", () => {
  it("serves nothing, however live the link is", async () => {
    tables.data_room_shares = [share()];
    roomState = "closed";
    expect(await resolveSharedDocument("tok", PUB)).toEqual({ ok: false });
  });
});

describe("a denial is not an outage", () => {
  it("carries no 'unavailable' marker, so a dead link is still reported as one", async () => {
    tables.data_room_shares = [share()];
    expect(await resolveSharedDocument("tok", DRAFT)).toEqual({ ok: false });
    tables.data_room_shares = [share({ revoked_at: "2026-01-01T00:00:00Z" })];
    expect(await resolveSharedDocument("tok", PUB)).toEqual({ ok: false });
  });

  it("treats something that is not a document id as a miss before it reaches the database", async () => {
    tables.data_room_shares = [share()];
    failTables.add("documents");
    failTables.add("data_room_documents");
    for (const bad of ["not-a-uuid", "", "1; drop table documents", PUB + "x"]) {
      expect(await resolveSharedDocument("tok", bad)).toEqual({ ok: false });
    }
    expect(queries).toBe(0);
  });
});

describe("a read that fails", () => {
  // Nothing is served, and the caller is told the truth: we couldn't check.
  const outage = { ok: false, unavailable: true };

  it.each([
    ["the link", "data_room_shares"],
    ["the room's manifest", "data_room_documents"],
    ["the document", "documents"],
  ])("is reported as unavailable, not as a denial, when %s can't be read", async (_label, table) => {
    tables.data_room_shares = [share()];
    failTables.add(table);
    expect(await resolveSharedDocument("tok", PUB)).toEqual(outage);
  });

  it("is reported as unavailable when the room's state can't be read", async () => {
    tables.data_room_shares = [share()];
    roomState = "error";
    expect(await resolveSharedDocument("tok", PUB)).toEqual(outage);
  });

  it("never opens a single-document link whose manifest row can't be read", async () => {
    // The row carries require_signature. Reading its absence as "not required"
    // would serve a file that needs a signature, to someone who has not signed.
    tables.data_room_shares = [share({ document_id: DRAFT })];
    tables.data_room_documents = [{ id: "m2", organization_id: ORG, room_id: "room-1", document_id: DRAFT, require_signature: true }];
    failTables.add("data_room_documents");
    expect(await resolveSharedDocument("tok", DRAFT)).toEqual(outage);
  });
});

describe("a file that requires a signature", () => {
  beforeEach(() => {
    tables.data_room_documents = [{ id: "m1", organization_id: ORG, room_id: "room-1", document_id: PUB, require_signature: true }];
  });

  it("stays shut to a reader who has not signed it, for open, preview and download alike", async () => {
    tables.data_room_shares = [share()];
    expect(await resolveSharedDocument("tok", PUB)).toEqual({ ok: false });
  });

  it("opens for the reader who has", async () => {
    tables.data_room_shares = [share()];
    signedIds = new Set([PUB]);
    const res = await resolveSharedDocument("tok", PUB);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.signatureRequired).toBe(true);
  });

  it("is reachable unsigned only by the signing action, which says so", async () => {
    tables.data_room_shares = [share()];
    const res = await resolveSharedDocument("tok", PUB, { skipSignature: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.signatureRequired).toBe(true);
  });

  it("applies to a single-document link too", async () => {
    tables.data_room_shares = [share({ document_id: PUB })];
    expect(await resolveSharedDocument("tok", PUB)).toEqual({ ok: false });
    signedIds = new Set([PUB]);
    expect((await resolveSharedDocument("tok", PUB)).ok).toBe(true);
  });

  it("is reported as unavailable, not as locked, when who has signed can't be read", async () => {
    tables.data_room_shares = [share()];
    signedIds = "error";
    expect(await resolveSharedDocument("tok", PUB)).toEqual({ ok: false, unavailable: true });
  });
});
