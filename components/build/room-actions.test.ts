jest.mock("server-only", () => ({}), { virtual: true });
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...(a as [])) }));
let ctx: { orgId: string; userId: string } | null = { orgId: "org-1", userId: "user-1" };
jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ctx }));

// What each table answers with. `singles` feeds maybeSingle() (the org
// re-checks), `rows` feeds awaited list queries (the manifest and its docs).
const singles: Record<string, unknown> = {};
const rows: Record<string, unknown[]> = {};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcResult: { data: unknown; error: { message: string } | null } = { data: true, error: null };
const tableWrites: { table: string; op: string }[] = [];

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: singles[table] ?? null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows[table] ?? [] }),
        upsert: async () => {
          tableWrites.push({ table, op: "upsert" });
          return { error: null };
        },
        update: () => {
          tableWrites.push({ table, op: "update" });
          return q;
        },
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  }),
}));

import { publishDocument, moveRoomDocument } from "./room-actions";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  ctx = { orgId: "org-1", userId: "user-1" };
  for (const k of Object.keys(singles)) delete singles[k];
  for (const k of Object.keys(rows)) delete rows[k];
  rpcCalls.length = 0;
  tableWrites.length = 0;
  rpcResult = { data: true, error: null };
  revalidatePath.mockClear();
});

describe("publishing a document", () => {
  beforeEach(() => {
    singles.data_rooms = { id: "room-1" };
    singles.documents = { id: "doc-1" };
  });

  // THE RACE THIS CLOSES. The old path read the room's maximum sort_order
  // here and wrote max+1 in a second statement, so two publications in the
  // same instant landed on the same position. Allocation now happens inside
  // publish_room_document, under a per-room lock.
  it("allocates the position inside the database, not with a read in front of a write", async () => {
    await publishDocument(form({ room_id: "room-1", document_id: "doc-1" }));
    expect(rpcCalls).toEqual([
      {
        fn: "publish_room_document",
        args: {
          p_organization_id: "org-1",
          p_room_id: "room-1",
          p_document_id: "doc-1",
          p_added_by: "user-1",
        },
      },
    ]);
    expect(tableWrites).toEqual([]);
  });

  // A publication that fails used to resolve as though it had published —
  // the operator saw the dialog close and the document never appeared.
  it("reports a failed publish instead of resolving as though it worked", async () => {
    rpcResult = { data: null, error: { message: "connection reset" } };
    await expect(
      publishDocument(form({ room_id: "room-1", document_id: "doc-1" })),
    ).rejects.toThrow(/connection reset/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("publishes nothing when the room is not the caller's", async () => {
    singles.data_rooms = null;
    await publishDocument(form({ room_id: "room-x", document_id: "doc-1" }));
    expect(rpcCalls).toEqual([]);
  });

  it("publishes nothing when the document is not the caller's", async () => {
    singles.documents = null;
    await publishDocument(form({ room_id: "room-1", document_id: "doc-x" }));
    expect(rpcCalls).toEqual([]);
  });
});

describe("reordering a document", () => {
  // A room with two sections. Display order within "financials" is Alpha
  // then Beta (positions 0 and 2); "legal" sits between them numerically.
  beforeEach(() => {
    rows.data_room_documents = [
      { id: "m-a", document_id: "doc-a", sort_order: 0 },
      { id: "m-l", document_id: "doc-l", sort_order: 1 },
      { id: "m-b", document_id: "doc-b", sort_order: 2 },
    ];
    rows.documents = [
      { id: "doc-a", doc_type: "financials", name: "Alpha" },
      { id: "doc-l", doc_type: "legal", name: "Charter" },
      { id: "doc-b", doc_type: "financials", name: "Beta" },
    ];
  });

  // The old path renumbered the whole section 0..n-1 — positions another
  // section already held, which a room-wide unique (room_id, sort_order)
  // can never admit. A move is now one atomic exchange of the two rows the
  // operator is looking at.
  it("exchanges positions with the neighbour the operator can see, atomically", async () => {
    await moveRoomDocument(form({ room_id: "room-1", document_id: "doc-a", dir: "down" }));
    expect(rpcCalls).toEqual([
      {
        fn: "swap_room_document_positions",
        args: {
          p_organization_id: "org-1",
          p_room_id: "room-1",
          p_document_id: "doc-a",
          p_other_document_id: "doc-b",
        },
      },
    ]);
    expect(tableWrites).toEqual([]);
  });

  it("only swaps within the document's own section", async () => {
    // Beta is the last financials row: "down" has nowhere to go, even though
    // the legal row sits above it numerically.
    await moveRoomDocument(form({ room_id: "room-1", document_id: "doc-b", dir: "down" }));
    expect(rpcCalls).toEqual([]);
  });

  it("breaks position ties by name, the way the room renders them", async () => {
    // Legacy rows can still tie until the renumber migration has run; the
    // on-screen neighbour is then decided by name.
    rows.data_room_documents = [
      { id: "m-a", document_id: "doc-a", sort_order: 0 },
      { id: "m-b", document_id: "doc-b", sort_order: 0 },
    ];
    await moveRoomDocument(form({ room_id: "room-1", document_id: "doc-a", dir: "down" }));
    expect(rpcCalls[0]?.args.p_other_document_id).toBe("doc-b");
  });

  it("reports a failed move instead of resolving as though it worked", async () => {
    rpcResult = { data: null, error: { message: "connection reset" } };
    await expect(
      moveRoomDocument(form({ room_id: "room-1", document_id: "doc-a", dir: "down" })),
    ).rejects.toThrow(/connection reset/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("treats a row that vanished mid-move as a no-op", async () => {
    rpcResult = { data: false, error: null };
    await moveRoomDocument(form({ room_id: "room-1", document_id: "doc-a", dir: "down" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
