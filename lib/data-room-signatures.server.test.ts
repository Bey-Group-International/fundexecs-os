import { loadSignaturesAwaitingFund } from "@/lib/data-room-signatures.server";
import { createServerClient } from "@/lib/supabase/server";

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/supabase/server", () => ({ createServerClient: jest.fn() }));

type Result = { data: unknown[] | null; error: { message: string } | null };

/** A query builder that answers with fixed rows and records the filters it was given. */
function client(tables: Record<string, Result>) {
  const calls: Record<string, [string, ...unknown[]][]> = {};
  return {
    calls,
    from(table: string) {
      calls[table] = [];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "order", "limit"]) {
        q[m] = (...a: unknown[]) => {
          calls[table].push([m, ...a]);
          return q;
        };
      }
      q.then = (resolve: (v: Result) => unknown) => Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve);
      return q;
    },
  };
}

const ok = (data: unknown[]): Result => ({ data, error: null });
const recipient = (role: string, status: string, name = "x", signed_at: string | null = null) => ({ name, email: `${name}@e.com`, role, status, signed_at });

function mock(tables: Record<string, Result>) {
  const c = client(tables);
  (createServerClient as jest.Mock).mockResolvedValue(c);
  return c;
}

const rooms = ok([{ id: "r1", name: "Fund IV Room" }, { id: "r2", name: "Fund III Room" }]);
const shares = ok([{ id: "s1", room_id: "r1" }, { id: "s2", room_id: "r2" }]);

it("lists legacy files awaiting counter-signature with their room", async () => {
  mock({
    data_room_document_signatures: ok([{ id: "L1", room_id: "r2", file_name: "NDA.pdf", signer_name: "Pat", signer_email: "p@e.com", signed_at: "2026-10-01T00:00:00Z" }]),
    envelopes: ok([]),
    data_rooms: rooms,
    data_room_shares: shares,
  });
  const tasks = await loadSignaturesAwaitingFund("org1");
  expect(tasks).toEqual([
    expect.objectContaining({ kind: "legacy", id: "L1", title: "NDA.pdf", roomId: "r2", roomName: "Fund III Room", signerName: "Pat" }),
  ]);
});

it("lists an envelope only when the fund's own turn is next, in the room its link belongs to", async () => {
  mock({
    data_room_document_signatures: ok([]),
    envelopes: ok([
      // Reader signed, owner still to sign: the fund's turn.
      { id: "E1", title: "Subscription", updated_at: "2026-10-05T00:00:00Z", data_room_share_id: "s1", reader_email: "r@e.com", envelope_recipients: [recipient("signer", "signed", "Reader", "2026-10-04T00:00:00Z"), recipient("owner", "pending", "Owner")] },
      // Owner already signed: nothing to do.
      { id: "E2", title: "Done", updated_at: "2026-10-05T00:00:00Z", data_room_share_id: "s1", reader_email: null, envelope_recipients: [recipient("signer", "signed"), recipient("owner", "signed")] },
      // No owner recipient: cannot be the fund's turn.
      { id: "E3", title: "No owner", updated_at: "2026-10-05T00:00:00Z", data_room_share_id: "s1", reader_email: null, envelope_recipients: [recipient("signer", "signed")] },
      // Link no longer exists: no room to name it under.
      { id: "E4", title: "Orphan", updated_at: "2026-10-05T00:00:00Z", data_room_share_id: "gone", reader_email: null, envelope_recipients: [recipient("signer", "signed"), recipient("owner", "pending")] },
    ]),
    data_rooms: rooms,
    data_room_shares: shares,
  });
  const tasks = await loadSignaturesAwaitingFund("org1");
  expect(tasks.map((t) => t.id)).toEqual(["E1"]);
  expect(tasks[0]).toMatchObject({ kind: "envelope", roomId: "r1", roomName: "Fund IV Room", signerName: "Reader", signedAt: "2026-10-04T00:00:00Z" });
});

it("only asks for this organization's rows, unsigned legacy files and partially signed envelopes", async () => {
  const c = mock({ data_room_document_signatures: ok([]), envelopes: ok([]), data_rooms: rooms, data_room_shares: shares });
  await loadSignaturesAwaitingFund("org1");
  expect(c.calls.data_room_document_signatures).toEqual(expect.arrayContaining([["eq", "organization_id", "org1"], ["is", "countersigned_at", null]]));
  expect(c.calls.envelopes).toEqual(expect.arrayContaining([["eq", "organization_id", "org1"], ["eq", "status", "partially_signed"]]));
  expect(c.calls.data_rooms).toEqual(expect.arrayContaining([["eq", "organization_id", "org1"]]));
  expect(c.calls.data_room_shares).toEqual(expect.arrayContaining([["eq", "organization_id", "org1"]]));
});

it("throws rather than showing an empty list when a read fails", async () => {
  mock({
    data_room_document_signatures: { data: null, error: { message: "boom" } },
    envelopes: ok([]),
    data_rooms: rooms,
    data_room_shares: shares,
  });
  await expect(loadSignaturesAwaitingFund("org1")).rejects.toThrow(/Couldn't load the room signatures: boom/);
});
